import type { Checkpoint, CheckpointTrigger } from '@shared/schemas'
import type { CaptureEngine, Snapshot } from '../capture/engine'
import { refKey } from '../capture/engine'
import { signalsForRef } from '../capture/signals'
import type { Store } from '../db/store'
import { matchProject } from '../inference/match'
import type { Summarizer } from '../summarizer/types'
import { describeRef } from '../db/store'
import { classifyWithAi } from './classify'
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
  private pending: Promise<unknown> = Promise.resolve()
  private manualSaves = new Map<string, Promise<Checkpoint | null>>()

  constructor(private readonly d: CheckpointServiceDeps) {}

  /**
   * @param projectId  explicit project, or undefined to infer from what's on screen.
   * Automatic triggers are skipped when nothing changed since the last checkpoint of that project.
   */
  create(
    trigger: CheckpointTrigger,
    projectId?: string | null,
    options: { snapshot?: Snapshot; handoff?: string } = {},
  ): Promise<Checkpoint | null> {
    const key =
      trigger === 'manual' && !options.handoff && !options.snapshot
        ? JSON.stringify([projectId === undefined, projectId])
        : null
    const existing = key && this.manualSaves.get(key)
    if (existing) return existing
    const save = this.pending
      .then(() => this.doCreate(trigger, projectId, options))
      .finally(() => {
        if (key) this.manualSaves.delete(key)
      })
    if (key) this.manualSaves.set(key, save)
    this.pending = save.catch(() => undefined)
    return save
  }

  private async doCreate(
    trigger: CheckpointTrigger,
    projectId: string | null | undefined,
    options: { snapshot?: Snapshot; handoff?: string },
  ): Promise<Checkpoint | null> {
    const { store, engine } = this.d
    const snap = options.snapshot ?? (await engine.snapshot())
    const projects = store.listProjects()
    let pid = projectId
    let aiFiled: { projectId: string; judgedBy: 'apple' | 'ollama' } | null = null
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
      // The rules found nothing: let the local AI look at what you were doing and, if it clearly
      // matches one of your projects, file the checkpoint under it.
      if (!pid && this.d.ask && projects.length) {
        const c = await classifyWithAi({
          projects,
          refs: snap.refs,
          events: store.recentActivity(Date.now() - 30 * 60_000),
          lastSummary: (id) =>
            store.listCheckpoints({ projectId: id, limit: 1 })[0]?.summary ?? null,
          ask: this.d.ask,
          appName: (b) => snap.system.apps.find((a) => a.bundleId === b)?.name,
        })
        if (c) {
          pid = c.projectId
          aiFiled = c
        }
      }
    }
    const project = pid ? store.getProject(pid) : null
    if (!project) pid = null
    const since = (project?.lastCheckpointAt ?? 0) || Date.now() - 4 * 3600_000
    // Only what was actually in use during this session, and (judged by the local AI) related to the work.
    const events = store
      // "In use" = used in the last 2 hours, or since the previous checkpoint if longer (max 8 h).
      .recentActivity(Math.max(Math.min(since, snap.at - 2 * 3600_000), snap.at - 8 * 3600_000))
      .filter(
        (e) => e.at <= snap.at && (!project || e.projectId === project.id || e.projectId === null),
      )
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
      .map((r) =>
        r.kind === 'gitState'
          ? JSON.stringify(r)
          : r.kind === 'file'
            ? JSON.stringify([refKey(r), r.line, r.column, r.focused])
            : JSON.stringify([refKey(r), r.focused]),
      )
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
      .recentActivity(snap.at - 60 * 60_000)
      .filter((e) => e.at <= snap.at && (!project || e.projectId === project.id))
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
      handoff: options.handoff,
      createdAt: snap.at,
    })
    if (summary.source !== 'template')
      store.audit(
        'summarize',
        `Summary written by ${summary.source === 'apple' ? 'Apple on-device AI' : 'the downloaded local model'}`,
        { checkpointId: cp.id },
      )
    if (aiFiled && project)
      store.audit(
        'capture',
        `Filed under “${project.name}” (judged by ${aiFiled.judgedBy === 'apple' ? 'Apple on-device AI' : 'the downloaded model'})`,
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
