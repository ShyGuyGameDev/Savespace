import { describe, expect, it } from 'vitest'
import type { SummaryInput } from '../../src/main/summarizer/types'
import {
  cleanSummary,
  cosine,
  factSheet,
  OllamaSummarizer,
  recommendModel,
  SYSTEM_PROMPT,
  type Fetcher,
} from '../../src/main/summarizer/ollama'
import { templateSummary } from '../../src/main/summarizer/template'
import { dedupeWithEmbeddings } from '../../src/main/inference/service'
import { guardedFetch } from '../../src/main/net'

const input: SummaryInput = {
  project: {
    id: 'p',
    name: 'Savespace',
    color: '',
    signals: [],
    createdAt: 0,
    updatedAt: 0,
    lastCheckpointAt: null,
    apps: [],
    onlyApps: true,
    archived: false,
  },
  trigger: 'idle',
  at: Date.UTC(2026, 10, 10, 17, 30),
  recentTitles: ['engine.ts — savespace'],
  refs: [
    {
      kind: 'file',
      app: 'com.microsoft.VSCode',
      path: '/Users/me/savespace/src/restore/engine.ts',
      line: 120,
      focused: true,
    },
    {
      kind: 'file',
      app: 'com.microsoft.VSCode',
      path: '/Users/me/savespace/src/adapters/index.ts',
    },
    {
      kind: 'gitState',
      app: 'git',
      repoPath: '/Users/me/savespace',
      branch: 'feature/restore',
      dirtyFiles: 3,
    },
    {
      kind: 'url',
      app: 'com.google.Chrome',
      url: 'https://linear.app/acme/issue/WP-9',
      title: 'WP-9 Restore preview',
    },
    { kind: 'draft', app: 'com.apple.mail', messageId: 'x@y', subject: 'Status update' },
  ],
}

const fakeFetch = (
  handler: (url: string, body: unknown) => { status?: number; json: unknown },
): Fetcher =>
  (async (url: string, init?: RequestInit) => {
    const r = handler(url, init?.body ? JSON.parse(String(init.body)) : undefined)
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 })
  }) as Fetcher

describe('template summary', () => {
  it('writes 2-3 sentences of state only', () => {
    const t = templateSummary(input)
    expect(t).toMatch(
      /^You were working on Savespace, with engine\.ts in focus around line 120 with index\.ts also open\./,
    )
    expect(t).toMatch(/feature\/restore branch of savespace had 3 uncommitted changes/)
    expect(t.match(/[.!?](\s|$)/g)!.length).toBeLessThanOrEqual(3)
    expect(t).not.toMatch(/next step|should|decid|question/i)
  })
})

describe('ollama summarizer', () => {
  it('sends metadata only to the local model and cleans the answer', async () => {
    let sent:
      | {
          model: string
          stream: boolean
          messages: { role: string; content: string }[]
          options: Record<string, number>
        }
      | undefined
    const s = new OllamaSummarizer(
      () => 'llama3.2:3b',
      () => true,
      fakeFetch((url, body) => {
        expect(url).toBe('http://127.0.0.1:52123/api/chat')
        sent = body as typeof sent
        return {
          json: {
            message: {
              role: 'assistant',
              content:
                '"You were refining the restore engine in Savespace, with engine.ts open at line 120. The feature/restore branch had three uncommitted files and the WP-9 ticket was open. Next, you should add tests."',
            },
          },
        }
      }),
      () => 'http://127.0.0.1:52123',
    )
    const r = await s.summarize(input)
    expect(r.source).toBe('ollama')
    expect(r.text).toBe(
      'You were refining the restore engine in Savespace, with engine.ts open at line 120. The feature/restore branch had three uncommitted files and the WP-9 ticket was open.',
    )
    expect(sent?.stream).toBe(false)
    expect(sent?.model).toBe('llama3.2:3b')
    expect(sent?.messages[0]?.content).toBe(SYSTEM_PROMPT)
    expect(sent?.messages[1]?.content).toContain('engine.ts (line 120)" (focused)')
  })

  it('falls back to the template when Ollama is down, slow, malformed or disabled', async () => {
    const down = new OllamaSummarizer(
      () => 'x',
      () => true,
      (async () => {
        throw new Error('ECONNREFUSED')
      }) as Fetcher,
    )
    expect((await down.summarize(input)).source).toBe('template')
    const bad = new OllamaSummarizer(
      () => 'x',
      () => true,
      fakeFetch(() => ({ json: { nope: true } })),
    )
    expect((await bad.summarize(input)).source).toBe('template')
    const err = new OllamaSummarizer(
      () => 'x',
      () => true,
      fakeFetch(() => ({ status: 404, json: { error: 'model not found' } })),
    )
    expect((await err.summarize(input)).source).toBe('template')
    const off = new OllamaSummarizer(
      () => 'x',
      () => false,
      fakeFetch(() => {
        throw new Error('must not be called')
      }),
    )
    expect((await off.summarize(input)).source).toBe('template')
  })

  it('reports status and model availability', async () => {
    const s = new OllamaSummarizer(
      () => '',
      () => true,
      fakeFetch(() => ({ json: { models: [{ name: 'llama3.2:3b' }, { name: 'gemma4:e2b' }] } })),
    )
    const st = await s.status('gemma4:e2b')
    expect(st).toMatchObject({
      running: true,
      installed: true,
      modelAvailable: true,
      models: ['llama3.2:3b', 'gemma4:e2b'],
    })
    const off = await new OllamaSummarizer(
      () => '',
      () => true,
      (async () => {
        throw new Error('down')
      }) as Fetcher,
    ).status('')
    expect(off.running).toBe(false)
  })

  it('uses the same small, accurate fallback model on every Mac', () => {
    expect(recommendModel()).toBe('llama3.2:3b')
  })

  it('never puts file contents in the fact sheet (paths and titles only)', () => {
    const f = factSheet(input)
    expect(f).toContain('Project: Savespace')
    expect(f).toContain('Status update')
    expect(f).not.toContain('x@y')
  })

  it('includes user intent and compares only matching saved repositories', () => {
    const git = input.refs.find((ref) => ref.kind === 'gitState')!
    const facts = factSheet({
      ...input,
      handoff: 'goal: Keep restore preview stable',
      previousRefs: [
        { ...git, repoPath: '/other/repo', dirtyFiles: 99 },
        { ...git, branch: 'main', dirtyFiles: 1 },
      ],
    })
    expect(facts).toContain('goal: Keep restore preview stable')
    expect(facts).toContain('branch main → feature/restore, changed file count 1 → 3')
    expect(facts).toContain('linear.app/acme/issue/WP-9')
    expect(facts).not.toContain('99')
  })

  it('cleanSummary drops advice and caps at 3 sentences', () => {
    expect(
      cleanSummary('**You were** editing a. You had b open. You read c. You also d. Consider e.'),
    ).toBe('You were editing a. You had b open. You read c.')
  })
})

