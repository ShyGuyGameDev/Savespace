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
    resolve: (id) => (id === 'apple-ai' ? '/x/apple-ai/savespace-apple-ai' : null),
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
  it('downloads only with consent: yes, or the intro finished without an answer', async () => {
    const run = async (consent: 'unasked' | 'yes' | 'no', onboardingComplete: boolean) => {
      const { engine } = fakeEngine()
      ;(engine as { state: string }).state = 'running'
      const pulls: string[] = []
      const m = new AiManager(
        engine as never,
        { ...ollama, pull: async (model: string) => void pulls.push(model) } as never,
        () => ({ ...DEFAULT_SETTINGS, aiDownloadConsent: consent, onboardingComplete }),
        () => {},
        () => {},
        { status: async () => ({ available: false, reason: 'deviceNotEligible' }) },
      )
      await m.sync()
      return pulls.length
    }
    expect(await run('no', true)).toBe(0) // said No
    expect(await run('unasked', false)).toBe(0) // still in the intro, not asked yet
    expect(await run('unasked', true)).toBe(1) // intro skipped/finished without answering = yes
    expect(await run('yes', false)).toBe(1) // said Yes
  })

  it('starts the engine and fetches the fallback model in the background when Apple is unavailable', async () => {
    const { engine, log } = fakeEngine()
    const pulls: string[] = []
    const m = new AiManager(
      engine as never,
      { ...ollama, pull: async (model: string) => void pulls.push(model) } as never,
      () => ({ ...DEFAULT_SETTINGS, aiDownloadConsent: 'yes' as const }),
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

describe('Automation "Ask" button', () => {
  async function setup(running: boolean, reply: { stdout: string; stderr: string; code: number }) {
    const { Permissions } = await import('../../src/main/privacy/permissions')
    const calls: string[] = []
    let isRunning = running
    const exec = new SafeExec(
      async (file, args) => {
        const src = args[3] ?? ''
        calls.push(
          file.endsWith('open')
            ? `open ${args.join(' ')}`
            : src.includes('running()') && !src.includes('windows()')
              ? 'running?'
              : 'probe',
        )
        if (file.endsWith('open')) {
          isRunning = true
          return { stdout: '', stderr: '', code: 0 }
        }
        if (src.includes('installed: true'))
          return {
            stdout: JSON.stringify({ installed: true, running: isRunning }),
            stderr: '',
            code: 0,
          }
        return reply
      },
      { resolve: (id) => `/bin/${id}` },
    )
    return { p: new Permissions(exec), calls }
  }
  const noSleep = async () => {}

  it('opens a closed app in the background first, then asks', async () => {
    const { p, calls } = await setup(false, {
      stdout: '{"running":true,"windows":0}',
      stderr: '',
      code: 0,
    })
    const r = await p.requestAutomation('com.apple.Safari', undefined, noSleep)
    expect(calls).toContain('open -g -b com.apple.Safari --')
    expect(calls.at(-1)).toBe('probe')
    expect(r.automation['com.apple.Safari']).toBe('granted')
    expect(r.lastRequest?.outcome).toBe('granted')
  })

  it('explains a "Don’t Allow" answer and a missed question', async () => {
    const denied = await setup(true, {
      stdout: '',
      stderr: 'Not authorized to send Apple events to Mail. (-1743)',
      code: 1,
    })
    const r1 = await denied.p.requestAutomation('com.apple.mail', undefined, noSleep)
    expect(r1.automation['com.apple.mail']).toBe('denied')
    expect(r1.lastRequest?.message).toMatch(/Privacy & Security → Automation/)
    const slow = await setup(true, { stdout: '', stderr: '', code: 124 })
    const r2 = await slow.p.requestAutomation('com.apple.Notes', undefined, noSleep)
    expect(r2.lastRequest?.outcome).toBe('no-answer')
  })

  it('remembers permission answers across restarts and can ask any app Savespace supports', async () => {
    const { Permissions } = await import('../../src/main/privacy/permissions')
    let saved: Record<string, 'granted' | 'denied'> = {}
    const persist = {
      load: () => saved,
      save: (s: Record<string, 'granted' | 'denied'>) => void (saved = s),
    }
    const exec = new SafeExec(
      async (file, args) => {
        const src = args[3] ?? ''
        if (src.includes('installed: true'))
          return { stdout: '{"installed":true,"running":true}', stderr: '', code: 0 }
        return { stdout: '{"running":true,"windows":1}', stderr: '', code: 0 }
      },
      { resolve: (id) => `/bin/${id}` },
    )
    const p1 = new Permissions(exec, persist)
    await p1.requestAutomation('com.googlecode.iterm2', 'iTerm2', noSleep)
    expect(saved).toEqual({ 'com.googlecode.iterm2': 'granted' })
    const p2 = new Permissions(exec, persist) // after a restart
    expect(p2.status().automation['com.googlecode.iterm2']).toBe('granted')
    await expect(p2.requestAutomation('bad id!', 'x', noSleep)).rejects.toThrow(/Invalid app/)
  })
})
