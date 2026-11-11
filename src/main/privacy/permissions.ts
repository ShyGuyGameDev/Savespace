import { systemPreferences } from 'electron'
import type { PermissionsStatus } from '@shared/schemas'
import { SafeExecError, type SafeExec } from '../safe-exec'

/**
 * Savespace asks for exactly two kinds of permission, and never Screen Recording:
 *  - Accessibility: read window titles/frames via System Events (and, only if enabled, arrange windows).
 *  - Automation: per-app consent to ask scriptable apps for read-only metadata.
 */
export const AUTOMATION_TARGETS: { bundleId: string; name: string; why: string }[] = [
  {
    bundleId: 'com.apple.systemevents',
    name: 'System Events',
    why: 'List open windows and their titles.',
  },
  {
    bundleId: 'com.google.Chrome',
    name: 'Google Chrome',
    why: 'Read the URLs of your open tabs (never incognito) and focus or open tabs on resume.',
  },
  {
    bundleId: 'com.apple.Safari',
    name: 'Safari',
    why: 'Open or focus saved pages on resume. Reading tabs is optional and off by default.',
  },
  {
    bundleId: 'com.apple.mail',
    name: 'Mail',
    why: 'Read the subject and ID of selected messages and drafts (never the text).',
  },
  {
    bundleId: 'com.apple.Notes',
    name: 'Notes',
    why: 'Remember which note was selected (title and ID only) and show it again.',
  },
  {
    bundleId: 'com.apple.iCal',
    name: 'Calendar',
    why: 'See the titles of events happening around now, to label checkpoints.',
  },
  { bundleId: 'com.apple.finder', name: 'Finder', why: 'Remember which folders were open.' },
  {
    bundleId: 'company.thebrowser.Browser',
    name: 'Arc',
    why: 'Read tab URLs (never incognito) and focus or open tabs.',
  },
  {
    bundleId: 'com.brave.Browser',
    name: 'Brave',
    why: 'Read tab URLs (never private) and focus or open tabs.',
  },
  {
    bundleId: 'com.microsoft.edgemac',
    name: 'Microsoft Edge',
    why: 'Read tab URLs (never InPrivate) and focus or open tabs.',
  },
]

export const SETTINGS_PANES = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
} as const

export class Permissions {
  private automation: Record<string, PermissionsStatus['automation'][string]> = {}

  constructor(private readonly exec: SafeExec) {}

  accessibility(): PermissionsStatus['accessibility'] {
    try {
      return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'not-determined'
    } catch {
      return 'unknown'
    }
  }

  status(): PermissionsStatus {
    const automation: PermissionsStatus['automation'] = {}
    for (const t of AUTOMATION_TARGETS)
      automation[t.bundleId] = this.automation[t.bundleId] ?? 'not-determined'
    return { accessibility: this.accessibility(), automation }
  }

  /** Shows the macOS Accessibility prompt (which links to System Settings). */
  promptAccessibility(): PermissionsStatus {
    try {
      systemPreferences.isTrustedAccessibilityClient(true)
    } catch {
      /* ignore */
    }
    return this.status()
  }

  /** Record an Automation outcome observed during normal capture (keeps the Privacy center accurate). */
  noteAutomation(bundleId: string, state: 'granted' | 'denied'): void {
    this.automation[bundleId] = state
  }

  /**
   * Triggers (or re-checks) the Automation consent for one app with a harmless read-only probe.
   * Never launches the app: if it isn't running we report "not-determined".
   */
  /**
   * Triggers (or re-checks) the Automation consent for one app with a harmless read-only probe.
   * Called only when the user clicks "Ask". If the app is closed, it is opened in the background
   * first (macOS can only ask about a running app). Waits up to 2 minutes for the user's answer.
   */
  async requestAutomation(
    bundleId: string,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ): Promise<PermissionsStatus> {
    const target = AUTOMATION_TARGETS.find((t) => t.bundleId === bundleId)
    if (!target) throw new Error('Unknown automation target')
    const done = (
      outcome: NonNullable<PermissionsStatus['lastRequest']>['outcome'],
      message: string,
    ): PermissionsStatus => ({
      ...this.status(),
      lastRequest: { bundleId, outcome, message },
    })
    try {
      if (bundleId === 'com.apple.systemevents') {
        await this.exec.script('system-events.probe', [], 120_000)
      } else {
        const state = await this.exec.script<{ installed: boolean; running: boolean }>(
          'app.running',
          [bundleId],
        )
        if (!state.installed) {
          this.automation[bundleId] = 'unknown'
          return done('not-installed', `${target.name} isn’t installed on this Mac.`)
        }
        if (!state.running) {
          await this.exec.launchApp(bundleId, { background: true })
          for (let i = 0; i < 40; i++) {
            await sleep(250)
            if ((await this.exec.script<{ running: boolean }>('app.running', [bundleId])).running)
              break
          }
          await sleep(800) // let the app finish starting before macOS shows the question
        }
        const r = await this.exec.script<{ running: boolean }>('app.probe', [bundleId], 120_000)
        if (!r.running)
          return done('error', `${target.name} didn’t open. Open it yourself and click Ask again.`)
      }
      this.automation[bundleId] = 'granted'
      return done('granted', `${target.name} is allowed.`)
    } catch (e) {
      if (e instanceof SafeExecError && e.code === 'not-authorized') {
        this.automation[bundleId] = 'denied'
        return done(
          'denied',
          `You chose Don’t Allow. To change it: System Settings → Privacy & Security → Automation → Savespace → turn on ${target.name}.`,
        )
      }
      if (e instanceof SafeExecError && e.code === 'timeout') {
        return done(
          'no-answer',
          'No answer yet. Click Ask again and choose Allow in the box macOS shows.',
        )
      }
      return done('error', `Couldn’t ask ${target.name}: ${(e as Error).message.slice(0, 160)}`)
    }
  }

  async openSettings(pane: keyof typeof SETTINGS_PANES): Promise<void> {
    await this.exec.openUrl(SETTINGS_PANES[pane])
  }
}
