import { homedir, totalmem } from 'node:os'
import { z } from 'zod'
import { FALLBACK_MODEL } from '@shared/constants'
import type { AiDownload, AiStatus, ResourceRef } from '@shared/schemas'
import { guardedFetch } from '../net'
import { templateSummary } from './template'
import type { Summarizer, SummaryInput } from './types'

const TagsSchema = z.object({
  models: z.array(z.object({ name: z.string(), model: z.string().optional() })),
})
const ChatSchema = z.object({
  message: z.object({ role: z.string(), content: z.string() }),
  done: z.boolean().optional(),
})
const PullLineSchema = z.object({
  status: z.string().default(''),
  total: z.number().optional(),
  completed: z.number().optional(),
  error: z.string().optional(),
})
const EmbedSchema = z.object({ embeddings: z.array(z.array(z.number())) })

export type Fetcher = typeof guardedFetch

export function ramGb(): number {
  return Math.round(totalmem() / 1024 ** 3)
}

/** The quiet background fallback model; the same for every Mac (see FALLBACK_MODEL). */
export function recommendModel(): string {
  return FALLBACK_MODEL
}

export const SYSTEM_PROMPT = `You write a short recap for someone returning to their work. Write 2 or 3 natural sentences in second person ("You were ..."). Mention the project, what was being edited (file names, not full paths), and where things stood (branch, uncommitted changes, related tickets, pages or drafts). Only name files that appear under "Open files". Describe only the state of the work. Never give advice, next steps, decisions or questions. Use only the facts given. Plain text only, no headings, no lists.`

/** Turns checkpoint metadata into a compact fact sheet (titles, paths, branches only). */
export function factSheet(input: SummaryInput): string {
  const lines: string[] = []
  if (input.project) lines.push(`Project: ${input.project.name}`)
  lines.push(`Saved: ${new Date(input.at).toLocaleString()} (${input.trigger})`)
  const add = (label: string, refs: ResourceRef[], fmt: (r: ResourceRef) => string, max = 8) => {
    if (refs.length)
      lines.push(
        `${label}:`,
        ...refs.slice(0, max).map((r) => `- ${fmt(r)}${r.focused ? ' (focused)' : ''}`),
      )
  }
  const by = (k: ResourceRef['kind'][]) => input.refs.filter((r) => k.includes(r.kind))
  add('Folders/workspaces', by(['workspace', 'folder']), (r) =>
    'path' in r ? (r.path as string).replace(homedir(), '~') : '',
  )
  add(
    'Open files',
    by(['file']),
    (r) =>
      r.kind === 'file'
        ? `${r.path.replace(homedir(), '~')}${r.line ? ` (line ${r.line})` : ''}`
        : '',
    10,
  )
  add('Git repository (not a file)', by(['gitState']), (r) =>
    r.kind === 'gitState'
      ? `repository "${r.repoPath.split('/').pop()}": branch ${r.branch}, ${r.dirtyFiles} uncommitted change(s)`
      : '',
  )
  add(
    'Web pages',
    by(['url', 'doc']),
    (r) => `${r.title ?? ''} <${'url' in r ? new URL(r.url).hostname : ''}>`,
    10,
  )
  add(
    'Email',
    by(['draft', 'message']),
    (r) => `${r.kind}: ${'subject' in r ? (r.subject ?? '') : ''}`,
  )
  add('Notes', by(['note']), (r) => r.title ?? 'note')
  add('Calendar', by(['calendarEvent']), (r) => r.title ?? 'event')
  add('Terminals', by(['terminalCwd']), (r) =>
    'path' in r ? (r.path as string).replace(homedir(), '~') : '',
  )
  if (input.recentTitles.length)
    lines.push(
      'Recent window titles:',
      ...[...new Set(input.recentTitles)].slice(-8).map((t) => `- ${t}`),
    )
  return lines.join('\n').slice(0, 6000)
}

