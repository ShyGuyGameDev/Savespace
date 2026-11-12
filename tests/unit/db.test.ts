import Database from 'better-sqlite3'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb } from '../../src/main/db/client'
import { exportToDataDir } from '../../src/main/privacy/export'
import { tempDb, testKeys } from '../helpers/db'

let ctx: ReturnType<typeof tempDb>
afterEach(() => ctx?.cleanup())

describe('encrypted database', () => {
  it('stores nothing in plaintext and cannot be opened without the key', () => {
    ctx = tempDb()
    ctx.store.createProject('Super Secret Project Name')
    ctx.opened.raw.pragma('wal_checkpoint(TRUNCATE)')
    const bytes = readFileSync(ctx.opened.path)
    expect(bytes.includes(Buffer.from('Super Secret Project Name'))).toBe(false)
    expect(bytes.subarray(0, 15).toString()).not.toBe('SQLite format 3')
    const noKey = new Database(ctx.opened.path)
    expect(() => noKey.prepare('select * from projects').all()).toThrow(/not a database/)
    noKey.close()
  })

  it('stores the key only in encrypted form and reopens with it', () => {
    ctx = tempDb()
    ctx.store.createProject('Alpha')
    expect(existsSync(join(ctx.dir, 'db.key.enc'))).toBe(true)
    ctx.opened.close()
    const again = openDb({
      dataDir: ctx.dir,
      migrationsDir: resolve(__dirname, '../../src/main/db/migrations'),
      keys: testKeys,
    })
    expect(again.raw.prepare('select name from projects').all()).toEqual([{ name: 'Alpha' }])
    ctx.opened = again
  })

  it('refuses to run without secure storage', () => {
    expect(() =>
      openDb({
        dataDir: '/tmp/never',
        migrationsDir: 'x',
        keys: { ...testKeys, isAvailable: () => false },
      }),
    ).toThrow(/Keychain/)
  })
})

