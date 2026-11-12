import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SafeExec } from '../safe-exec'

export interface InstalledApp {
  bundleId: string
  name: string
}

let cache: { at: number; apps: InstalledApp[] } | null = null

/** Apps in the usual Applications folders, with bundle ids read (read-only) from each Info.plist. */
export async function listInstalledApps(exec: SafeExec): Promise<InstalledApp[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.apps
  const dirs = [
    '/Applications',
    '/Applications/Utilities',
    '/System/Applications',
    '/System/Applications/Utilities',
    join(homedir(), 'Applications'),
  ]
  const bundles: string[] = []
  for (const d of dirs) {
    if (!existsSync(d)) continue
    for (const e of readdirSync(d)) if (e.endsWith('.app')) bundles.push(join(d, e))
  }
  bundles.push('/System/Library/CoreServices/Finder.app')
  const found = new Map<string, InstalledApp>()
  // A few at a time so a big Applications folder doesn't spawn hundreds of processes at once.
  for (let i = 0; i < bundles.length; i += 8) {
    const batch = await Promise.all(
      bundles.slice(i, i + 8).map(async (b) => {
        try {
          const r = await exec.run(
            'plutil',
            ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', `${b}/Contents/Info.plist`],
            { timeoutMs: 3000 },
          )
          const id = r.stdout.trim()
          return r.code === 0 && /^[A-Za-z0-9.-]+$/.test(id)
            ? {
                bundleId: id,
                name: b
                  .split('/')
                  .pop()!
                  .replace(/\.app$/, ''),
              }
            : null
        } catch {
          return null
        }
      }),
    )
    for (const a of batch) if (a && !found.has(a.bundleId)) found.set(a.bundleId, a)
  }
  const apps = [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
  cache = { at: Date.now(), apps }
  return apps
}
