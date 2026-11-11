import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Store } from '../db/store'

/**
 * Writes a full JSON export into Waypoint's own data directory (never elsewhere, per the
 * open-only rule). The caller may then reveal the folder in Finder.
 */
export function exportToDataDir(store: Store, dataDir: string, now = new Date()): string {
  const dir = join(dataDir, 'exports')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const path = join(dir, `waypoint-export-${stamp}.json`)
  writeFileSync(path, JSON.stringify(store.exportAll(), null, 2), { mode: 0o600 })
  store.audit('export', `Exported all data to ${path}`)
  return path
}
