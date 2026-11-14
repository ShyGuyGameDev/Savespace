import type { ResourceRef } from '@shared/schemas'
import type { Summarizer, SummaryInput } from './types'

const TRIGGER_TEXT: Record<string, string> = {
  manual: 'You saved this checkpoint by hand',
  'project-switch': 'Saved when you switched to something else',
  idle: 'Saved when you stepped away',
  'end-of-day': 'Saved at the end of your day',
  sleep: 'Saved when your Mac went to sleep',
  lock: 'Saved when you locked your screen',
  quit: 'Saved when Savespace quit',
}

const base = (p: string) => p.replace(/\/$/, '').split('/').pop() ?? p
function list(items: string[], max = 3): string {
  const uniq = [...new Set(items)].filter(Boolean)
  if (!uniq.length) return ''
  const shown = uniq.slice(0, max)
  const more = uniq.length - shown.length
  const head = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0]!
  return more > 0 ? `${shown.join(', ')} and ${more} more` : head
}

/** Deterministic "what you were doing" recap, built only from checkpoint metadata. */
export function templateSummary(input: SummaryInput): string {
  const r = input.refs
  const of = <K extends ResourceRef['kind']>(k: K) =>
    r.filter((x): x is Extract<ResourceRef, { kind: K }> => x.kind === k)
  const files = of('file')
  const focusedFile = files.find((f) => f.focused)
  const focused = r.find(
    (ref) => ref.focused && !['app', 'windowFrame', 'gitState'].includes(ref.kind),
  )
  const git = of('gitState')[0]
  const urls = of('url')
  const drafts = of('draft')
  const events = of('calendarEvent')
  const sentences: string[] = []

  const where = input.project ? `on ${input.project.name}` : 'on your work'
  if (focusedFile) {
    const others = files.filter((f) => f !== focusedFile).map((f) => base(f.path))
    sentences.push(
      `You were working ${where}, with ${base(focusedFile.path)} in focus${focusedFile.line ? ` around line ${focusedFile.line}` : ''}${others.length ? ` with ${list(others)} also open` : ''}.`,
    )
  } else if (focused?.kind === 'url' || focused?.kind === 'doc') {
    sentences.push(
      `You had ${focused.title || new URL(focused.url).hostname || 'a document'} in focus.`,
    )
  } else if (focused && 'path' in focused) {
    sentences.push(`You had ${base(focused.path)} in focus.`)
  } else if (focused?.title) {
    sentences.push(`You had ${focused.title} in focus.`)
  } else if (files.length) {
    sentences.push(`You had ${list(files.map((file) => base(file.path)))} open.`)
  } else if (urls.length) {
    sentences.push(
      `You were working ${where} with these tabs open: ${list(
        urls.map((u) => u.title || new URL(u.url).hostname),
        2,
      )}.`,
    )
  } else {
    const apps = of('app').map((a) => a.title ?? a.app)
    sentences.push(`You were working ${where}${apps.length ? ` in ${list(apps)}` : ''}.`)
  }

  const extra: string[] = []
  if (git)
    extra.push(
      `the ${git.branch} branch of ${base(git.repoPath)} had ${git.dirtyFiles === 0 ? 'no uncommitted changes' : `${git.dirtyFiles} uncommitted change${git.dirtyFiles === 1 ? '' : 's'}`}`,
    )
  if (focusedFile && urls.length)
    extra.push(
      `${urls.length} related tab${urls.length === 1 ? ' was' : 's were'} open, including ${list(
        urls.map((u) => u.title || new URL(u.url).hostname),
        2,
      )}`,
    )
  if (drafts.length)
    extra.push(`a draft “${drafts[0]!.subject ?? drafts[0]!.title ?? 'untitled'}” was open`)
  if (events.length) extra.push(`your calendar showed “${events[0]!.title}”`)
  if (extra.length)
    sentences.push(
      `${extra[0]!.charAt(0).toUpperCase()}${extra[0]!.slice(1)}${extra[1] ? `, and ${extra[1]}` : ''}.`,
    )

  sentences.push(
    `${TRIGGER_TEXT[input.trigger] ?? 'Saved'} at ${new Date(input.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`,
  )
  return sentences.slice(0, 3).join(' ')
}

export class TemplateSummarizer implements Summarizer {
  async summarize(input: SummaryInput) {
    return { text: templateSummary(input), source: 'template' as const }
  }
}
