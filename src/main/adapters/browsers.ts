import type { ResourceRef, RestoreItemResult } from '@shared/schemas'
import { isPrivateTitle } from '../capture/privacy-filter'
import { SafeExecError } from '../safe-exec'
import type { ScriptId } from '../safe-exec/scripts/registry'
import type { AppAdapter, CaptureContext, RestoreContext } from './types'
import { errorReason, result } from './util'
import { describeUrl } from './web-apps'
import { homedir } from 'node:os'
import { indexProfiles, profileForWindow, type ProfileIndex } from './chromium-profiles'

interface TabsResult {
  running: boolean
  windows: {
    index: number
    active?: number
    title?: string
    tabs: { url: string; title: string }[]
  }[]
}

interface BrowserSpec {
  id: string
  displayName: string
  bundleId: string
  /** AppleScript application name (used as argv for Chromium templates). */
  scriptName: string
  read: ScriptId | null
  open: ScriptId | null
  notes: string
  tier: 'deep' | 'partial'
  /** Skip capture unless this returns true (Safari opt-in). */
  captureEnabled?: (ctx: CaptureContext) => boolean
  readArgs?: (spec: BrowserSpec) => string[]
  /** Allowlisted binary id that opens a URL in a given profile (Chromium browsers only). */
  profileCli?: string
  openArgs?: (spec: BrowserSpec, url: string) => string[]
}

const isWeb = (u: string) => /^https?:\/\//i.test(u)

export function createBrowserAdapter(spec: BrowserSpec): AppAdapter {
  return {
    id: spec.id,
    displayName: spec.displayName,
    bundleIds: [spec.bundleId],
    tier: spec.tier,
    needsAutomation: !!spec.read,
    notes: spec.notes,
    handles: (ref) => ref.app === spec.bundleId && (ref.kind === 'url' || ref.kind === 'doc'),

    async capture(ctx) {
      if (!spec.read || !ctx.isRunning(spec.bundleId)) return []
      if (spec.captureEnabled && !spec.captureEnabled(ctx)) return []
      try {
        const r = await ctx.exec.script<TabsResult>(spec.read, spec.readArgs?.(spec) ?? [])
        ctx.noteAutomation(spec.bundleId, 'granted')
        const front = ctx.apps.find((a) => a.bundleId === spec.bundleId)?.frontmost
        const out: ResourceRef[] = []
        let profiles: ProfileIndex | null = null
        try {
          profiles = spec.profileCli ? indexProfiles(ctx.homeDir, spec.bundleId) : null
        } catch {
          profiles = null
        }
        for (const w of r.windows) {
          if (isPrivateTitle(w.title)) continue
          const dir = profiles
            ? profileForWindow(
                w.tabs.map((t) => t.url),
                profiles.sessions,
              )
            : null
          const profile = dir ? profiles!.profiles.find((p) => p.dir === dir) : undefined
          w.tabs.forEach((t, i) => {
            if (!isWeb(t.url) || isPrivateTitle(t.title)) return
            const focused = front && w.index === 0 && (w.active ? w.active === i + 1 : i === 0)
            out.push({
              kind: 'url',
              app: spec.bundleId,
              url: t.url,
              title: (t.title || t.url).slice(0, 300),
              browserWindow: w.index,
              profile: profile ? { dir: profile.dir, name: profile.name } : undefined,
              focused: focused || undefined,
            })
          })
        }
        return out.slice(0, 120)
      } catch (e) {
        if (e instanceof SafeExecError && e.code === 'not-authorized')
          ctx.noteAutomation(spec.bundleId, 'denied')
        return []
      }
    },

    isRunning: (ctx) => ctx.isRunning(spec.bundleId),

    async alreadyOpen(ref, ctx) {
      if (ref.kind !== 'url' || !(await ctx.isRunning(spec.bundleId))) return false
      if (spec.id !== 'chrome' && !spec.read?.startsWith('chromium')) return false
      try {
        return (
          await ctx.exec.script<{ open: boolean }>('chromium.has-url', [spec.scriptName, ref.url])
        ).open
      } catch {
        return false
      }
    },

    describe(ref) {
      if (ref.kind === 'url' || ref.kind === 'doc') {
        const label = describeUrl(ref.url, ref.title)
        const prof = ref.kind === 'url' && ref.profile ? ` (profile “${ref.profile.name}”)` : ''
        return {
          action: 'open',
          description: `${label} in ${spec.displayName}${prof}`,
          reason: spec.open
            ? 'Focuses the tab if it is already open, otherwise opens a new tab'
            : 'Opens in a new tab',
        }
      }
      return { action: 'info', description: '' }
    },

    async restore(refs, ctx) {
      const out: RestoreItemResult[] = []
      for (const ref of refs) {
        const t0 = Date.now()
        if (ref.kind !== 'url' && ref.kind !== 'doc') {
          out.push(result(ref, spec.id, 'skipped', 'Not a web page', t0))
          continue
        }
        try {
          out.push(await restoreUrl(spec, ref.url, ref, ctx, t0))
        } catch (e) {
          out.push(result(ref, spec.id, 'failed', errorReason(e), t0))
        }
      }
      return out
    },
  }
}

