import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Chromium browsers keep each signed-in account in its own *profile* (Default, Profile 1, …).
 * The scripting dictionary doesn't say which profile a window belongs to, so Savespace reads two
 * of the browser's own files, read-only:
 *  - `Local State` (JSON): profile folder → display name
 *  - `<profile>/Sessions/Session_*` (binary "SNSS"): the URLs of that profile's open tabs
 * A window is assigned to the profile whose session contains most of its tab URLs.
 */
export interface ChromiumProfile {
  dir: string
  name: string
}

/** Where each Chromium browser keeps its data, relative to ~/Library/Application Support. */
export const CHROMIUM_DATA_DIRS: Record<string, string> = {
  'com.google.Chrome': 'Google/Chrome',
  'com.brave.Browser': 'BraveSoftware/Brave-Browser',
  'com.microsoft.edgemac': 'Microsoft Edge',
  'com.vivaldi.Vivaldi': 'Vivaldi',
  'org.chromium.Chromium': 'Chromium',
}

/** Profile folder names Chromium creates. Anything else is rejected (it ends up in a command line). */
export const PROFILE_DIR_RE = /^(Default|Profile \d{1,4}|Guest Profile)$/

export function readProfiles(dataDir: string): ChromiumProfile[] {
  try {
    const state = JSON.parse(readFileSync(join(dataDir, 'Local State'), 'utf8')) as {
      profile?: { info_cache?: Record<string, { name?: string }> }
    }
    return Object.entries(state.profile?.info_cache ?? {})
      .filter(([dir]) => PROFILE_DIR_RE.test(dir))
      .map(([dir, v]) => ({ dir, name: (v.name ?? dir).slice(0, 100) }))
  } catch {
    return []
  }
}

/** Extracts http(s) URLs from a profile's newest session file (bytes scanned, nothing executed). */
export function sessionUrls(profileDir: string): Set<string> {
  const urls = new Set<string>()
  const dir = join(profileDir, 'Sessions')
  if (!existsSync(dir)) return urls
  let newest: { p: string; m: number } | null = null
  for (const f of readdirSync(dir)) {
    if (!f.startsWith('Session_')) continue
    const p = join(dir, f)
    const m = statSync(p).mtimeMs
    if (!newest || m > newest.m) newest = { p, m }
  }
  if (!newest) return urls
  const buf = readFileSync(newest.p)
  if (buf.length > 64 * 1024 * 1024) return urls
  for (const m of buf.toString('latin1').matchAll(/https?:\/\/[\x21-\x7e]{3,4096}/g)) urls.add(m[0])
  return urls
}

/** Returns the profile whose open-tab URLs best match a window's tabs, or null if unclear. */
export function profileForWindow(
  tabUrls: string[],
  sessions: Map<string, Set<string>>,
): string | null {
  let best: { dir: string; score: number } | null = null
  let tie = false
  for (const [dir, set] of sessions) {
    const score = tabUrls.filter((u) => set.has(u)).length
    if (!best || score > best.score) {
      best = { dir, score }
      tie = false
    } else if (score === best.score) tie = true
  }
  return best && best.score > 0 && !tie ? best.dir : null
}

export interface ProfileIndex {
  profiles: ChromiumProfile[]
  sessions: Map<string, Set<string>>
}

export function indexProfiles(home: string, bundleId: string): ProfileIndex | null {
  const rel = CHROMIUM_DATA_DIRS[bundleId]
  if (!rel) return null
  const dataDir = join(home, 'Library/Application Support', rel)
  const profiles = readProfiles(dataDir)
  if (profiles.length < 2) return null // only one account: nothing to tell apart
  const sessions = new Map<string, Set<string>>()
  for (const p of profiles) {
    try {
      sessions.set(p.dir, sessionUrls(join(dataDir, p.dir)))
    } catch {
      sessions.set(p.dir, new Set())
    }
  }
  return { profiles, sessions }
}
