/**
 * Talks to the REAL Apple on-device model through Savespace's helper (no download).
 * Skips cleanly if the helper isn't built or this Mac doesn't have Apple Intelligence.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerAppleAiHelper } from '../../src/main/safe-exec/allowlist'
import { SafeExec } from '../../src/main/safe-exec'
import { AppleSummarizer } from '../../src/main/summarizer/apple'

const HELPER = resolve(__dirname, '../../resources/apple-ai/savespace-apple-ai')

describe.skipIf(!existsSync(HELPER))('Apple on-device AI (real)', () => {
  it('reports availability and, if available, writes an accurate recap', async () => {
    registerAppleAiHelper(HELPER)
    const apple = new AppleSummarizer(new SafeExec(), () => true)
    const st = await apple.status(true)
    console.log(`[apple-ai] status: ${JSON.stringify(st)}`)
    if (!st.available) return
    const t0 = Date.now()
    const text = await apple.summarize({
      project: {
        id: 'p',
        name: 'Atlas API',
        color: '',
        signals: [],
        createdAt: 0,
        updatedAt: 0,
        lastCheckpointAt: null,
        archived: false,
      },
      trigger: 'idle',
      at: Date.now(),
      recentTitles: [],
      refs: [
        {
          kind: 'file',
          app: 'com.microsoft.VSCode',
          path: '/Users/me/atlas-api/src/server.ts',
          line: 42,
          focused: true,
        },
        {
          kind: 'gitState',
          app: 'git',
          repoPath: '/Users/me/atlas-api',
          branch: 'feature/rate-limits',
          dirtyFiles: 3,
        },
      ],
    })
    console.log(`[apple-ai] ${Date.now() - t0} ms: ${text}`)
    expect(text).toMatch(/server\.ts/)
    expect(text).toMatch(/rate-limits/)
  }, 60_000)
})

describe.skipIf(!existsSync(HELPER))('Apple on-device AI judges relevance (real)', () => {
  it('keeps work-related in-use items and drops unrelated ones', async () => {
    const { selectRelevant } = await import('../../src/main/checkpoints/relevance')
    registerAppleAiHelper(HELPER)
    const apple = new AppleSummarizer(new SafeExec(), () => true)
    if (!(await apple.status(true)).available) return
    const ask = async (i: string, p: string) => {
      const t = await apple.ask(i, p)
      return t ? { text: t, source: 'apple' as const } : null
    }
    const project = {
      id: 'p',
      name: 'Atlas API',
      color: '',
      signals: ['repo:/r/atlas', 'host:acme.atlassian.net'],
      createdAt: 0,
      updatedAt: 0,
      lastCheckpointAt: null,
      archived: false,
    }
    const refs = [
      {
        kind: 'file' as const,
        app: 'com.microsoft.VSCode',
        path: '/r/atlas/src/limiter.ts',
        focused: true,
      },
      {
        kind: 'url' as const,
        app: 'com.google.Chrome',
        url: 'https://acme.atlassian.net/browse/ATL-212',
        title: 'ATL-212 Rate limit the public API',
      },
      {
        kind: 'url' as const,
        app: 'com.google.Chrome',
        url: 'https://stackoverflow.com/q/123',
        title: 'How to implement a token bucket rate limiter in Node.js',
      },
      {
        kind: 'url' as const,
        app: 'com.google.Chrome',
        url: 'https://www.youtube.com/watch?v=abc',
        title: 'lofi hip hop radio - beats to relax/study to',
      },
      {
        kind: 'url' as const,
        app: 'com.google.Chrome',
        url: 'https://www.amazon.com/dp/B0',
        title: 'Ergonomic Desk Lamp with USB Charging',
      },
      {
        kind: 'url' as const,
        app: 'com.google.Chrome',
        url: 'https://redis.io/docs/latest/develop/data-types/',
        title: 'Redis data types | Docs',
      },
      { kind: 'app' as const, app: 'com.tinyspeck.slackmacgap', title: 'Slack' },
    ]
    const events = refs.map((r) => ({
      at: 0,
      bundleId: r.app,
      appName: r.app,
      windowTitle: r.kind === 'app' ? 'atlas-api-dev (Channel) - Acme' : null,
      ref: r.kind === 'app' ? null : r,
    }))
    const t0 = Date.now()
    const r = await selectRelevant({
      refs,
      project,
      events,
      repoRootOf: (p) => (p.startsWith('/r/atlas') ? '/r/atlas' : null),
      ask,
    })
    const kept = r.kept.map((x) => x.title ?? ('path' in x ? x.path : ''))
    console.log(
      `[apple-relevance] ${Date.now() - t0} ms, judged by ${r.judgedBy}\n  kept: ${kept.join(' | ')}\n  dropped: ${r.dropped.map((d) => `${d.ref.title} (${d.why})`).join(' | ')}`,
    )
    expect(kept).toContain('How to implement a token bucket rate limiter in Node.js')
    expect(kept).toContain('Slack')
    expect(kept).toContain('Redis data types | Docs')
    expect(kept).not.toContain('Ergonomic Desk Lamp with USB Charging')
    expect(kept).not.toContain('lofi hip hop radio - beats to relax/study to')
  }, 90_000)
})
