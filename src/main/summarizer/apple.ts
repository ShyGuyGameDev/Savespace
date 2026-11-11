import { SafeExecError, type SafeExec } from '../safe-exec'
import { templateSummary } from './template'
import { cleanSummary, factSheet, SYSTEM_PROMPT } from './ollama'
import type { SummaryInput } from './types'

export interface AppleStatus {
  available: boolean
  reason?: string
}

/** Plain-English reasons for the settings screen. */
export const APPLE_REASON_TEXT: Record<string, string> = {
  deviceNotEligible: 'This Mac doesn’t support Apple Intelligence.',
  appleIntelligenceNotEnabled:
    'Apple Intelligence is turned off (System Settings → Apple Intelligence & Siri).',
  modelNotReady: 'Apple’s model is still downloading in the background (macOS does this itself).',
  osTooOld: 'Needs macOS 26 or later.',
  notBundled: 'This build doesn’t include the Apple AI helper.',
}

/**
 * Apple's on-device foundation model (Apple Intelligence), reached through Savespace's tiny helper.
 * Runs entirely on this Mac; nothing to download. Only the on-device SystemLanguageModel is used.
 */
export class AppleSummarizer {
  private cache: { at: number; status: AppleStatus } | null = null

  constructor(
    private readonly exec: SafeExec,
    private readonly bundled: () => boolean,
  ) {}

  async status(force = false): Promise<AppleStatus> {
    if (!this.bundled()) return { available: false, reason: 'notBundled' }
    if (!force && this.cache && Date.now() - this.cache.at < 60_000) return this.cache.status
    let status: AppleStatus
    try {
      const r = await this.exec.run('apple-ai', ['status'], { timeoutMs: 10_000 })
      const j = JSON.parse(r.stdout || '{}') as { available?: boolean; reason?: string }
      status = {
        available: j.available === true,
        reason: j.available ? undefined : (j.reason ?? 'unavailable'),
      }
    } catch (e) {
      status = {
        available: false,
        reason: e instanceof SafeExecError && e.code === 'not-found' ? 'notBundled' : 'unavailable',
      }
    }
    this.cache = { at: Date.now(), status }
    return status
  }

  /** Asks Apple's on-device model a question. Returns null if it can't be used right now. */
  async ask(instructions: string, prompt: string): Promise<string | null> {
    if (!(await this.status()).available) return null
    try {
      const r = await this.exec.run(
        'apple-ai',
        ['summarize', instructions.slice(0, 4000), prompt.slice(0, 12000)],
        { timeoutMs: 45_000 },
      )
      const j = JSON.parse(r.stdout || '{}') as { text?: string }
      return j.text ?? null
    } catch {
      return null
    }
  }

  /** Returns null when Apple's model can't be used right now (caller falls back). */
  async summarize(input: SummaryInput): Promise<string | null> {
    if (!(await this.status()).available) return null
    try {
      const prompt = `Checkpoint facts:\n${factSheet(input)}\n\nWrite the recap.`
      const r = await this.exec.run('apple-ai', ['summarize', SYSTEM_PROMPT, prompt], {
        timeoutMs: 45_000,
      })
      const j = JSON.parse(r.stdout || '{}') as { text?: string; error?: string }
      if (!j.text) return null
      const text = cleanSummary(j.text)
      return text.length >= 20 ? text : null
    } catch {
      return null
    }
  }
}

/** Picks the best available source: Apple on-device → downloaded model → plain summary. */
export class AutoSummarizer {
  constructor(
    private readonly apple: AppleSummarizer,
    private readonly downloaded: {
      summarize(input: SummaryInput): Promise<{ text: string; source: 'ollama' | 'template' }>
      ask?(instructions: string, prompt: string): Promise<string | null>
    },
    private readonly settings: () => {
      aiEnabled: boolean
      aiProvider: 'auto' | 'apple' | 'downloaded'
    },
  ) {}

  async summarize(input: SummaryInput) {
    const s = this.settings()
    if (!s.aiEnabled) return { text: templateSummary(input), source: 'template' as const }
    if (s.aiProvider !== 'downloaded') {
      const text = await this.apple.summarize(input)
      if (text) return { text, source: 'apple' as const }
    }
    if (s.aiProvider === 'apple')
      return { text: templateSummary(input), source: 'template' as const }
    return this.downloaded.summarize(input)
  }

  /** Asks a question using the same source order as summaries. Null = no AI available right now. */
  async ask(
    instructions: string,
    prompt: string,
  ): Promise<{ text: string; source: 'apple' | 'ollama' } | null> {
    const s = this.settings()
    if (!s.aiEnabled) return null
    if (s.aiProvider !== 'downloaded') {
      const t = await this.apple.ask(instructions, prompt)
      if (t) return { text: t, source: 'apple' }
    }
    if (s.aiProvider === 'apple' || !this.downloaded.ask) return null
    const t = await this.downloaded.ask(instructions, prompt)
    return t ? { text: t, source: 'ollama' } : null
  }
}