async function restoreUrl(
  spec: BrowserSpec,
  url: string,
  ref: ResourceRef,
  ctx: RestoreContext,
  t0: number,
): Promise<RestoreItemResult> {
  if (ref.kind === 'url' && ref.profile && spec.profileCli) {
    const r = await restoreInProfile(spec, url, ref.profile, ref, ctx, t0)
    if (r) return r
  }
  const running = await ctx.isRunning(spec.bundleId)
  if (!spec.open) {
    await ctx.exec.openUrl(url, { bundleId: spec.bundleId })
    return result(
      ref,
      spec.id,
      'opened',
      `${spec.displayName} can’t be asked which tabs are open, so this always opens a new tab`,
      t0,
    )
  }
  if (!running) {
    // Not running: let LaunchServices start it with this URL (one new window, no duplicates possible).
    await ctx.exec.openUrl(url, { bundleId: spec.bundleId })
    return result(ref, spec.id, 'opened', `Started ${spec.displayName}`, t0)
  }
  try {
    const r = await ctx.exec.script<{ status: 'opened' | 'already-open' | 'no-window' }>(
      spec.open,
      spec.openArgs?.(spec, url) ?? [url],
    )
    if (r.status === 'no-window') {
      await ctx.exec.openUrl(url, { bundleId: spec.bundleId })
      return result(ref, spec.id, 'opened', 'Opened in a new window', t0)
    }
    return result(
      ref,
      spec.id,
      r.status,
      r.status === 'already-open' ? 'Tab was already open; focused it' : 'Opened in a new tab',
      t0,
    )
  } catch (e) {
    if (e instanceof SafeExecError && e.code === 'not-authorized') {
      // Without Automation we can't check for an existing tab; opening via LaunchServices is still open-only.
      await ctx.exec.openUrl(url, { bundleId: spec.bundleId })
      return result(
        ref,
        spec.id,
        'opened',
        `Opened without checking for an existing tab (Automation for ${spec.displayName} is off)`,
        t0,
      )
    }
    throw e
  }
}

/**
 * Opens (or focuses) a tab in the SAME profile/account it was saved from.
 * Returns null to fall back to the normal path if the profile can't be targeted.
 */
