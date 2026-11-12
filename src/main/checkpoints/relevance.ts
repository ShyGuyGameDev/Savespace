import type { Project, ResourceRef } from '@shared/schemas'
import { refKey } from '../capture/engine'
import { signalMatches, signalsForRef } from '../capture/signals'
import { describeRef } from '../db/store'
import { matchesPinned } from '../inference/project-apps'

/** One activity sample from the rolling buffer (taken about once a minute). */
export interface UsageEvent {
  at: number
  bundleId: string
  appName: string
  windowTitle: string | null
  ref: unknown
}

export type Ask = (
  instructions: string,
  prompt: string,
) => Promise<{ text: string; source: 'apple' | 'ollama' } | null>

export interface RelevanceResult {
  kept: ResourceRef[]
  dropped: { ref: ResourceRef; why: 'not-used' | 'unrelated' }[]
  /** Which AI judged relevance (null = rules only). */
  judgedBy: 'apple' | 'ollama' | null
}

export const RELEVANCE_INSTRUCTIONS = `You help decide which open items do NOT belong to a piece of work. You get a description of the work and a numbered list of items the person had open. Reply with ONLY the numbers of the items that are clearly unrelated to that work, separated by commas, for example: 3, 4. Reply NONE if every item could be part of it. Clearly unrelated means things like entertainment, music, shopping, social media, news, or another unrelated project. Code, documents, tickets, technical references and work chat about the topic are related. If unsure, treat the item as related (do not list it).`

