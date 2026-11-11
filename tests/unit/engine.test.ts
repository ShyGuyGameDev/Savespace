import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/constants'
import { AdapterRegistry } from '../../src/main/adapters/registry'
import type { AppAdapter } from '../../src/main/adapters/types'
import { CaptureEngine } from '../../src/main/capture/engine'
import { GitInspector } from '../../src/main/capture/git'
import { buildRules } from '../../src/main/capture/privacy-filter'
import { CheckpointService } from '../../src/main/checkpoints/service'
import { SafeExec } from '../../src/main/safe-exec'
import { TemplateSummarizer } from '../../src/main/summarizer/template'
import { tempDb } from '../helpers/db'

let ctx: ReturnType<typeof tempDb>
afterEach(() => ctx?.cleanup())

const exec = new SafeExec(async () => ({ stdout: '', stderr: 'not allowed in test', code: 1 }), {
  resolve: (id) => `/bin/${id}`,
})

const fakeBrowser: AppAdapter = {
  id: 'fake-browser',
  displayName: 'Fake',
  bundleIds: ['com.google.Chrome'],
  tier: 'deep',
  needsAutomation: true,
  notes: '',
  capture: async () => [
    {
      kind: 'url',
      app: 'com.google.Chrome',
      url: 'https://acme.atlassian.net/browse/WP-1?token=secret',
      title: 'WP-1',
      focused: true,
    },
    { kind: 'url', app: 'com.google.Chrome', url: 'https://youtube.com/watch?v=x', title: 'Music' },
  ],
  restore: async () => [],
  isRunning: async () => true,
  alreadyOpen: async () => false,
  describe: () => ({ action: 'open', description: '' }),
}

function makeEngine() {
  return new CaptureEngine({
    exec,
    registry: new AdapterRegistry([fakeBrowser]),
    getSettings: () => DEFAULT_SETTINGS,
    getRules: () => buildRules(ctx.store.listExclusions()),
    accessibility: () => true,
    noteAutomation: () => {},
    tempDir: '/tmp',
    homeDir: '/Users/me',
    git: new GitInspector(exec, (p) => p === '/Users/me/code/wp/.git'),
    readSystem: async () => ({
      windowsReadable: true,
      processesReadable: true,
      automationDenied: false,
      front: { bundleId: 'com.microsoft.VSCode', name: 'Code' },
      apps: [
        {
          name: 'Code',
          bundleId: 'com.microsoft.VSCode',
          pid: 1,
          frontmost: true,
          windows: [
            {
              title: 'a.ts — wp',
              position: [0, 25],
              size: [1200, 800],
              document: 'file:///Users/me/code/wp/src/a.ts',
            },
          ],
        },
        {
          name: 'Google Chrome',
          bundleId: 'com.google.Chrome',
          pid: 2,
          frontmost: false,
          windows: [{ title: 'WP-1', position: [10, 30], size: [900, 700], document: null }],
        },
        {
          name: '1Password',
          bundleId: 'com.1password.1password',
          pid: 3,
          frontmost: false,
          windows: [{ title: 'Vault', position: [0, 0], size: [10, 10], document: null }],
        },
        {
          name: 'Waypoint',
          bundleId: 'app.waypoint.desktop',
          pid: 4,
          frontmost: false,
          windows: [{ title: 'Waypoint', position: [0, 0], size: [10, 10], document: null }],
        },
      ],
    }),
  })
}

describe('capture engine', () => {
  it('builds a metadata snapshot, excluding password managers and itself, sanitizing URLs', async () => {
    ctx = tempDb()
    const snap = await makeEngine().snapshot()
    const apps = new Set(snap.refs.map((r) => r.app))
    expect(apps.has('com.1password.1password')).toBe(false)
    expect(apps.has('app.waypoint.desktop')).toBe(false)
    expect(snap.refs).toContainEqual(
      expect.objectContaining({ kind: 'file', path: '/Users/me/code/wp/src/a.ts', focused: true }),
    )
    expect(snap.refs).toContainEqual(
      expect.objectContaining({
        kind: 'windowFrame',
        app: 'com.google.Chrome',
        frame: { x: 10, y: 30, w: 900, h: 700 },
      }),
    )
    expect(snap.refs).toContainEqual(
      expect.objectContaining({ kind: 'url', url: 'https://acme.atlassian.net/browse/WP-1' }),
    )
  })

  it('samples the front app with repo signals', async () => {
    ctx = tempDb()
    const s = await makeEngine().sample()
    expect(s?.bundleId).toBe('com.microsoft.VSCode')
    expect(s?.signals).toContain('repo:/Users/me/code/wp')
  })

  it('creates a project-scoped checkpoint with a template summary', async () => {
    ctx = tempDb()
    const p = ctx.store.createProject('WP', ['repo:/Users/me/code/wp', 'host:acme.atlassian.net'])
    const svc = new CheckpointService({
      store: ctx.store,
      engine: makeEngine(),
      summarizer: new TemplateSummarizer(),
    })
    const cp = await svc.create('manual', p.id)
    expect(cp?.projectId).toBe(p.id)
    const urls = cp!.resources
      .filter((r) => r.kind === 'url')
      .map((r) => (r as { url: string }).url)
    expect(urls).toEqual(['https://acme.atlassian.net/browse/WP-1'])
    expect(cp!.summary).toMatch(/You were working on WP, editing a\.ts/)
    expect(ctx.store.listAudit()[0]?.action).toBe('capture')
    // Identical automatic checkpoint is skipped.
    expect(await svc.create('idle', p.id)).toBeNull()
  })

  it('infers the project when none is given', async () => {
    ctx = tempDb()
    const p = ctx.store.createProject('WP', ['repo:/Users/me/code/wp'])
    const svc = new CheckpointService({
      store: ctx.store,
      engine: makeEngine(),
      summarizer: new TemplateSummarizer(),
    })
    const cp = await svc.create('manual')
    expect(cp?.projectId).toBe(p.id)
  })
})