async function restoreInProfile(
  spec: BrowserSpec,
  url: string,
  profile: { dir: string; name: string },
  ref: ResourceRef,
  ctx: RestoreContext,
  t0: number,
): Promise<RestoreItemResult | null> {
  if (!(await ctx.isRunning(spec.bundleId))) {
    // Start the browser first so the profile switch below goes to the running instance.
    await ctx.exec.launchApp(spec.bundleId)
    for (let i = 0; i < 40; i++) {
      await ctx.sleep(250)
      try {
        if ((await ctx.exec.script<{ running: boolean }>('app.running', [spec.bundleId])).running)
          break
      } catch {
        break
      }
    }
    await ctx.sleep(1000)
  }
  // Already open in that profile? Focus it instead of opening a duplicate.
  try {
    const tabs = await ctx.exec.script<TabsResult>('chromium.tabs', [spec.scriptName])
    const index = indexProfiles(homedir(), spec.bundleId)
    if (index) {
      for (const w of tabs.windows) {
        if (
          profileForWindow(
            w.tabs.map((t) => t.url),
            index.sessions,
          ) !== profile.dir
        )
          continue
        const j = w.tabs.findIndex((t) => t.url === url)
        if (j < 0) continue
        const f = await ctx.exec.script<{ status: string }>('chromium.focus-tab', [
          spec.scriptName,
          String(w.index),
          String(j),
          url,
        ])
        if (f.status === 'already-open')
          return result(
            ref,
            spec.id,
            'already-open',
            `Tab was already open in profile “${profile.name}”; focused it`,
            t0,
          )
      }
    }
  } catch {
    /* can't check (e.g. Automation off): just open it in the right profile below */
  }
  try {
    const r = await ctx.exec.run(spec.profileCli!, [`--profile-directory=${profile.dir}`, url], {
      timeoutMs: 15_000,
    })
    if (r.code !== 0) return null
    return result(ref, spec.id, 'opened', `Opened in a new tab in profile “${profile.name}”`, t0)
  } catch {
    return null
  }
}

const chromium = (
  id: string,
  displayName: string,
  bundleId: string,
  scriptName: string,
  verified: boolean,
) =>
  createBrowserAdapter({
    id,
    displayName,
    bundleId,
    scriptName,
    read: 'chromium.tabs',
    open: 'chromium.focus-or-open',
    readArgs: (s) => [s.scriptName],
    openArgs: (s, url) => [s.scriptName, url],
    profileCli: `${id}-profile`,
    tier: 'deep',
    notes: `Reads tab URLs and titles of normal windows (incognito/private windows are skipped by the window's \`mode\`). Remembers which profile (account) each window belongs to, from the browser’s own Local State and session files, read-only, and reopens tabs in that same profile (\`--profile-directory\`). Restores by focusing a matching tab or opening a new tab; never changes an existing tab.${verified ? '' : ' Same scripting dictionary as Chrome; untested on this Mac.'}`,
  })

export const chromeAdapter = chromium(
  'chrome',
  'Google Chrome',
  'com.google.Chrome',
  'Google Chrome',
  true,
)
export const braveAdapter = chromium('brave', 'Brave', 'com.brave.Browser', 'Brave Browser', false)
export const edgeAdapter = chromium(
  'edge',
  'Microsoft Edge',
  'com.microsoft.edgemac',
  'Microsoft Edge',
  false,
)
export const vivaldiAdapter = chromium(
  'vivaldi',
  'Vivaldi',
  'com.vivaldi.Vivaldi',
  'Vivaldi',
  false,
)
export const chromiumAdapter = chromium(
  'chromium',
  'Chromium',
  'org.chromium.Chromium',
  'Chromium',
  false,
)

export const arcAdapter = createBrowserAdapter({
  id: 'arc',
  displayName: 'Arc',
  bundleId: 'company.thebrowser.Browser',
  scriptName: 'Arc',
  read: 'arc.tabs',
  open: 'arc.focus-or-open',
  tier: 'deep',
  notes:
    'Reads tabs of non-incognito windows; restores by selecting a matching tab or opening a new one. Little Arc windows are not scriptable. Untested on this Mac.',
})

export const safariAdapter = createBrowserAdapter({
  id: 'safari',
  displayName: 'Safari',
  bundleId: 'com.apple.Safari',
  scriptName: 'Safari',
  read: 'safari.tabs',
  open: 'safari.focus-or-open',
  tier: 'deep',
  captureEnabled: (ctx) => ctx.settings.captureSafariTabs,
  notes:
    'Restore focuses a matching tab or opens a new tab. Tab capture is OFF by default because Safari does not tell scripts which windows are private; when enabled, windows/tabs whose titles look private are skipped.',
})
