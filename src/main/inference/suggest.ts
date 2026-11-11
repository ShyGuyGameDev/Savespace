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

function covered(sig: string, projects: Project[]): boolean {
  return projects.some((p) =>
    p.signals.some((ps) => signalMatches(ps, sig) || signalMatches(sig, ps)),
  )
}

/** Folders that are too broad to be a project on their own. */
function tooBroad(sig: string, home: string): boolean {
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
 *  - merge: two confirmed projects whose activity overlaps in ≥ 60 % of the smaller one's windows.
 *  - split: one project whose strong signals form two groups that never share a window.
 */
export function computeSuggestions(
  events: EventLite[],
  projects: Project[],
  home: string,
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
        (countBySig.get(s) ?? 0) >= 3 &&
        w.size >= 2 &&
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

  // ---- merge ----
  const winsByProject = new Map<string, Set<number>>()
  for (const e of events)
    if (e.projectId) {
      const s = winsByProject.get(e.projectId) ?? new Set<number>()
      s.add(bucket(e.at))
      winsByProject.set(e.projectId, s)
    }
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!,
        b = active[j]!
      const wa = winsByProject.get(a.id),
        wb = winsByProject.get(b.id)
      if (!wa || !wb || wa.size < 3 || wb.size < 3) continue
      // A window counts as shared if the other project is active in it or the adjacent one.
      const shared = [...wa].filter((w) => wb.has(w) || wb.has(w - 1) || wb.has(w + 1)).length
      const ratio = shared / Math.min(wa.size, wb.size)
      if (ratio >= 0.6) {
        const [keep, fold] = wa.size >= wb.size ? [a, b] : [b, a]
        out.push({
          kind: 'merge',
          name: keep.name,
          signals: [...new Set([...keep.signals, ...fold.signals])],
          evidence: [
            `“${fold.name}” and “${keep.name}” were used together in ${Math.round(ratio * 100)}% of sessions`,
          ],
          score: ratio * 5,
          targetProjectIds: [keep.id, fold.id],
          fingerprint: fp('merge', ...[a.id, b.id].sort()),
        })
      }
    }
  }

  // ---- split ----
  for (const p of active) {
    const strong = p.signals.filter(
      (s) => ANCHOR_KINDS.has(splitSignal(s)[0]) && splitSignal(s)[0] !== 'host',
    )
    if (strong.length < 2) continue
    const winsOf = (s: string) =>
      new Set(
        events
          .filter((e) => e.projectId === p.id && e.signals.some((o) => signalMatches(s, o)))
          .map((e) => bucket(e.at)),
      )
    const groups: { sigs: string[]; wins: Set<number> }[] = []
    for (const s of strong) {
      const w = winsOf(s)
      if (w.size < 3) continue
      const g = groups.find((g) => [...w].some((x) => g.wins.has(x)))
      if (g) {
        g.sigs.push(s)
        for (const x of w) g.wins.add(x)
      } else groups.push({ sigs: [s], wins: w })
    }
    if (groups.length >= 2) {
      const smaller = groups.sort((a, b) => a.wins.size - b.wins.size)[0]!
      out.push({
        kind: 'split',
        name: nameFromSignal(smaller.sigs[0]!),
        signals: smaller.sigs,
        evidence: [
          `“${p.name}” contains work that never happens at the same time: ${smaller.sigs.map((s) => s.replace(':', ' ')).join(', ')}`,
        ],
        score: 2,
        targetProjectIds: [p.id],
        fingerprint: fp('split', p.id, ...smaller.sigs.sort()),
      })
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 20)
}
