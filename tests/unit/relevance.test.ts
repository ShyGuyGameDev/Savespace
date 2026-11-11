import { describe, expect, it } from 'vitest'
import type { Project, ResourceRef } from '@shared/schemas'
import { parseNumbers, selectRelevant, type UsageEvent } from '../../src/main/checkpoints/relevance'

const project: Project = {
  id: 'p',
  name: 'Atlas API',
  color: '',
  signals: ['repo:/r/atlas', 'host:acme.atlassian.net'],
  createdAt: 0,
  updatedAt: 0,
  lastCheckpointAt: null,
  archived: false,
}
const root = (p: string) => (p.startsWith('/r/atlas') ? '/r/atlas' : null)
const refs: ResourceRef[] = [
  { kind: 'app', app: 'code', title: 'Code' },
  { kind: 'file', app: 'code', path: '/r/atlas/src/server.ts', focused: true },
  { kind: 'gitState', app: 'git', repoPath: '/r/atlas', branch: 'main', dirtyFiles: 1 },
  { kind: 'app', app: 'chrome', title: 'Chrome' },
  {
    kind: 'url',
    app: 'chrome',
    url: 'https://acme.atlassian.net/browse/ATL-1',
    title: 'ATL-1 Rate limits',
  },
  {
    kind: 'url',
    app: 'chrome',
    url: 'https://stackoverflow.com/q/1',
    title: 'Token bucket in Node.js',
  },
  { kind: 'url', app: 'chrome', url: 'https://youtube.com/watch?v=x', title: 'Lo-fi beats' },
  { kind: 'url', app: 'chrome', url: 'https://amazon.com/dp/1', title: 'Desk lamp' },
  { kind: 'windowFrame', app: 'chrome', windowTitle: 'x', frame: { x: 0, y: 0, w: 1, h: 1 } },
  { kind: 'app', app: 'spotify', title: 'Spotify' },
  { kind: 'app', app: 'slack', title: 'Slack' },
]
const ev = (
  bundleId: string,
  ref?: ResourceRef,
  windowTitle: string | null = null,
): UsageEvent => ({ at: 0, bundleId, appName: bundleId, windowTitle, ref: ref ?? null })
const events: UsageEvent[] = [
  ev('code', refs[1]),
  ev('code', refs[1]),
  ev('chrome', refs[5]),
  ev('chrome', refs[6]),
  ev('slack', undefined, 'atlas-dev'),
]
const urls = (rs: ResourceRef[]) =>
  rs.flatMap((r) => (r.kind === 'url' ? [r.title] : r.kind === 'app' ? [`app:${r.title}`] : []))

describe('in-use + relevance selection', () => {
  it('without AI: keeps project items and anything in use, drops unused items and apps', async () => {
    const r = await selectRelevant({ refs, project, events, repoRootOf: root })
    expect(urls(r.kept)).toEqual([
      'app:Code',
      'app:Chrome',
      'ATL-1 Rate limits',
      'Token bucket in Node.js',
      'Lo-fi beats',
      'app:Slack',
    ])
    expect(r.dropped.map((d) => [d.why, d.ref.title])).toEqual([
      ['not-used', 'Desk lamp'],
      ['not-used', 'Spotify'],
    ])
    expect(r.kept.some((x) => x.kind === 'gitState')).toBe(true)
    expect(r.judgedBy).toBeNull()
  })

  it('with AI: asks only about in-use items that are not clearly part of the project, and drops the unrelated ones', async () => {
    let prompt = ''
    const ask = async (_i: string, p: string) => {
      prompt = p
      return { text: '2', source: 'apple' as const } // item 2 (the music video) is clearly unrelated
    }
    const r = await selectRelevant({ refs, project, events, repoRootOf: root, ask })
    expect(prompt).toMatch(/Project "Atlas API"/)
    expect(prompt).toMatch(/3\. \[app\] Slack showing "atlas-dev"/)
    expect(prompt).toMatch(/1\. \[chrome tab\] Token bucket in Node\.js \(stackoverflow\.com\)/)
    expect(prompt).toMatch(/It includes: .*ATL-1 Rate limits/) // project items describe the work…
    const list = prompt.split('Items:')[1]!
    expect(list).not.toMatch(/ATL-1|Desk lamp/) // …but aren't judged; unused items are already out
    expect(urls(r.kept)).toEqual([
      'app:Code',
      'app:Chrome',
      'ATL-1 Rate limits',
      'Token bucket in Node.js',
      'app:Slack',
    ])
    expect(r.dropped.find((d) => d.ref.title === 'Lo-fi beats')?.why).toBe('unrelated')
    expect(r.judgedBy).toBe('apple')
  })

  it('keeps what was in use if the AI gives an unusable answer', async () => {
    const r = await selectRelevant({
      refs,
      project,
      events,
      repoRootOf: root,
      ask: async () => ({ text: 'I am not sure.', source: 'ollama' as const }),
    })
    expect(urls(r.kept)).toContain('Lo-fi beats')
    expect(r.judgedBy).toBeNull()
  })

  it('with no project, the most-used item defines the work and anchors the AI question', async () => {
    let prompt = ''
    const r = await selectRelevant({
      refs,
      project: null,
      events,
      repoRootOf: () => null,
      ask: async (_i, p) => ((prompt = p), { text: '1, 2, 3, 4', source: 'apple' as const }),
    })
    expect(prompt).toMatch(/mainly doing: \[code file\] src\/server\.ts/)
    expect(urls(r.kept)).toEqual(['app:Code'])
    const none = await selectRelevant({
      refs,
      project: null,
      events,
      repoRootOf: () => null,
      ask: async () => ({ text: 'NONE', source: 'apple' as const }),
    })
    expect(urls(none.kept)).toContain('Token bucket in Node.js') // NONE = nothing unrelated
  })

  it('treats everything open as a candidate when there is too little history to judge use', async () => {
    const r = await selectRelevant({ refs, project, events: [], repoRootOf: root })
    expect(urls(r.kept)).toContain('Desk lamp')
  })

  it('parses AI answers', () => {
    expect([...parseNumbers('2, 5, 6', 6)!]).toEqual([2, 5, 6])
    expect([...parseNumbers('Items 1 and 3 belong.', 4)!]).toEqual([1, 3])
    expect(parseNumbers('NONE', 4)!.size).toBe(0)
    expect(parseNumbers('no idea', 4)).toBeNull()
    expect([...parseNumbers('9, 2', 3)!]).toEqual([2])
  })
})
