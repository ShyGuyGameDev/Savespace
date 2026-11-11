import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/constants'
import { AppleSummarizer, AutoSummarizer } from '../../src/main/summarizer/apple'
import { AiManager } from '../../src/main/summarizer/manager'
import type { SummaryInput } from '../../src/main/summarizer/types'
import { SafeExec, type Runner } from '../../src/main/safe-exec'

const input: SummaryInput = {
  project: null,
  trigger: 'manual',
  at: 0,
  recentTitles: [],
  refs: [
    {
      kind: 'file',
      app: 'com.microsoft.VSCode',
      path: '/w/src/server.ts',
      line: 42,
      focused: true,
    },
  ],
}

function fakeApple(replies: { status?: object; summarize?: object | 'fail' }) {
  const calls: string[][] = []
  const runner: Runner = async (_f, args) => {
    calls.push(args)
    if (args[0] === 'status')
      return { stdout: JSON.stringify(replies.status ?? { available: true }), stderr: '', code: 0 }
    if (replies.summarize === 'fail') return { stdout: '', stderr: 'boom', code: 1 }
    return {
      stdout: JSON.stringify(
        replies.summarize ?? {
          text: 'You were editing server.ts at line 42. Next, you should test it.',
        },
      ),
      stderr: '',
      code: 0,
    }
  }
  const exec = new SafeExec(runner, {
    resolve: (id) => (id === 'apple-ai' ? '/x/apple-ai/waypoint-apple-ai' : null),
  })
  return { apple: new AppleSummarizer(exec, () => true), calls, exec }
}

describe('Apple on-device summarizer', () => {
  it('summarizes with the shared instructions and cleans the text', async () => {
    const { apple, calls } = fakeApple({})
    expect(await apple.summarize(input)).toBe('You were editing server.ts at line 42.')
    const s = calls.find((c) => c[0] === 'summarize')!
    expect(s).toHaveLength(3)
    expect(s[2]).toContain('server.ts (line 42) (focused)')
  })

  it('reports why it is unavailable and returns null so callers fall back', async () => {
    const { apple } = fakeApple({
      status: { available: false, reason: 'appleIntelligenceNotEnabled' },
    })
    expect(await apple.status()).toEqual({
      available: false,
      reason: 'appleIntelligenceNotEnabled',
    })
    expect(await apple.summarize(input)).toBeNull()
    expect(await new AppleSummarizer(new SafeExec(), () => false).status()).toEqual({
      available: false,
      reason: 'notBundled',
    })
  })

  it('only allows `status` and `summarize <instructions> <prompt>`', async () => {
    const { exec } = fakeApple({})
    await expect(exec.run('apple-ai', ['status', 'extra'])).rejects.toThrow(/only `status`/)
    await expect(exec.run('apple-ai', ['--help'])).rejects.toThrow(/only `status`/)
    await expect(exec.run('apple-ai', ['summarize', 'only-one'])).rejects.toThrow(/only `status`/)
  })
})

describe('source order: Apple → downloaded model → plain summary', () => {
  const downloaded = {
    summarize: async () => ({ text: 'from the downloaded model', source: 'ollama' as const }),
  }
  const settings = (p: Partial<typeof DEFAULT_SETTINGS>) => () => ({ ...DEFAULT_SETTINGS, ...p })
  it('prefers Apple when available', async () => {
    const r = await new AutoSummarizer(fakeApple({}).apple, downloaded, settings({})).summarize(
      input,
    )
    expect(r.source).toBe('apple')
  })
  it('falls back to the downloaded model when Apple fails or is unavailable', async () => {
    expect(
      (
        await new AutoSummarizer(
          fakeApple({ summarize: 'fail' }).apple,
          downloaded,
          settings({}),
        ).summarize(input)
      ).source,
    ).toBe('ollama')
    expect(
      (
        await new AutoSummarizer(
          fakeApple({ status: { available: false, reason: 'deviceNotEligible' } }).apple,
          downloaded,
          settings({}),
        ).summarize(input)
      ).source,
    ).toBe('ollama')
  })
  it('honours the AI source setting and the off switch', async () => {
    expect(
      (
        await new AutoSummarizer(
          fakeApple({}).apple,
          downloaded,
          settings({ aiProvider: 'downloaded' }),
        ).summarize(input)
      ).source,
    ).toBe('ollama')
    expect(
      (
        await new AutoSummarizer(
          fakeApple({ summarize: 'fail' }).apple,
          downloaded,
          settings({ aiProvider: 'apple' }),
        ).summarize(input)
      ).source,
    ).toBe('template')
    expect(
      (
        await new AutoSummarizer(
          fakeApple({}).apple,
          downloaded,
          settings({ aiEnabled: false }),
        ).summarize(input)
      ).source,
    ).toBe('template')
  })
})

describe('AI manager: no download when Apple is available', () => {
  function fakeEngine() {
    const log: string[] = []
    return {
      log,
      engine: {
        available: true,
        state: 'stopped',
        start: async () => void log.push('start'),
        stop: () => void log.push('stop'),
        egress: { whileDownloading: async <T>(fn: () => Promise<T>) => fn() },
      },
    }
  }
  const ollama = { listModels: async () => [], pull: async () => {}, status: async () => ({}) }
  it('never starts the engine or downloads when Apple is available (auto)', async () => {
    const { engine, log } = fakeEngine()
    const m = new AiManager(
      engine as never,
      ollama as never,
      () => DEFAULT_SETTINGS,
      () => {},
      () => {},
      { status: async () => ({ available: true }) },
    )
    await m.sync()
    expect(log).toEqual(['stop'])
    expect(m.download).toBeNull()
  })
  it('starts the engine and fetches the fallback model in the background when Apple is unavailable', async () => {
    const { engine, log } = fakeEngine()
    const pulls: string[] = []
    const m = new AiManager(
      engine as never,
      { ...ollama, pull: async (model: string) => void pulls.push(model) } as never,
      () => DEFAULT_SETTINGS,
      () => {},
      () => {},
      { status: async () => ({ available: false, reason: 'deviceNotEligible' }) },
    )
    ;(engine as { state: string }).state = 'running'
    await m.sync()
    expect(log).toContain('start')
    expect(pulls).toEqual(['llama3.2:3b'])
  })
})

describe('native helper source', () => {
  it('uses only the on-device model, never Private Cloud Compute', () => {
    const src = readFileSync(resolve(__dirname, '../../native/apple-ai/main.swift'), 'utf8')
    expect(src).toMatch(/SystemLanguageModel\.default/)
    expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(/PrivateCloudCompute/)
    expect(src).not.toMatch(/URLSession|Network|import Foundation\.URL/)
  })
})
