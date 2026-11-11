import type { Checkpoint, CheckpointTrigger } from '@shared/schemas'
import type { CaptureEngine } from '../capture/engine'
import { refKey } from '../capture/engine'
import { signalsForRef } from '../capture/signals'
import type { Store } from '../db/store'
import { matchProject } from '../inference/match'
import type { Summarizer } from '../summarizer/types'
import { scopeRefs } from './scope'

export interface CheckpointServiceDeps {
  store: Store
  engine: CaptureEngine
  summarizer: Summarizer
  onCreated?: (cp: Checkpoint) => void
}

/** Creates checkpoints: capture → privacy filter (in engine) → project scope → summary → store. */
export class CheckpointService {
  private lastFingerprint = new Map<string, { fp: string; at: number }>()

  constructor(private readonly d: CheckpointServiceDeps) {}

  /**
   * @param projectId  explicit project, or undefined to infer from what's on screen.
   * Automatic triggers are skipped when nothing changed since the last checkpoint of that project.
   */
  async create(trigger: CheckpointTrigger, projectId?: string | null): Promise<Checkpoint | null> {
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
    const usedApps = new Set(
      store
        .recentActivity(Math.max(since, Date.now() - 8 * 3600_000))
        .filter((e) => !project || e.projectId === project.id || e.projectId === null)
        .map((e) => e.bundleId),
    )
    const refs = scopeRefs(snap.refs, project, usedApps, engine.git.repoRootOf)

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
    if (summary.source === 'ollama')
      store.audit('summarize', 'Summary written by local Ollama model', { checkpointId: cp.id })
    this.lastFingerprint.set(key, { fp, at: Date.now() })
    this.d.onCreated?.(cp)
    return cp
  }
}
