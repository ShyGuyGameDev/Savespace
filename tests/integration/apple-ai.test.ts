/**
 * Talks to the REAL Apple on-device model through Waypoint's helper (no download).
 * Skips cleanly if the helper isn't built or this Mac doesn't have Apple Intelligence.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerAppleAiHelper } from '../../src/main/safe-exec/allowlist'
import { SafeExec } from '../../src/main/safe-exec'
import { AppleSummarizer } from '../../src/main/summarizer/apple'

const HELPER = resolve(__dirname, '../../resources/apple-ai/waypoint-apple-ai')

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
