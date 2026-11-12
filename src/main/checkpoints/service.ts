import type { Checkpoint, CheckpointTrigger } from '@shared/schemas'
import type { CaptureEngine } from '../capture/engine'
import { refKey } from '../capture/engine'
import { signalsForRef } from '../capture/signals'
import type { Store } from '../db/store'
import { matchProject } from '../inference/match'
import type { Summarizer } from '../summarizer/types'
import { describeRef } from '../db/store'
import { selectRelevant, type Ask } from './relevance'

export interface CheckpointServiceDeps {
  store: Store
  engine: CaptureEngine
  summarizer: Summarizer
  /** Local AI used to judge which in-use items relate to the project (optional). */
  ask?: Ask
  onCreated?: (cp: Checkpoint) => void
}

/** Creates checkpoints: capture → privacy filter → in-use + AI relevance → summary → store. */
export class CheckpointService {
  private lastFingerprint = new Map<string, { fp: string; at: number }>()
  /** The checkpoint currently being made; repeat requests share it instead of creating duplicates. */
  private inFlight: Promise<Checkpoint | null> | null = null

  constructor(private readonly d: CheckpointServiceDeps) {}

  /**
   * @param projectId  explicit project, or undefined to infer from what's on screen.
   * Automatic triggers are skipped when nothing changed since the last checkpoint of that project.
   */
  create(trigger: CheckpointTrigger, projectId?: string | null): Promise<Checkpoint | null> {
    // One at a time: a second click / hotkey press while saving gets the same checkpoint.
    if (this.inFlight) return this.inFlight
    const p = this.doCreate(trigger, projectId).finally(() => {
      if (this.inFlight === p) this.inFlight = null
    })
    this.inFlight = p
    return p
  }

  private async doCreate(
    trigger: CheckpointTrigger,
    projectId?: string | null,
  ): Promise<Checkpoint | null> {
    const { store, engine } = this.d
    const snap = await engine.snapshot()
    const projects = store.listProjects()
    let pid = projectId
    if (pid === undefined) {
      const recent = store.recentActivity(Date.now() - 15 * 60_000)
      const observed = [
        ...recent.flatMap((e) => e.signals),
        ...snap.refs
          .filter((r) => r.focused)
          .flatMap((r) => signalsForRef(r, engine.git.repoRootOf)),
      ]
      const m = matchProject(projects, observed)
      pid = m.confidence >= 0.25 ? m.projectId : null
    }
    const project = pid ? store.getProject(pid) : null
    const since = (project?.lastCheckpointAt ?? 0) || Date.now() - 4 * 3600_000
    // Only what was actually in use during this session, and (judged by the local AI) related to the work.
    const events = store
      // "In use" = used in the last 2 hours, or since the previous checkpoint if longer (max 8 h).
      .recentActivity(
        Math.max(Math.min(since, Date.now() - 2 * 3600_000), Date.now() - 8 * 3600_000),
      )
      .filter((e) => !project || e.projectId === project.id || e.projectId === null)
    const relevance = await selectRelevant({
      refs: snap.refs,
      project,
      events,
      repoRootOf: engine.git.repoRootOf,
      ask: this.d.ask,
      appName: (b) =>
        snap.system.apps.find((a) => a.bundleId === b)?.name ??
        events.find((e) => e.bundleId === b)?.appName ??
        b,
    })
    const refs = relevance.kept

    const fp = refs
      .filter((r) => r.kind !== 'windowFrame')
      .map(refKey)
      .sort()
      .join('|')
    const key = pid ?? '∅'
    const last = this.lastFingerprint.get(key)
    if (trigger !== 'manual' && last && last.fp === fp && Date.now() - last.at < 6 * 3600_000)
      return null
    if (
      trigger !== 'manual' &&
      refs.filter((r) => r.kind !== 'app' && r.kind !== 'windowFrame').length === 0
    )
      return null

    const recentTitles = store
      .recentActivity(Date.now() - 60 * 60_000)
      .filter((e) => !project || e.projectId === project.id)
      .map((e) => e.windowTitle)
      .filter((t): t is string => !!t)
      .slice(-12)
    const summary = await this.d.summarizer.summarize({
      project,
      trigger,
      refs,
      recentTitles,
      at: snap.at,
    })
    const cp = store.createCheckpoint({
      projectId: pid ?? null,
      trigger,
      summary: summary.text,
      summarySource: summary.source,
      resources: refs,
      createdAt: snap.at,
    })
    if (summary.source !== 'template')
      store.audit(
        'summarize',
        `Summary written by ${summary.source === 'apple' ? 'Apple on-device AI' : 'the downloaded local model'}`,
        { checkpointId: cp.id },
      )
    if (relevance.dropped.length) {
      const unrelated = relevance.dropped.filter((d) => d.why === 'unrelated')
      const unused = relevance.dropped.length - unrelated.length
      store.audit(
        'capture',
        `Left out ${relevance.dropped.length} open item${relevance.dropped.length === 1 ? '' : 's'}: ${unused} not used this session, ${unrelated.length} not related${relevance.judgedBy ? ` (judged by ${relevance.judgedBy === 'apple' ? 'Apple on-device AI' : 'the downloaded model'})` : ''}`,
        {
          checkpointId: cp.id,
          leftOut: relevance.dropped.map((d) => ({ why: d.why, item: describeRef(d.ref) })),
        },
      )
    }
    this.lastFingerprint.set(key, { fp, at: Date.now() })
    this.d.onCreated?.(cp)
    return cp
  }
}
