import type { Store } from '../db/store'
import { signalMatches } from '../capture/signals'
import { signalsForRef } from '../capture/signals'
import {
  computeSuggestions,
  covered,
  nameFromSignal,
  tooBroad,
  type SuggestionDraft,
} from './suggest'
import type { ResourceRef } from '@shared/schemas'

export type Embedder = (texts: string[]) => Promise<number[][] | null>

/** Folds near-duplicate new-project suggestions together using local embeddings (if available). */
export async function dedupeWithEmbeddings(
  drafts: SuggestionDraft[],
  embed: Embedder,
  cos: (a: number[], b: number[]) => number,
  threshold = 0.88,
): Promise<SuggestionDraft[]> {
  const fresh = drafts.filter((d) => d.kind === 'new-project')
  if (fresh.length < 2) return drafts
  const vecs = await embed(
    fresh.map((d) => `${d.name}. ${d.evidence.filter((e) => e.startsWith('Window:')).join(' ')}`),
  )
  if (!vecs || vecs.length !== fresh.length) return drafts
  const absorbed = new Set<number>()
  for (let i = 0; i < fresh.length; i++) {
    if (absorbed.has(i)) continue
    for (let j = i + 1; j < fresh.length; j++) {
      if (absorbed.has(j) || cos(vecs[i]!, vecs[j]!) < threshold) continue
      const a = fresh[i]!,
        b = fresh[j]!
      a.signals = [...new Set([...a.signals, ...b.signals])]
      a.evidence = [
        ...a.evidence,
        `Looks like the same work as “${b.name}” (local embeddings)`,
      ].slice(0, 6)
      a.score += b.score
      absorbed.add(j)
    }
  }
  const drop = new Set([...absorbed].map((i) => fresh[i]))
  return drafts.filter((d) => !drop.has(d))
}

/** Turns the activity buffer into pending suggestions and applies the user's decisions. */
export class InferenceService {
  constructor(
    private readonly store: Store,
    private readonly home: string,
    private readonly repoRootOf: (p: string) => string | null = () => null,
    private readonly embed?: { fn: Embedder; cos: (a: number[], b: number[]) => number },
  ) {}

  async refresh(min?: { samples: number; windows: number }): Promise<void> {
    const events = this.store.recentActivity(
      Date.now() - this.store.getSettings().activityRetentionDays * 86_400_000,
    )
    let drafts = computeSuggestions(
      events.map((e) => ({
        at: e.at,
        signals: e.signals,
        projectId: e.projectId,
        windowTitle: e.windowTitle,
      })),
      this.store.listProjects(),
      this.home,
      min,
    )
    if (this.embed)
      drafts = await dedupeWithEmbeddings(drafts, this.embed.fn, this.embed.cos).catch(() => drafts)
    for (const d of drafts) this.store.upsertSuggestion(d)
  }

  /**
   * "Look again": always comes back with something. Tries recent activity, then a looser pass,
   * then what's open right now; otherwise explains what to do. Never resurrects dismissed ideas.
   */
  async lookAgain(
    openNow: () => Promise<{
      refs: ResourceRef[]
      frontApp: { bundleId: string; name: string } | null
    }>,
  ): Promise<{
    found: number
    source: 'activity' | 'recent' | 'open-now' | 'none'
    message: string
  }> {
    const pendingIds = () => new Set(this.store.listSuggestions().map((x) => x.id))
    const before = pendingIds()
    const fresh = () => [...pendingIds()].filter((id) => !before.has(id)).length
    const plural = (n: number) => `${n} new suggestion${n === 1 ? '' : 's'}`

    await this.refresh()
    if (fresh())
      return {
        found: fresh(),
        source: 'activity',
        message: `Found ${plural(fresh())} from your recent work.`,
      }

    await this.refresh({ samples: 2, windows: 1 })
    if (fresh())
      return {
        found: fresh(),
        source: 'recent',
        message: `Found ${plural(fresh())} from things you used a couple of times recently.`,
      }

    const now = await openNow().catch(() => ({ refs: [] as ResourceRef[], frontApp: null }))
    const projects = this.store.listProjects()
    const counts = new Map<string, number>()
    for (const r of now.refs) {
      if (r.kind === 'app' || r.kind === 'windowFrame') continue
      for (const sig of signalsForRef(r, this.repoRootOf)) {
        const k = sig.slice(0, sig.indexOf(':'))
        if (
          !['repo', 'path', 'host'].includes(k) ||
          covered(sig, projects) ||
          tooBroad(sig, this.home)
        )
          continue
        counts.set(sig, (counts.get(sig) ?? 0) + (k === 'repo' ? 3 : 1))
      }
    }
    const anchors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
    for (const [sig] of anchors) {
      const titles = now.refs
        .filter((r) => signalsForRef(r, this.repoRootOf).includes(sig))
        .map((r) => r.title)
        .filter(Boolean)
        .slice(0, 3)
      this.store.upsertSuggestion({
        kind: 'new-project',
        name: nameFromSignal(sig),
        signals: [sig],
        evidence: ['Open on your Mac right now', ...titles.map((t) => `Open: ${t}`)],
        score: 1,
        targetProjectIds: [],
        fingerprint: `now:${sig}`,
      })
    }
    if (!anchors.length && now.frontApp && !covered(`app:${now.frontApp.bundleId}`, projects)) {
      this.store.upsertSuggestion({
        kind: 'new-project',
        name: now.frontApp.name,
        signals: [`app:${now.frontApp.bundleId}`],
        evidence: [`You’re using ${now.frontApp.name} right now`],
        score: 0.5,
        targetProjectIds: [],
        fingerprint: `now:app:${now.frontApp.bundleId}`,
      })
    }
    if (fresh())
      return {
        found: fresh(),
        source: 'open-now',
        message: `Nothing new in your recent work, so here ${fresh() === 1 ? 'is an idea' : 'are ideas'} based on what’s open right now.`,
      }

    const waiting = this.store.listSuggestions().length
    return {
      found: 0,
      source: 'none',
      message: waiting
        ? `Nothing new right now. ${waiting} suggestion${waiting === 1 ? ' is' : 's are'} still waiting below.`
        : 'Nothing new to suggest yet. Open the files, folders or sites you’re working on, then click Look again.',
    }
  }

  /** Confirms a suggestion. Nothing becomes a project without this call. */
  accept(id: string, name?: string): void {
    const s = this.store.getSuggestion(id)
    if (!s || s.status !== 'pending') throw new Error('Suggestion is no longer pending')
    if (s.kind === 'new-project') {
      const p = this.store.createProject(name?.trim() || s.name, s.signals)
      // A suggestion built around an app becomes a project made of that app.
      const appSigs = s.signals.filter((x) => x.startsWith('app:'))
      if (appSigs.length)
        this.store.updateProject(p.id, {
          apps: appSigs.map((x) => ({ bundleId: x.slice(4), name: s.name, items: [] })),
        })
      // Adopt unassigned checkpoints that clearly belong to the new project.
      for (const cp of this.store.listCheckpoints({ projectId: null, limit: 500 })) {
        const sigs = cp.resources.flatMap((r) => signalsForRef(r, this.repoRootOf))
        if (sigs.some((o) => s.signals.some((ps) => signalMatches(ps, o))))
          this.store.reassignCheckpoint(cp.id, p.id)
      }
      this.store.audit('settings', `Confirmed new project “${p.name}”`, { signals: s.signals })
    }
    this.store.setSuggestionStatus(id, 'accepted')
  }
}
