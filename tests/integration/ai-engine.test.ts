/**
 * Starts the REAL bundled AI engine (resources/ollama/ollama) the way Waypoint does and checks that
 * it runs only on loopback with cloud features off and keeps all of its files inside the given folder.
 * Skipped if the engine hasn't been fetched (run `npm run fetch:ollama`).
 * Set WAYPOINT_LIVE_AI=1 to also download the default model and generate a real summary (~2 GB).
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { guardedFetch } from '../../src/main/net'
import { AiEngine } from '../../src/main/summarizer/engine'
import { AiManager } from '../../src/main/summarizer/manager'
import { OllamaSummarizer } from '../../src/main/summarizer/ollama'
import { DEFAULT_SETTINGS } from '@shared/constants'

const BIN = resolve(__dirname, '../../resources/ollama/ollama')
const LIVE = process.env['WAYPOINT_LIVE_AI'] === '1'
const dir = mkdtempSync(join(tmpdir(), 'waypoint-ai-'))
const blocked: string[] = []
const engine = new AiEngine(
  BIN,
  join(dir, 'models'),
  join(dir, 'home'),
  () => {},
  (t) => blocked.push(t),
)
afterAll(() => {
  engine.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!existsSync(BIN))('bundled AI engine', () => {
  it('starts on a random loopback port, with cloud off, and stops cleanly', async () => {
    const userOllamaBefore = existsSync(join(homedir(), '.ollama'))
    await engine.start()
    expect(engine.state).toBe('running')
    expect(engine.port).toBeGreaterThan(1024)
    const v = (await (await guardedFetch(`${engine.baseUrl()}/api/version`)).json()) as {
      version: string
    }
    expect(v.version).toMatch(/^\d+\.\d+\.\d+/)
    // Only its own folders are used; the user's ~/.ollama is not created or touched.
    expect(existsSync(join(homedir(), '.ollama'))).toBe(userOllamaBefore)
    expect(readdirSync(dir).sort()).toEqual(['home', 'models'])
    const tags = (await (await guardedFetch(`${engine.baseUrl()}/api/tags`)).json()) as {
      models: unknown[]
    }
    expect(tags.models).toEqual([])
  }, 60_000)

  it('cannot reach the internet unless Waypoint is downloading a model (egress gate)', async () => {
    const ollama = new OllamaSummarizer(
      () => 'all-minilm',
      () => true,
      undefined,
      () => engine.baseUrl(),
    )
    await expect(ollama.pull('all-minilm', () => {})).rejects.toThrow()
    expect(blocked.some((t) => t.startsWith('registry.ollama.ai'))).toBe(true)
    expect(await ollama.listModels()).toEqual([]) // nothing was downloaded
  }, 60_000)

  it.runIf(LIVE)(
    'downloads the default model automatically and writes a real summary',
    async () => {
      const settings = { ...DEFAULT_SETTINGS, ollamaModel: 'llama3.2:3b' }
      const ollama = new OllamaSummarizer(
        () => settings.ollamaModel,
        () => true,
        undefined,
        () => engine.baseUrl(),
      )
      const progress: number[] = []
      const ai = new AiManager(
        engine,
        ollama,
        () => settings,
        (d) => d.total && progress.push(d.completed / d.total),
      )
      await ai.sync()
      expect(ai.download?.status).toBe('success')
      expect(progress.length).toBeGreaterThan(1)
      expect((await ai.status()).modelAvailable).toBe(true)
      const r = await ollama.summarize({
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
        recentTitles: ['server.ts — atlas-api'],
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
          {
            kind: 'url',
            app: 'com.google.Chrome',
            url: 'https://acme.atlassian.net/browse/ATL-212',
            title: 'ATL-212 Rate limit the public API',
          },
        ],
      })
      console.log(`[live-ai] ${r.source}: ${r.text}`)
      expect(r.source).toBe('ollama')
      expect(r.text.length).toBeGreaterThan(40)
    },
    30 * 60_000,
  )
})
