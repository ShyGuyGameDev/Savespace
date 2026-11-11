import { afterEach, describe, expect, it } from 'vitest'
import {
  computeSuggestions,
  nameFromSignal,
  type EventLite,
} from '../../src/main/inference/suggest'
import { InferenceService } from '../../src/main/inference/service'
import { tempDb } from '../helpers/db'

const HOME = '/Users/me'
const T0 = Date.UTC(2026, 10, 1, 9)
const ev = (
  min: number,
  signals: string[],
  projectId: string | null = null,
  windowTitle: string | null = null,
): EventLite => ({ at: T0 + min * 60_000, signals, projectId, windowTitle })
const base = { color: '', createdAt: 0, updatedAt: 0, lastCheckpointAt: null, archived: false }

let ctx: ReturnType<typeof tempDb>
afterEach(() => ctx?.cleanup())

describe('computeSuggestions', () => {
  it('never proposes merges or splits (only new projects)', () => {
    const projects = [
      { ...base, id: 'a', name: 'A', signals: ['repo:/a'] },
      { ...base, id: 'b', name: 'B', signals: ['repo:/b'] },
    ]
    const events = [0, 30, 60, 90].flatMap((m) => [
      ev(m, ['repo:/a'], 'a'),
      ev(m + 2, ['repo:/b'], 'b'),
    ])
    expect(computeSuggestions(events, projects, HOME).every((s) => s.kind === 'new-project')).toBe(
      true,
    )
  })

  it('proposes a project from a recurring repo with co-occurring tools', () => {
    const events = [
      ev(0, ['repo:/Users/me/code/atlas']),
      ev(1, ['host:acme.atlassian.net', 'token:atlas']),
      ev(2, ['repo:/Users/me/code/atlas']),
      ev(60, ['repo:/Users/me/code/atlas']),
      ev(61, ['host:acme.atlassian.net']),
      ev(200, ['repo:/Users/me/code/atlas'], null, 'server.ts — atlas'),
      ev(300, ['host:news.example.com']), // one-off, ignored
    ]
    const s = computeSuggestions(events, [], HOME)
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({
      kind: 'new-project',
      name: 'Atlas',
      signals: ['repo:/Users/me/code/atlas', 'host:acme.atlassian.net'],
    })
    expect(s[0]!.evidence.join(' ')).toMatch(/Seen in 4 samples over 3 sessions/)
  })

  it('ignores broad folders and signals already covered by a project', () => {
    const events = [0, 30, 60, 90].flatMap((m) => [
      ev(m, [`path:${HOME}/Documents`]),
      ev(m + 1, ['repo:/Users/me/code/atlas/sub']),
    ])
    expect(
      computeSuggestions(
        events,
        [{ ...base, id: 'p', name: 'Atlas', signals: ['repo:/Users/me/code/atlas'] }],
        HOME,
      ),
    ).toEqual([])
  })

  it('names suggestions readably', () => {
    expect(nameFromSignal('repo:/Users/me/code/my-cool_app')).toBe('My Cool App')
    expect(nameFromSignal('host:app.acme-corp.com')).toBe('Acme Corp')
  })
})

describe('InferenceService', () => {
  it('stores pending suggestions, never resurrects dismissed ones, and only creates projects on accept', async () => {
    ctx = tempDb()
    for (const m of [0, 1, 30, 60])
      ctx.store.addActivity({
        at: Date.now() - 3600_000 + m * 60_000,
        bundleId: 'code',
        appName: 'Code',
        signals: ['repo:/Users/me/code/atlas'],
      })
    const svc = new InferenceService(ctx.store, HOME)
    await svc.refresh()
    const [s] = ctx.store.listSuggestions()
    expect(s?.name).toBe('Atlas')
    expect(ctx.store.listProjects()).toHaveLength(0) // nothing created without confirmation
    ctx.store.setSuggestionStatus(s!.id, 'dismissed')
    await svc.refresh()
    expect(ctx.store.listSuggestions()).toHaveLength(0)
  })

  it('accepting creates the project (with a custom name) and adopts matching unassigned checkpoints', async () => {
    ctx = tempDb()
    for (const m of [0, 1, 30, 60])
      ctx.store.addActivity({
        at: Date.now() - 3600_000 + m * 60_000,
        bundleId: 'code',
        appName: 'Code',
        signals: ['repo:/Users/me/code/atlas'],
      })
    ctx.store.createCheckpoint({
      projectId: null,
      trigger: 'manual',
      summary: '',
      summarySource: 'template',
      resources: [
        {
          kind: 'gitState',
          app: 'git',
          repoPath: '/Users/me/code/atlas',
          branch: 'main',
          dirtyFiles: 1,
        },
      ],
    })
    const svc = new InferenceService(ctx.store, HOME)
    await svc.refresh()
    svc.accept(ctx.store.listSuggestions()[0]!.id, 'Atlas (client)')
    const [p] = ctx.store.listProjects()
    expect(p?.name).toBe('Atlas (client)')
    expect(ctx.store.listCheckpoints({ projectId: p!.id })).toHaveLength(1)
    expect(() => svc.accept(ctx.store.listSuggestions('accepted')[0]!.id)).toThrow(
      /no longer pending/,
    )
  })
})
