import type { Store } from '../db/store'
import { signalMatches } from '../capture/signals'
import { signalsForRef } from '../capture/signals'
import { computeSuggestions, type SuggestionDraft } from './suggest'

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

  async refresh(): Promise<void> {
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
    )
    if (this.embed)
      drafts = await dedupeWithEmbeddings(drafts, this.embed.fn, this.embed.cos).catch(() => drafts)
    for (const d of drafts) this.store.upsertSuggestion(d)
  }

  /** Confirms a suggestion. Nothing becomes a project without this call. */
  accept(id: string, name?: string): void {
    const s = this.store.getSuggestion(id)
    if (!s || s.status !== 'pending') throw new Error('Suggestion is no longer pending')
    if (s.kind === 'new-project') {
      const p = this.store.createProject(name?.trim() || s.name, s.signals)
      // Adopt unassigned checkpoints that clearly belong to the new project.
      for (const cp of this.store.listCheckpoints({ projectId: null, limit: 500 })) {
        const sigs = cp.resources.flatMap((r) => signalsForRef(r, this.repoRootOf))
        if (sigs.some((o) => s.signals.some((ps) => signalMatches(ps, o))))
          this.store.reassignCheckpoint(cp.id, p.id)
      }
      this.store.audit('settings', `Confirmed new project “${p.name}”`, { signals: s.signals })
    } else if (s.kind === 'merge') {
      const [keep, fold] = s.targetProjectIds
      if (!keep || !fold) throw new Error('Invalid merge suggestion')
      this.store.mergeProjects(fold, keep)
      if (name?.trim()) this.store.renameProject(keep, name)
      this.store.audit('settings', `Merged projects`, { keep, fold })
    } else {
      const [target] = s.targetProjectIds
      if (!target) throw new Error('Invalid split suggestion')
      this.store.splitProject(target, name?.trim() || s.name, s.signals)
      this.store.audit('settings', `Split project`, { target, signals: s.signals })
    }
    this.store.setSuggestionStatus(id, 'accepted')
  }
}