/** Keeps at most 3 sentences and drops any that drift into advice or next steps. */
export function cleanSummary(text: string): string {
  const t = text
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\*\*|__|^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
  // Split only where punctuation is followed by whitespace + a capital (keeps "engine.ts" intact).
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z“"'])/)
  const banned =
    /^(next|you should|you might|consider|todo|to do|remember to|don't forget|open question|decision|i recommend|it would be)/i
  return sentences
    .map((s) => s.trim())
    .filter((s) => s && !banned.test(s))
    .slice(0, 3)
    .join(' ')
}

export class OllamaSummarizer implements Summarizer {
  constructor(
    private readonly getModel: () => string,
    private readonly enabled: () => boolean,
    private readonly fetcher: Fetcher = guardedFetch,
    /** Base URL of Savespace's bundled engine (random loopback port). */
    private readonly baseUrl: () => string = () => 'http://127.0.0.1:0',
    private readonly engineBundled: () => boolean = () => true,
  ) {}

  async listModels(): Promise<string[] | null> {
    try {
      const res = await this.fetcher(`${this.baseUrl()}/api/tags`, { timeoutMs: 1500 })
      if (!res.ok) return null
      return TagsSchema.parse(await res.json()).models.map((m) => m.name)
    } catch {
      return null
    }
  }

  async status(
    selected: string,
    download: AiDownload | null = null,
  ): Promise<Omit<AiStatus, 'apple' | 'activeSource' | 'modelsDir'>> {
    const gb = ramGb()
    const selectedModel = selected || recommendModel()
    const models = await this.listModels()
    const has = (m: string) => !!models && (models.includes(m) || models.includes(`${m}:latest`))
    return {
      installed: this.engineBundled(),
      running: models !== null,
      models: models ?? [],
      selectedModel,
      recommendedModel: recommendModel(),
      ramGb: gb,
      modelAvailable: has(selectedModel),
      download,
    }
  }

  /** Downloads a model into Savespace's own models folder, streaming progress. */
  async pull(
    model: string,
    onProgress: (p: { status: string; completed?: number; total?: number }) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await this.fetcher(`${this.baseUrl()}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      timeoutMs: 6 * 3600_000,
      signal,
    })
    if (!res.ok || !res.body) throw new Error(`Model download failed (${res.status})`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        const p = PullLineSchema.parse(JSON.parse(line))
        if (p.error) throw new Error(p.error)
        onProgress(p)
      }
    }
  }

  /** Asks the downloaded model a question (deterministic settings). Null if not ready. */
  async ask(instructions: string, prompt: string): Promise<string | null> {
    if (!this.enabled()) return null
    try {
      const res = await this.fetcher(`${this.baseUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        timeoutMs: 45_000,
        body: JSON.stringify({
          model: this.getModel() || recommendModel(),
          stream: false,
          keep_alive: '5m',
          options: { temperature: 0, num_ctx: 4096, num_predict: 120 },
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: prompt },
          ],
        }),
      })
      if (!res.ok) return null
      return ChatSchema.parse(await res.json()).message.content
    } catch {
      return null
    }
  }

  async summarize(input: SummaryInput) {
    const fallback = { text: templateSummary(input), source: 'template' as const }
    if (!this.enabled()) return fallback
    const model = this.getModel() || recommendModel()
    try {
      const res = await this.fetcher(`${this.baseUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        timeoutMs: 45_000,
        body: JSON.stringify({
          model,
          stream: false,
          keep_alive: '5m',
          options: { temperature: 0.2, num_ctx: 4096, num_predict: 180 },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Checkpoint facts:\n${factSheet(input)}\n\nWrite the recap.` },
          ],
        }),
      })
      if (!res.ok) return fallback
      const body = ChatSchema.parse(await res.json())
      const text = cleanSummary(body.message.content)
      return text.length >= 20 ? { text, source: 'ollama' as const } : fallback
    } catch {
      return fallback
    }
  }

  /** Optional: embeddings for project-suggestion de-duplication. Returns null if unavailable. */
  async embed(texts: string[], model = 'nomic-embed-text'): Promise<number[][] | null> {
    try {
      const res = await this.fetcher(`${this.baseUrl()}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        timeoutMs: 15_000,
        body: JSON.stringify({ model, input: texts }),
      })
      if (!res.ok) return null
      return EmbedSchema.parse(await res.json()).embeddings
    } catch {
      return null
    }
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!
    na += a[i]! ** 2
    nb += b[i]! ** 2
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}
