import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/constants'
import type { Checkpoint, ResourceRef } from '@shared/schemas'
import { AdapterRegistry } from '../../src/main/adapters/registry'
import { arrangeAdapter, gitAdapter } from '../../src/main/adapters/special'
import type { AppAdapter } from '../../src/main/adapters/types'
import { result } from '../../src/main/adapters/util'
import { orderRefs, RestoreEngine } from '../../src/main/restore/engine'
import { SafeExec } from '../../src/main/safe-exec'

const calls: string[] = []
const exec = new SafeExec(
  async (file, args) => {
    calls.push([file, ...args].join(' '))
    if (file.endsWith('osascript')) return { stdout: '{"running":false}', stderr: '', code: 0 }
    return { stdout: '', stderr: '', code: 0 }
  },
  { resolve: (id) => `/bin/${id}` },
)

const flaky: AppAdapter = {
  id: 'flaky',
  displayName: 'Flaky',
  bundleIds: ['com.flaky'],
  tier: 'deep',
  needsAutomation: false,
  notes: '',
  handles: (r) => r.app === 'com.flaky' && r.kind === 'url',
  capture: async () => [],
  isRunning: async () => true,
  alreadyOpen: async () => false,
  describe: () => ({ action: 'open', description: 'open' }),
  restore: async (refs) => {
    const r = refs[0]!
    if (r.kind === 'url' && r.url.includes('boom')) throw new Error('kaboom')
    return [
      result(r, 'flaky', r.kind === 'url' && r.url.includes('dup') ? 'already-open' : 'opened'),
    ]
  },
}

const cp = (resources: ResourceRef[]): Checkpoint => ({
  id: 'cp1',
  projectId: null,
  createdAt: 0,
  trigger: 'manual',
  summary: '',
  summarySource: 'template',
  resources,
})

function engine(settings = DEFAULT_SETTINGS) {
  return new RestoreEngine({
    exec,
    registry: new AdapterRegistry([arrangeAdapter, gitAdapter, flaky]),
    getSettings: () => settings,
    readWindows: async () => [],
    sleep: async () => {},
  })
}

describe('restore engine', () => {
  it('orders apps first, then resources, then window frames', () => {
    const refs: ResourceRef[] = [
      { kind: 'windowFrame', app: 'a.b', windowTitle: 't', frame: { x: 0, y: 0, w: 1, h: 1 } },
      { kind: 'url', app: 'a.b', url: 'https://x.test' },
      { kind: 'file', app: 'a.b', path: '/x' },
      { kind: 'app', app: 'a.b' },
      { kind: 'workspace', app: 'a.b', path: '/w' },
    ]
    expect(orderRefs(refs).map((r) => r.kind)).toEqual([
      'app',
      'workspace',
      'file',
      'url',
      'windowFrame',
    ])
  })

  it('isolates failures per item and reports every item', async () => {
    const e = engine()
    const c = cp([
      { kind: 'url', app: 'com.flaky', url: 'https://ok.test' },
      { kind: 'url', app: 'com.flaky', url: 'https://boom.test' },
      { kind: 'url', app: 'com.flaky', url: 'https://dup.test' },
      { kind: 'gitState', app: 'git', repoPath: '/r', branch: 'main', dirtyFiles: 2 },
      {
        kind: 'windowFrame',
        app: 'com.flaky',
        windowTitle: 'w',
        frame: { x: 1, y: 2, w: 3, h: 4 },
      },
    ])
    const report = await e.execute('run1', e.plan(c), new Set())
    expect(report.results.map((r) => [r.status, r.reason ?? ''])).toEqual([
      ['opened', ''],
      ['failed', 'kaboom'],
      ['already-open', ''],
      ['skipped', 'For context only. Savespace never changes branches.'],
      ['skipped', 'Arrange windows is off (Settings → Restore)'],
    ])
    expect(report.finishedAt).toBeDefined()
  })

  it('honours unchecked items and cancel', async () => {
    const e = engine()
    const c = cp(
      [1, 2, 3].map((i) => ({
        kind: 'url' as const,
        app: 'com.flaky',
        url: `https://ok${i}.test`,
      })),
    )
    const plan = e.plan(c)
    const skipped = await e.execute('r2', plan, new Set([1]))
    expect(skipped.results.map((r) => r.status)).toEqual(['opened', 'skipped', 'opened'])
    const e2 = new RestoreEngine({
      exec,
      registry: new AdapterRegistry([flaky]),
      getSettings: () => DEFAULT_SETTINGS,
      readWindows: async () => [],
      sleep: async () => {},
      onProgress: (r) => {
        if (r.results.length === 1) e2.cancel('r3')
      },
    })
    const cancelled = await e2.execute('r3', e2.plan(c), new Set())
    expect(cancelled.results.map((r) => r.status)).toEqual(['opened', 'cancelled', 'cancelled'])
    expect(cancelled.cancelled).toBe(true)
  })

  it('arranges windows only when the setting is on', async () => {
    calls.length = 0
    const on = { ...DEFAULT_SETTINGS, arrangeWindows: true }
    // SafeExec itself refuses arrange templates unless its canArrange hook says the setting is on.
    const blocked = await engine(on).execute(
      'r4a',
      engine(on).plan(
        cp([
          {
            kind: 'windowFrame',
            app: 'com.flaky',
            windowTitle: 'Doc',
            frame: { x: 10, y: 20, w: 300, h: 200 },
          },
        ]),
      ),
      new Set(),
    )
    expect(blocked.results[0]?.reason).toMatch(/Arrange windows is turned off/)
    const execOn = new SafeExec(
      async (file, args) => {
        calls.push([file, ...args].join(' '))
        return { stdout: '{"ok":true}', stderr: '', code: 0 }
      },
      { resolve: (id) => `/bin/${id}`, canArrange: () => true },
    )
    const e = new RestoreEngine({
      exec: execOn,
      registry: new AdapterRegistry([arrangeAdapter]),
      getSettings: () => on,
      readWindows: async () => [],
      sleep: async () => {},
    })
    const plan = e.plan(
      cp([
        {
          kind: 'windowFrame',
          app: 'com.flaky',
          windowTitle: 'Doc',
          frame: { x: 10, y: 20, w: 300, h: 200 },
        },
      ]),
    )
    expect(plan.items[0]?.action).toBe('arrange')
    const r = await e.execute('r4', plan, new Set())
    expect(
      calls.some((c) => c.includes('osascript') && c.endsWith('com.flaky Doc 10 20 300 200')),
    ).toBe(true)
    expect(r.results[0]?.status).toBe('opened')
  })

  it('falls back to the generic adapter for unknown apps (launch/focus only)', async () => {
    calls.length = 0
    const e = engine()
    const r = await e.execute(
      'r5',
      e.plan(cp([{ kind: 'app', app: 'com.example.Unknown', title: 'Unknown' }])),
      new Set(),
    )
    expect(r.results[0]).toMatchObject({
      status: 'opened',
      adapterId: 'generic:com.example.Unknown',
    })
    expect(calls).toContain('/bin/open -b com.example.Unknown --')
  })
})

