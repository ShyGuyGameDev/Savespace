import { createHash } from 'node:crypto'
import type { Project, Suggestion } from '@shared/schemas'
import { signalMatches, splitSignal } from '../capture/signals'

export interface EventLite {
  at: number
  signals: string[]
  projectId: string | null
  windowTitle: string | null
}

export type SuggestionDraft = Omit<Suggestion, 'id' | 'status' | 'createdAt'> & {
  fingerprint: string
}

const WINDOW_MS = 10 * 60_000
const ANCHOR_KINDS = new Set(['repo', 'path', 'host', 'cal'])

const bucket = (at: number) => Math.floor(at / WINDOW_MS)
const fp = (...parts: string[]) =>
  createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)

export function covered(sig: string, projects: Project[]): boolean {
  return projects.some((p) =>
    p.signals.some((ps) => signalMatches(ps, sig) || signalMatches(sig, ps)),
  )
}

/** Folders that are too broad to be a project on their own. */
export function tooBroad(sig: string, home: string): boolean {
  const [k, v] = splitSignal(sig)
  if (k !== 'path' && k !== 'repo') return false
  const generic = [
    '',
    '/',
    '/Users',
    home,
    `${home}/Desktop`,
    `${home}/Documents`,
    `${home}/Downloads`,
    `${home}/Library`,
    '/Applications',
    '/tmp',
    '/private',
    '/Volumes',
  ]
  if (generic.includes(v)) return true
  return (
    v.split('/').filter(Boolean).length < 3 || v.includes('/Library/') || v.startsWith('/private/')
  )
}

export function nameFromSignal(sig: string): string {
  const [k, v] = splitSignal(sig)
  if (k === 'repo' || k === 'path') return prettify(v.split('/').filter(Boolean).pop() ?? v)
  if (k === 'host') return prettify(v.replace(/^(www|app)\./, '').split('.')[0] ?? v)
  if (k === 'cal') return prettify(v)
  return prettify(v)
}

function prettify(s: string): string {
  return s
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 60)
}

/**
 * Proposes projects from the activity buffer. Nothing is created here; the user confirms in the inbox.
 *  - new-project: a strong signal (repo, folder, host, recurring calendar title) seen in ≥ 3 samples across
 *    ≥ 2 separate 10-minute windows and not covered by an existing project. Signals that co-occur with it
 *    in ≥ 40 % of its windows join the suggestion (e.g. a Jira host used alongside a repo).
 */
export function computeSuggestions(
  events: EventLite[],
  projects: Project[],
  home: string,
  /** How often an anchor must be seen. "Look again" relaxes this when the normal rules find nothing. */
  min: { samples: number; windows: number } = { samples: 3, windows: 2 },
): SuggestionDraft[] {
  const out: SuggestionDraft[] = []
  const active = projects.filter((p) => !p.archived)

  // ---- new-project ----
  const windowsBySig = new Map<string, Set<number>>()
  const countBySig = new Map<string, number>()
  const sigsByWindow = new Map<number, Set<string>>()
  for (const e of events) {
    const b = bucket(e.at)
    const ws = sigsByWindow.get(b) ?? new Set<string>()
    for (const s of e.signals) {
      ws.add(s)
      countBySig.set(s, (countBySig.get(s) ?? 0) + 1)
      const set = windowsBySig.get(s) ?? new Set<number>()
      set.add(b)
      windowsBySig.set(s, set)
    }
    sigsByWindow.set(b, ws)
  }

  const anchors = [...windowsBySig.entries()]
    .filter(
      ([s, w]) =>
        ANCHOR_KINDS.has(splitSignal(s)[0]) &&
        (countBySig.get(s) ?? 0) >= min.samples &&
        w.size >= min.windows &&
        !covered(s, active) &&
        !tooBroad(s, home),
    )
    .sort((a, b) => b[1].size - a[1].size)

  const used = new Set<string>()
  for (const [anchor, wins] of anchors) {
    if (used.has(anchor)) continue
    // Prefer repo roots over sub-paths of the same repo.
    if ([...used].some((u) => signalMatches(u, anchor))) continue
    const co = new Map<string, number>()
    for (const w of wins)
      for (const s of sigsByWindow.get(w) ?? []) if (s !== anchor) co.set(s, (co.get(s) ?? 0) + 1)
    const companions = [...co.entries()]
      .filter(
        ([s, n]) =>
          n / wins.size >= 0.4 &&
          !covered(s, active) &&
          !tooBroad(s, home) &&
          !signalMatches(anchor, s) &&
          splitSignal(s)[0] !== 'token',
      )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s]) => s)
    const signals = [anchor, ...companions]
    for (const s of signals) used.add(s)
    const titles = events
      .filter((e) => e.signals.includes(anchor) && e.windowTitle)
      .map((e) => e.windowTitle!)
      .filter((t, i, a) => a.indexOf(t) === i)
      .slice(-3)
    out.push({
      kind: 'new-project',
      name: nameFromSignal(anchor),
      signals,
      evidence: [
        `Seen in ${countBySig.get(anchor)} samples over ${wins.size} sessions`,
        ...companions.map((c) => `Used together with ${c.replace(':', ' ')}`),
        ...titles.map((t) => `Window: ${t}`),
      ].slice(0, 6),
      score: wins.size + companions.length * 0.5,
      targetProjectIds: [],
      fingerprint: fp('new', anchor),
    })
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 20)
}
