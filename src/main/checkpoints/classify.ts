import type { Project, ResourceRef } from '@shared/schemas'
import { refKey } from '../capture/engine'
import { label, parseNumbers, type Ask } from './relevance'

export const CLASSIFY_INSTRUCTIONS = `You file a saved snapshot of someone's work under one of their projects, but only when the match is obvious. Filing it under the wrong project is much worse than leaving it unfiled. You get a numbered list of projects (name, the apps, folders and sites that belong to it, and what they last did in it) and a list of what the person was working on. Pick a project ONLY if specific items tie the work to it: the same website, code repository, folder or file, or the same clearly named topic (for example a hotel in Lisbon for a project called Trip to Lisbon). These are NOT enough on their own: using the same kind of app, an email inbox, chat, a search page, a new tab, or a loosely similar subject (a different trip, a different client, a different codebase). Reply with ONLY the project number, for example: 2. Reply NONE if the link isn't obvious, if it could fit more than one project, or if you are unsure.`

export const CONFIRM_INSTRUCTIONS = `You double-check a filing decision. Filing work under the wrong project is much worse than not filing it. Reply YES only if the listed work obviously and specifically belongs to the named project (the same website, repository, folder, file or clearly named topic). Otherwise reply NO. Reply with only YES or NO.`

export interface ClassifyInput {
  projects: Project[]
  /** What was on screen when the checkpoint was made. */
  refs: ResourceRef[]
  /** Recent activity samples (most recent last): what was in front, and its window title. */
  events: { bundleId: string; appName: string; windowTitle: string | null; ref: unknown }[]
  /** The last summary written for a project, if any (helps describe it). */
  lastSummary: (projectId: string) => string | null
  ask: Ask
  /** Display name for a bundle id (e.g. from the running apps). */
  appName?: (bundleId: string) => string | undefined
}

const tail = (p: string) => p.replace(/\/$/, '').split('/').pop() || p

/** A plain description of a project's signals, e.g. "code repository atlas-api; site acme.atlassian.net". */
function describeSignals(p: Project): string {
  const out: string[] = []
  for (const s of p.signals) {
    const [kind, ...rest] = s.split(':')
    const v = rest.join(':')
    if (kind === 'repo') out.push(`code repository ${tail(v)}`)
    else if (kind === 'path') out.push(`folder ${tail(v)}`)
    else if (kind === 'host') out.push(`site ${v}`)
    else if (kind === 'token') out.push(`keyword "${v}"`)
    else if (kind === 'cal') out.push(`meeting "${v}"`)
  }
  return [...new Set(out)].slice(0, 8).join('; ')
}

/**
 * Asks the local AI which project (if any) a new checkpoint belongs to. Used only when the rules
 * (matching repos, folders and sites) didn't find a project. Returns null when the AI is
 * unavailable, unsure, or its answer can't be read: the checkpoint then stays unassigned.
 */
export async function classifyWithAi(
  o: ClassifyInput,
): Promise<{ projectId: string; judgedBy: 'apple' | 'ollama' } | null> {
  const projects = o.projects.slice(0, 20)
  if (!projects.length) return null
  const appName = (b: string) =>
    o.appName?.(b) ?? o.events.find((e) => e.bundleId === b)?.appName ?? b.split('.').pop() ?? b

  // What the person was working on: the focused items first, then the items used most recently.
  const items = o.refs.filter((r) => r.kind !== 'windowFrame' && r.kind !== 'gitState')
  const used = new Map<string, number>()
  o.events.forEach((e, i) => {
    const r = e.ref as ResourceRef | null
    if (r && typeof r === 'object' && 'kind' in r) used.set(refKey(r), i + 1)
  })
  const ranked = [...items].sort(
    (a, b) =>
      Number(!!b.focused) - Number(!!a.focused) ||
      (used.get(refKey(b)) ?? 0) - (used.get(refKey(a)) ?? 0),
  )
  const work = ranked
    .filter((r) => r.kind !== 'app' || !items.some((x) => x.kind !== 'app' && x.app === r.app))
    .slice(0, 12)
    .map((r) => `- ${label(r, appName)}`)
  const titles = [
    ...new Set(
      o.events
        .slice(-30)
        .map((e) => (e.windowTitle ? `${e.appName}: ${e.windowTitle.slice(0, 100)}` : null))
        .filter((t): t is string => !!t),
    ),
  ].slice(-8)
  // Only bare apps open (no tabs, files or folders): not enough to tell. Stay unassigned.
  if (!items.some((r) => r.kind !== 'app')) return null
  if (!work.length) return null

  const list = projects
    .map((p, i) => {
      const parts = [`${i + 1}. ${p.name}`]
      if (p.apps.length) {
        const pinned = p.apps.flatMap((a) =>
          a.items.map((it) => (it.kind === 'url' ? it.url : tail(it.path))),
        )
        parts.push(
          `apps: ${p.apps.map((a) => a.name).join(', ')}${pinned.length ? ` (pinned: ${pinned.slice(0, 5).join(', ')})` : ''}`,
        )
      }
      const sig = describeSignals(p)
      if (sig) parts.push(`includes: ${sig}`)
      const last = o.lastSummary(p.id)
      if (last) parts.push(`last time: ${last.slice(0, 160)}`)
      return parts.join(' | ')
    })
    .join('\n')

  const prompt = `Projects:\n${list}\n\nWhat the person was working on:\n${work.join('\n') || '(nothing specific open)'}${
    titles.length ? `\n\nRecent window titles:\n${titles.map((t) => `- ${t}`).join('\n')}` : ''
  }\n\nWhich project number does this work clearly belong to? Reply with one number or NONE.`

  const reply = await o.ask(CLASSIFY_INSTRUCTIONS, prompt).catch(() => null)
  if (!reply) return null
  const picks = parseNumbers(reply.text, projects.length)
  if (!picks || picks.size !== 1) return null // NONE, unreadable, or more than one: stay unassigned
  const i = [...picks][0]! - 1
  const p = projects[i]
  if (!p) return null

  // Second, separate check: a plain YES is required, anything else leaves it unassigned.
  const check = await o
    .ask(
      CONFIRM_INSTRUCTIONS,
      `Project: ${list.split('\n')[i]!.replace(/^\d+\.\s*/, '')}\n\nThe work:\n${work.join('\n')}${
        titles.length ? `\nRecent window titles:\n${titles.map((t) => `- ${t}`).join('\n')}` : ''
      }\n\nDoes this work obviously and specifically belong to the project "${p.name}"? Reply YES or NO.`,
    )
    .catch(() => null)
  if (!check || !/^\W*yes\b/i.test(check.text.trim())) return null
  return { projectId: p.id, judgedBy: reply.source }
}
