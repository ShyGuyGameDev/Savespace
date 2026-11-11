import { systemPreferences } from 'electron'
import type { PermissionsStatus } from '@shared/schemas'
import { SafeExecError, type SafeExec } from '../safe-exec'

/**
 * Waypoint asks for exactly two kinds of permission, and never Screen Recording:
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
  async requestAutomation(bundleId: string): Promise<PermissionsStatus> {
    if (!AUTOMATION_TARGETS.some((t) => t.bundleId === bundleId))
      throw new Error('Unknown automation target')
    try {
      if (bundleId === 'com.apple.systemevents') await this.exec.script('system-events.probe')
      else {
        const r = await this.exec.script<{ running: boolean }>('app.probe', [bundleId])
        if (!r.running) return this.status()
      }
      this.automation[bundleId] = 'granted'
    } catch (e) {
      if (e instanceof SafeExecError && e.code === 'not-authorized')
        this.automation[bundleId] = 'denied'
      else if (e instanceof SafeExecError && /-2700|can.t be found/i.test(e.message))
        this.automation[bundleId] = 'unknown'
    }
    return this.status()
  }

  async openSettings(pane: keyof typeof SETTINGS_PANES): Promise<void> {
    await this.exec.openUrl(SETTINGS_PANES[pane])
  }
}