describe('network guard', () => {
  it('refuses loopback ports other than the running engine', async () => {
    await expect(guardedFetch('http://127.0.0.1:11434/api/tags')).rejects.toThrow(/not allowed/)
    await expect(guardedFetch('http://127.0.0.1:8080/')).rejects.toThrow(/not allowed/)
  })
  it('refuses every host except the bundled engine and opt-in Google APIs', async () => {
    await expect(guardedFetch('https://api.openai.com/v1/chat')).rejects.toThrow(/not allowed/)
    await expect(guardedFetch('https://telemetry.example.com/')).rejects.toThrow(/not allowed/)
    await expect(guardedFetch('http://oauth2.googleapis.com/token')).rejects.toThrow(/https/)
  })
})

describe('embedding de-duplication', () => {
  it('folds near-identical suggestions together', async () => {
    const drafts = [
      {
        kind: 'new-project' as const,
        name: 'Atlas',
        signals: ['repo:/a'],
        evidence: [],
        score: 3,
        targetProjectIds: [],
        fingerprint: '1',
      },
      {
        kind: 'new-project' as const,
        name: 'Atlas Docs',
        signals: ['host:atlas.dev'],
        evidence: [],
        score: 2,
        targetProjectIds: [],
        fingerprint: '2',
      },
      {
        kind: 'new-project' as const,
        name: 'Taxes',
        signals: ['path:/t'],
        evidence: [],
        score: 1,
        targetProjectIds: [],
        fingerprint: '3',
      },
    ]
    const out = await dedupeWithEmbeddings(
      drafts,
      async () => [
        [1, 0],
        [0.99, 0.05],
        [0, 1],
      ],
      cosine,
    )
    expect(out.map((d) => d.name)).toEqual(['Atlas', 'Taxes'])
    expect(out[0]!.signals).toEqual(['repo:/a', 'host:atlas.dev'])
    expect(await dedupeWithEmbeddings(drafts, async () => null, cosine)).toHaveLength(3)
  })
})

describe('model download (pull) streaming', () => {
  it('reports progress lines and surfaces errors', async () => {
    const lines = [
      { status: 'pulling manifest' },
      { status: 'pulling abc', total: 100, completed: 40 },
      { status: 'pulling abc', total: 100, completed: 100 },
      { status: 'success' },
    ]
    const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
    const s = new OllamaSummarizer(
      () => '',
      () => true,
      (async () => new Response(body)) as Fetcher,
      () => 'http://127.0.0.1:1234',
    )
    const seen: string[] = []
    await s.pull('llama3.2:3b', (p) => seen.push(`${p.status}:${p.completed ?? ''}`))
    expect(seen).toEqual(['pulling manifest:', 'pulling abc:40', 'pulling abc:100', 'success:'])
    const bad = new OllamaSummarizer(
      () => '',
      () => true,
      (async () => new Response('{"error":"disk full"}\n')) as Fetcher,
    )
    await expect(bad.pull('x', () => {})).rejects.toThrow(/disk full/)
  })
})

describe('AI engine egress gate', () => {
  it('allows only the model registry, only on 443, only while downloading', async () => {
    const { egressAllowed } = await import('../../src/main/summarizer/egress')
    expect(egressAllowed('registry.ollama.ai:443', true)).toBe(true)
    expect(
      egressAllowed('dd20bb891979d25aebc8bec07b2b3bbc.r2.cloudflarestorage.com:443', true),
    ).toBe(true)
    expect(egressAllowed('registry.ollama.ai:443', false)).toBe(false)
    expect(egressAllowed('ollama.com:443', true)).toBe(false)
    expect(egressAllowed('registry.ollama.ai:80', true)).toBe(false)
    expect(egressAllowed('evil.r2.cloudflarestorage.com:443', true)).toBe(false)
    expect(egressAllowed('registry.ollama.ai.evil.com:443', true)).toBe(false)
  })
})