describe('store', () => {
  it('reads defaults and persists settings, with audit entries', () => {
    ctx = tempDb()
    expect(ctx.store.getSettings().activityRetentionDays).toBe(14)
    expect(ctx.store.getSettings().arrangeWindows).toBe(false)
    ctx.store.setSettings({ arrangeWindows: true, activityRetentionDays: 7 })
    expect(ctx.store.getSettings()).toMatchObject({
      arrangeWindows: true,
      activityRetentionDays: 7,
    })
    expect(ctx.store.listAudit()[0]?.action).toBe('settings')
  })

  it('creates checkpoints with validated resources and lists them newest first', () => {
    ctx = tempDb()
    const p = ctx.store.createProject('Savespace', ['repo:/Users/me/savespace'])
    ctx.store.createCheckpoint({
      projectId: p.id,
      trigger: 'manual',
      summary: 'a',
      summarySource: 'template',
      resources: [{ kind: 'app', app: 'com.apple.Safari' }],
      createdAt: 1000,
    })
    const cp2 = ctx.store.createCheckpoint({
      projectId: p.id,
      trigger: 'idle',
      summary: 'b',
      summarySource: 'template',
      resources: [
        {
          kind: 'file',
          app: 'com.microsoft.VSCode',
          path: '/Users/me/savespace/a.ts',
          line: 3,
          column: 2,
        },
      ],
      createdAt: 2000,
    })
    const list = ctx.store.listCheckpoints({ projectId: p.id })
    expect(list.map((c) => c.id)[0]).toBe(cp2.id)
    expect(list[0]?.resources[0]).toMatchObject({ kind: 'file', line: 3 })
    expect(ctx.store.getProject(p.id)?.lastCheckpointAt).toBe(2000)
    expect(() =>
      ctx.store.createCheckpoint({
        projectId: null,
        trigger: 'manual',
        summary: '',
        summarySource: 'template',
        resources: [{ kind: 'file', app: 'x', path: 'relative' } as never],
      }),
    ).toThrow()
  })

  it('edits and deletes projects (checkpoints are kept, unassigned)', () => {
    ctx = tempDb()
    const a = ctx.store.createProject('A', ['repo:/a'])
    ctx.store.createCheckpoint({
      projectId: a.id,
      trigger: 'manual',
      summary: '',
      summarySource: 'template',
      resources: [],
    })
    const edited = ctx.store.updateProject(a.id, {
      name: ' Atlas ',
      color: '#123456',
      signals: ['repo:/a', 'host:acme.dev', 'host:acme.dev', ' '],
    })
    expect(edited).toMatchObject({
      name: 'Atlas',
      color: '#123456',
      signals: ['repo:/a', 'host:acme.dev'],
    })
    ctx.store.deleteProject(a.id)
    expect(ctx.store.getProject(a.id)).toBeNull()
    expect(ctx.store.listCheckpoints({ projectId: null })).toHaveLength(1)
  })

  it('edits a checkpoint summary and removes saved items', () => {
    ctx = tempDb()
    const cp = ctx.store.createCheckpoint({
      projectId: null,
      trigger: 'manual',
      summary: 'old',
      summarySource: 'template',
      resources: [
        { kind: 'url', app: 'com.google.Chrome', url: 'https://a.test' },
        { kind: 'url', app: 'com.google.Chrome', url: 'https://youtube.com/x' },
        { kind: 'url', app: 'com.google.Chrome', url: 'https://c.test' },
      ],
    })
    const e = ctx.store.updateCheckpoint(cp.id, {
      summary: ' You were fixing the limiter. ',
      removeItems: [1],
    })
    expect(e.summary).toBe('You were fixing the limiter.')
    expect(e.resources.map((r) => (r.kind === 'url' ? r.url : ''))).toEqual([
      'https://a.test',
      'https://c.test',
    ])
    expect(ctx.store.listAudit()[0]?.detail).toMatch(/removed 1 item/)
  })

  it('prunes the rolling activity buffer by age', () => {
    ctx = tempDb()
    const now = Date.UTC(2026, 10, 10)
    ctx.store.addActivity({ at: now - 20 * 86_400_000, bundleId: 'x', appName: 'X', signals: [] })
    ctx.store.addActivity({ at: now - 1 * 86_400_000, bundleId: 'y', appName: 'Y', signals: [] })
    expect(ctx.store.pruneActivity(14, now)).toBe(1)
    expect(ctx.store.stats().events).toBe(1)
  })

  it('protects built-in exclusions', () => {
    ctx = tempDb()
    const builtIn = ctx.store.listExclusions().find((r) => r.value === 'com.1password.1password')!
    expect(builtIn.builtIn).toBe(true)
    expect(() => ctx.store.removeExclusion(builtIn.id)).toThrow(/Built-in/)
    const mine = ctx.store.addExclusion('urlHost', 'bank.example.com')
    ctx.store.removeExclusion(mine.id)
    expect(ctx.store.listExclusions().some((r) => r.value === 'bank.example.com')).toBe(false)
  })

  it('exports into its own data dir and deletes everything on request', () => {
    ctx = tempDb()
    ctx.store.createProject('Exported')
    const path = exportToDataDir(ctx.store, ctx.dir)
    expect(path.startsWith(join(ctx.dir, 'exports'))).toBe(true)
    const json = JSON.parse(readFileSync(path, 'utf8'))
    expect(json.projects[0].name).toBe('Exported')
    ctx.store.deleteAll()
    expect(ctx.store.stats()).toMatchObject({ projects: 0, checkpoints: 0, events: 0 })
    expect(ctx.store.listExclusions().filter((r) => r.builtIn).length).toBeGreaterThan(10)
    expect(ctx.store.listAudit().map((a) => a.action)).toEqual(['delete-all'])
  })

  it('derives project signals from its chosen apps and pinned items, keeping learned ones', () => {
    ctx = tempDb()
    const p = ctx.store.createProject('Atlas', ['repo:/r/atlas'])
    const e = ctx.store.updateProject(p.id, {
      apps: [
        {
          bundleId: 'com.google.Chrome',
          name: 'Google Chrome',
          items: [{ kind: 'url', url: 'https://acme.atlassian.net/browse/ATL-1' }],
        },
        {
          bundleId: 'com.microsoft.VSCode',
          name: 'Visual Studio Code',
          items: [{ kind: 'folder', path: '/r/atlas-web' }],
        },
      ],
    })
    expect(e.apps).toHaveLength(2)
    expect(e.signals.sort()).toEqual([
      'app:com.google.Chrome',
      'app:com.microsoft.VSCode',
      'host:acme.atlassian.net',
      'path:/r/atlas-web',
      'repo:/r/atlas',
    ])
    // Removing an app removes what it contributed, but not the learned signal.
    const e2 = ctx.store.updateProject(p.id, { apps: [] })
    expect(e2.signals).toEqual(['repo:/r/atlas'])
  })
})
