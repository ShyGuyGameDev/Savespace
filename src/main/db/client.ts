import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export interface KeyProvider {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(enc: Buffer): string
}

export interface AsyncKeyProvider {
  isAvailable(): Promise<boolean>
  encrypt(plain: string): Promise<Buffer>
  decrypt(enc: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

export interface OpenDbOptions {
  dataDir: string
  migrationsDir: string
  /** Either a sync key provider (tests) or an already-loaded 64-char hex key (app). */
  keys?: KeyProvider
  hexKey?: string
  fileName?: string
}

/** App path: Electron's async safeStorage (Keychain). Re-encrypts the key file if macOS rotated keys. */
export async function loadOrCreateKeyAsync(
  dataDir: string,
  keys: AsyncKeyProvider,
): Promise<string> {
  if (!(await keys.isAvailable())) {
    throw new Error(
      'Secure storage (macOS Keychain) is unavailable. Refusing to create an unencrypted database.',
    )
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const keyFile = join(dataDir, 'db.key.enc')
  if (existsSync(keyFile)) {
    const { result, shouldReEncrypt } = await keys.decrypt(readFileSync(keyFile))
    if (shouldReEncrypt) writeFileSync(keyFile, await keys.encrypt(result), { mode: 0o600 })
    return result
  }
  const hex = randomBytes(32).toString('hex')
  writeFileSync(keyFile, await keys.encrypt(hex), { mode: 0o600 })
  return hex
}

export interface OpenedDb {
  db: Db
  raw: Database.Database
  path: string
  close(): void
}

/**
 * Loads (or creates on first run) the 32-byte DB key. The key is stored only in encrypted form
 * (`db.key.enc`), encrypted by Electron safeStorage, whose master key lives in the macOS Keychain.
 */
export function loadOrCreateKey(dataDir: string, keys: KeyProvider): string {
  if (!keys.isAvailable()) {
    throw new Error(
      'Secure storage (macOS Keychain) is unavailable. Refusing to create an unencrypted database.',
    )
  }
  const keyFile = join(dataDir, 'db.key.enc')
  if (existsSync(keyFile)) return keys.decrypt(readFileSync(keyFile))
  const hex = randomBytes(32).toString('hex')
  writeFileSync(keyFile, keys.encrypt(hex), { mode: 0o600 })
  return hex
}

export function openDb({
  dataDir,
  migrationsDir,
  keys,
  hexKey: given,
  fileName = 'waypoint.db',
}: OpenDbOptions): OpenedDb {
  if (!keys && !given) throw new Error('openDb needs a key')
  if (keys && !keys.isAvailable())
    throw new Error(
      'Secure storage (macOS Keychain) is unavailable. Refusing to create an unencrypted database.',
    )
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const hexKey = given ?? loadOrCreateKey(dataDir, keys!)
  if (!/^[0-9a-f]{64}$/.test(hexKey)) throw new Error('Database key is corrupt')
  const path = join(dataDir, fileName)
  const raw = new Database(path)
  raw.pragma(`cipher='chacha20'`)
  // The key is 64 validated hex chars, so this is not an injection surface.
  raw.pragma(`key="x'${hexKey}'"`)
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')
  raw.pragma('busy_timeout = 3000')
  // Fails fast with "file is not a database" if the key is wrong.
  raw.prepare('SELECT count(*) FROM sqlite_master').get()
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best effort */
  }
  const db = drizzle(raw, { schema })
  migrate(db, { migrationsFolder: migrationsDir })
  return { db, raw, path, close: () => raw.close() }
}
