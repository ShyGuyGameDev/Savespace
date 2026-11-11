import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDb, type KeyProvider, type OpenedDb } from '../../src/main/db/client'
import { Store } from '../../src/main/db/store'

export const testKeys: KeyProvider = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from('k:' + s),
  decrypt: (b) => b.toString().slice(2),
}

export function tempDb(): { dir: string; opened: OpenedDb; store: Store; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'waypoint-db-'))
  const opened = openDb({
    dataDir: dir,
    migrationsDir: resolve(__dirname, '../../src/main/db/migrations'),
    keys: testKeys,
  })
  const store = new Store(opened.db)
  store.seedBuiltInExclusions()
  return {
    dir,
    opened,
    store,
    cleanup: () => {
      opened.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