describe('registry routing', () => {
  it('routes app entries to the generic launcher even when a deep adapter exists', async () => {
    const { allAdapters } = await import('../../src/main/adapters')
    const reg = new AdapterRegistry(allAdapters())
    expect(
      reg
        .forRef({ kind: 'app', app: 'com.microsoft.VSCode' })
        .describe({ kind: 'app', app: 'com.microsoft.VSCode' }).action,
    ).toBe('launch')
    expect(reg.forRef({ kind: 'file', app: 'com.microsoft.VSCode', path: '/x' }).id).toBe('vscode')
  })

  it('skips apps whose reopening is turned off on the Apps page', () => {
    const e = engine({ ...DEFAULT_SETTINGS, appsRestoreOff: ['flaky'] })
    const plan = e.plan(cp([{ kind: 'url', app: 'com.flaky', url: 'https://x.test' }]))
    expect(plan.items[0]).toMatchObject({
      action: 'skip',
      reason: 'Reopening Flaky is turned off (Apps page)',
    })
  })

  it('reopens items pinned to the project, even if the checkpoint does not have them', () => {
    const project = {
      id: 'p',
      name: 'P',
      color: '',
      signals: [],
      createdAt: 0,
      updatedAt: 0,
      lastCheckpointAt: null,
      archived: false,
      onlyApps: true,
      apps: [
        {
          bundleId: 'com.flaky',
          name: 'Flaky',
          items: [
            { kind: 'url' as const, url: 'https://pinned.test/x' },
            { kind: 'url' as const, url: 'https://already.test/' },
          ],
        },
      ],
    }
    const e = new RestoreEngine({
      exec,
      registry: new AdapterRegistry([flaky]),
      getSettings: () => DEFAULT_SETTINGS,
      readWindows: async () => [],
      sleep: async () => {},
      getProject: () => project,
    })
    const plan = e.plan({
      ...cp([{ kind: 'url', app: 'com.flaky', url: 'https://already.test/' }]),
      projectId: 'p',
    })
    const opened = plan.items.flatMap((i) =>
      i.ref.kind === 'url' ? [i.ref.url] : i.ref.kind === 'app' ? [`app:${i.ref.app}`] : [],
    )
    expect(opened).toEqual(['app:com.flaky', 'https://already.test/', 'https://pinned.test/x'])
  })

  it('Only restore these apps: skips other apps but keeps captured items from chosen apps', () => {
    const project = {
      id: 'p',
      name: 'Atlas',
      color: '',
      signals: [],
      createdAt: 0,
      updatedAt: 0,
      lastCheckpointAt: null,
      archived: false,
      onlyApps: true,
      apps: [
        {
          bundleId: 'com.flaky',
          name: 'Flaky',
          items: [{ kind: 'url' as const, url: 'https://pinned.test/' }],
        },
      ],
    }
    const make = (p: typeof project) =>
      new RestoreEngine({
        exec,
        registry: new AdapterRegistry([flaky]),
        getSettings: () => DEFAULT_SETTINGS,
        readWindows: async () => [],
        sleep: async () => {},
        getProject: () => p,
      })
    const checkpoint = {
      ...cp([
        { kind: 'url', app: 'com.flaky', url: 'https://pinned.test/' },
        { kind: 'url', app: 'com.flaky', url: 'https://other.test/' },
        { kind: 'app', app: 'com.spotify', title: 'Spotify' },
      ]),
      projectId: 'p',
    }
    const actions = (e: RestoreEngine) =>
      e
        .plan(checkpoint)
        .items.map((i) => [i.ref.kind === 'url' ? i.ref.url : i.ref.app, i.action, i.reason ?? ''])
    const on = actions(make(project))
    expect(on).toContainEqual(['https://pinned.test/', 'open', ''])
    expect(on.find((x) => x[0] === 'https://other.test/')?.[1]).toBe('open')
    expect(on.find((x) => x[0] === 'com.spotify')?.[2]).toMatch(/Not one of Atlas’s apps/)
    const off = actions(make({ ...project, onlyApps: false }))
    expect(off.every((x) => x[1] !== 'skip' || !/Not one of/.test(String(x[2])))).toBe(true)
  })
})
