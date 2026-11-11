import { randomUUID } from 'node:crypto'
import type { Settings } from '@shared/constants'
import type {
  Checkpoint,
  ResourceRef,
  RestoreItemResult,
  RestorePlan,
  RestorePlanItem,
  RestoreReport,
} from '@shared/schemas'
import type { AdapterRegistry } from '../adapters/registry'
import type { AppWindowInfo, RestoreContext } from '../adapters/types'
import { errorReason, result } from '../adapters/util'
import type { SafeExec } from '../safe-exec'

export interface RestoreDeps {
  exec: SafeExec
  registry: AdapterRegistry
  getSettings: () => Settings
  readWindows: () => Promise<AppWindowInfo[]>
  onProgress?: (r: RestoreReport) => void
  onFinished?: (r: RestoreReport) => void
  sleep?: (ms: number) => Promise<void>
}

/** Restore order: apps first, then resources (by kind), then optional window arrangement. */
const KIND_ORDER: Record<ResourceRef['kind'], number> = {
  app: 0,
  workspace: 1,
  folder: 2,
  terminalCwd: 3,
  file: 4,
  url: 5,
  doc: 5,
  deepLink: 6,
  draft: 7,
  message: 7,
  note: 8,
  calendarEvent: 9,
  gitState: 10,
  windowFrame: 11,
}

/**
 * Idempotent, ordered, cancellable restore.
 *  - Every item runs in its own try/catch; one failure never aborts the rest.
 *  - Adapters focus existing items instead of opening duplicates.
 *  - No retries (a retry could create a duplicate tab/window).
 *  - Cancel stops before the next item; remaining items are reported as cancelled.
 */
export class RestoreEngine {
  private runs = new Map<string, { report: RestoreReport; cancel: boolean }>()

  constructor(private readonly d: RestoreDeps) {}

  plan(cp: Checkpoint): RestorePlan {
    const s = this.d.getSettings()
    const items: RestorePlanItem[] = orderRefs(cp.resources).map((ref) => {
      const a = this.d.registry.forRef(ref)
      let desc = a.describe(ref)
      if (ref.kind === 'windowFrame' && !s.arrangeWindows)
        desc = {
          action: 'skip',
          description: desc.description,
          reason: 'Arrange windows is off (Settings → Restore)',
        }
      return {
        ref,
        adapterId: a.id,
        adapterName: a.displayName,
        tier: a.tier,
        action: desc.action,
        description: desc.description,
        reason: desc.reason,
      }
    })
    return { checkpointId: cp.id, items, arrangeWindows: s.arrangeWindows }
  }

  report(runId: string): RestoreReport | null {
    return this.runs.get(runId)?.report ?? null
  }

  cancel(runId: string): void {
    const r = this.runs.get(runId)
    if (r) r.cancel = true
  }

  /** Starts a run in the background and returns its id immediately. */
  start(cp: Checkpoint, skip: number[] = []): string {
    const runId = randomUUID()
    const report: RestoreReport = {
      runId,
      checkpointId: cp.id,
      startedAt: Date.now(),
      cancelled: false,
      results: [],
    }
    this.runs.set(runId, { report, cancel: false })
    void this.execute(runId, this.plan(cp), new Set(skip))
    return runId
  }

  /** Runs to completion (used by tests and by start()). */
  async execute(runId: string, plan: RestorePlan, skip: Set<number>): Promise<RestoreReport> {
    let entry = this.runs.get(runId)
    if (!entry) {
      entry = {
        report: {
          runId,
          checkpointId: plan.checkpointId,
          startedAt: Date.now(),
          cancelled: false,
          results: [],
        },
        cancel: false,
      }
      this.runs.set(runId, entry)
    }
    const run = entry
    const sleep = this.d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    const runningCache = new Map<string, boolean>()
    let windowsCache: Promise<AppWindowInfo[]> | null = null
    const ctx: RestoreContext = {
      exec: this.d.exec,
      settings: this.d.getSettings(),
      isCancelled: () => run.cancel,
      sleep,
      windows: () => (windowsCache ??= this.d.readWindows().catch(() => [])),
      isRunning: async (b) => {
        if (runningCache.has(b)) return runningCache.get(b)!
        let r: boolean
        try {
          r = (await this.d.exec.script<{ running: boolean }>('app.running', [b])).running
        } catch {
          r = false
        }
        runningCache.set(b, r)
        return r
      },
    }
    const push = (r: RestoreItemResult) => {
      run.report.results.push(r)
      // Launching or focusing an app changes its running state.
      if (r.status === 'opened' || r.status === 'already-open') runningCache.set(r.ref.app, true)
      this.d.onProgress?.(structuredClone(run.report))
    }

    for (let i = 0; i < plan.items.length; i++) {
      const item = plan.items[i]!
      if (run.cancel) {
        push(result(item.ref, item.adapterId, 'cancelled', 'Restore was cancelled'))
        continue
      }
      if (skip.has(i)) {
        push(result(item.ref, item.adapterId, 'skipped', 'You unchecked this item'))
        continue
      }
      if (item.action === 'skip' || item.action === 'info') {
        push(
          result(
            item.ref,
            item.adapterId,
            'skipped',
            item.reason ?? (item.action === 'info' ? 'Shown for context only' : 'Skipped'),
          ),
        )
        continue
      }
      const t0 = Date.now()
      try {
        const adapter = this.d.registry.forRef(item.ref)
        const res = await withTimeout(adapter.restore([item.ref], ctx), 15_000)
        const r = res[0] ?? result(item.ref, adapter.id, 'failed', 'Adapter returned no result', t0)
        push({ ...r, durationMs: r.durationMs ?? Date.now() - t0 })
      } catch (e) {
        push(result(item.ref, item.adapterId, 'failed', errorReason(e), t0))
      }
    }
    run.report.finishedAt = Date.now()
    run.report.cancelled = run.cancel
    this.d.onProgress?.(structuredClone(run.report))
    this.d.onFinished?.(run.report)
    return run.report
  }
}

export function orderRefs(refs: ResourceRef[]): ResourceRef[] {
  return refs
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        KIND_ORDER[a.r.kind] - KIND_ORDER[b.r.kind] ||
        (a.r.focused ? 1 : 0) - (b.r.focused ? 1 : 0) ||
        a.i - b.i,
    )
    .map((x) => x.r)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timed out')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}