const normUrl = (u: string) => u.replace(/#.*$/, '').replace(/\/$/, '')

function usageKey(r: ResourceRef): string {
  return r.kind === 'url' || r.kind === 'doc' ? `${r.kind}:${normUrl(r.url)}` : refKey(r)
}

function label(
  r: ResourceRef,
  appName: (b: string) => string,
  lastTitle?: (b: string) => string | null,
): string {
  const app = appName(r.app)
  switch (r.kind) {
    case 'url':
    case 'doc':
      try {
        return `[${app} tab] ${r.title ?? ''} (${new URL(r.url).hostname.replace(/^www\./, '')})`.slice(
          0,
          200,
        )
      } catch {
        return `[${app} tab] ${r.title ?? r.url}`.slice(0, 200)
      }
    case 'file':
      return `[${app} file] ${r.path.split('/').slice(-2).join('/')}`
    case 'app': {
      // A bare app (e.g. Slack) is judged by what its window showed, e.g. the channel name.
      const t = lastTitle?.(r.app)
      return `[app] ${r.title ?? app}${t ? ` showing "${t.slice(0, 120)}"` : ''}`
    }
    default:
      return `[${app}] ${describeRef(r)}`.slice(0, 200)
  }
}

/** Parses "2, 5, 6" / "Items 2 and 5" / "NONE" into 1-based indices. Null if unparseable. */
export function parseNumbers(text: string, max: number): Set<number> | null {
  const t = text.trim()
  if (/^\W*none\W*$/i.test(t)) return new Set()
  const nums = [...t.matchAll(/\b(\d{1,3})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 1 && n <= max)
  return nums.length ? new Set(nums) : null
}

/**
 * Keeps only the tabs, files and apps that were actually in use AND relate to the project.
 *  1. Items matching the project's own signals (its repo, folders, sites) are kept.
 *  2. Items not used during this session (never in front in any activity sample) are dropped,
 *     unless there isn't enough activity history to tell (then everything open is a candidate).
 *  3. The local AI decides which remaining in-use items relate to the work. Without AI, in-use items are kept.
 *  4. App entries, window positions and git state follow the items that were kept.
 */
export async function selectRelevant(o: {
  refs: ResourceRef[]
  project: Project | null
  events: UsageEvent[]
  repoRootOf: (p: string) => string | null
  ask?: Ask
  appName?: (bundleId: string) => string
}): Promise<RelevanceResult> {
  const appName =
    o.appName ??
    ((b: string) => o.events.find((e) => e.bundleId === b)?.appName ?? b.split('.').pop() ?? b)
  const enoughHistory = o.events.length >= 3

  // --- usage counts (samples in which the item / app was in front) ---
  const itemUse = new Map<string, number>()
  const appUse = new Map<string, number>()
  const titleUse = new Map<string, number>()
  for (const e of o.events) {
    appUse.set(e.bundleId, (appUse.get(e.bundleId) ?? 0) + 1)
    if (e.windowTitle)
      titleUse.set(
        `${e.bundleId}|${e.windowTitle}`,
        (titleUse.get(`${e.bundleId}|${e.windowTitle}`) ?? 0) + 1,
      )
    const ref = e.ref as ResourceRef | null
    if (ref && typeof ref === 'object' && 'kind' in ref)
      itemUse.set(usageKey(ref), (itemUse.get(usageKey(ref)) ?? 0) + 1)
  }
  const lastTitle = (b: string): string | null =>
    [...o.events].reverse().find((e) => e.bundleId === b && e.windowTitle)?.windowTitle ?? null
  const usage = (r: ResourceRef): number => {
    let n = itemUse.get(usageKey(r)) ?? 0
    if (r.title)
      for (const [k, c] of titleUse)
        if (k.startsWith(`${r.app}|`) && k.slice(r.app.length + 1).includes(r.title)) n += c
    return n
  }

  const matchesProject = (r: ResourceRef) =>
    !!o.project?.signals.length &&
    signalsForRef(r, o.repoRootOf).some((s) =>
      o.project!.signals.some((ps) => signalMatches(ps, s)),
    )

  const items = o.refs.filter(
    (r) => r.kind !== 'app' && r.kind !== 'windowFrame' && r.kind !== 'gitState',
  )
  const appsWithItems = new Set(items.map((r) => r.app))
  const bareApps = o.refs.filter((r) => r.kind === 'app' && !appsWithItems.has(r.app))

  const kept = new Set<ResourceRef>()
  const dropped: RelevanceResult['dropped'] = []
  const candidates: { ref: ResourceRef; use: number }[] = []

  // A project made of chosen apps: their pinned items are always kept. With "Only restore these
  // apps" on, nothing else belongs (other apps, and unpinned items in apps that have pinned ones).
  const projectApps = o.project?.apps?.length
    ? new Map(o.project.apps.map((a) => [a.bundleId, a]))
    : null
  const onlyApps = !!projectApps && o.project!.onlyApps !== false

  for (const r of items) {
    if (projectApps) {
      const pa = projectApps.get(r.app)
      if (pa && matchesPinned(r, pa.items)) {
        kept.add(r)
        continue
      }
      if (onlyApps && (!pa || pa.items.length > 0)) {
        dropped.push({ ref: r, why: 'unrelated' })
        continue
      }
    }
    if (matchesProject(r)) kept.add(r)
    else if (!enoughHistory || usage(r) > 0 || r.focused) candidates.push({ ref: r, use: usage(r) })
    else dropped.push({ ref: r, why: 'not-used' })
  }
  for (const r of bareApps) {
    if (projectApps?.has(r.app)) {
      kept.add(r) // apps chosen for the project are always kept
      continue
    }
    if (onlyApps) {
      dropped.push({ ref: r, why: 'unrelated' }) // not one of the project's apps
      continue
    }
    if (!enoughHistory || (appUse.get(r.app) ?? 0) > 0 || r.focused)
      candidates.push({ ref: r, use: appUse.get(r.app) ?? 0 })
    else dropped.push({ ref: r, why: 'not-used' })
  }

  // --- AI relevance check for the in-use items ---
  let judgedBy: RelevanceResult['judgedBy'] = null
  candidates.sort((a, b) => b.use - a.use)
  if (candidates.length && o.ask) {
    // What is "the work"? The project if known; otherwise the item(s) used most.
    const anchors = o.project
      ? []
      : candidates.filter((c, i) => i === 0 || c.ref.focused).slice(0, 2)
    const toJudge = candidates.filter((c) => !anchors.includes(c)).slice(0, 40)
    for (const a of anchors) kept.add(a.ref)
    if (toJudge.length) {
      const work = o.project
        ? `Project "${o.project.name}".${
            kept.size
              ? ` It includes: ${[...kept]
                  .slice(0, 6)
                  .map((r) => label(r, appName))
                  .join('; ')}.`
              : ''
          }`
        : `What the person was mainly doing: ${anchors.map((a) => label(a.ref, appName)).join('; ')}.`
      const list = toJudge.map((c, i) => `${i + 1}. ${label(c.ref, appName, lastTitle)}`).join('\n')
      const reply = await o
        .ask(
          RELEVANCE_INSTRUCTIONS,
          `The work: ${work}\n\nItems:\n${list}\n\nWhich item numbers are clearly unrelated to this work?`,
        )
        .catch(() => null)
      const picks = reply ? parseNumbers(reply.text, toJudge.length) : null
      if (picks) {
        judgedBy = reply!.source
        toJudge.forEach((c, i) =>
          picks.has(i + 1) ? dropped.push({ ref: c.ref, why: 'unrelated' }) : kept.add(c.ref),
        )
      } else for (const c of toJudge) kept.add(c.ref) // AI unavailable or unclear: keep what was in use
    }
  } else for (const c of candidates) kept.add(c.ref)

  // --- follow-ups: apps, window positions and git state of what was kept ---
  const keptApps = new Set([...kept].map((r) => r.app))
  const keptPaths = [...kept].flatMap((r) =>
    'path' in r && typeof r.path === 'string' ? [r.path] : [],
  )
  const out: ResourceRef[] = []
  for (const r of o.refs) {
    if (kept.has(r)) out.push(r)
    else if (r.kind === 'app' && appsWithItems.has(r.app) && keptApps.has(r.app)) out.push(r)
    else if (r.kind === 'windowFrame' && keptApps.has(r.app)) out.push(r)
    else if (
      r.kind === 'gitState' &&
      (matchesProject(r) ||
        keptPaths.some((p) => p === r.repoPath || p.startsWith(r.repoPath + '/')))
    )
      out.push(r)
  }
  return { kept: out, dropped, judgedBy }
}
