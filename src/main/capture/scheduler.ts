import type { CheckpointTrigger } from '@shared/schemas'
import type { Store } from '../db/store'
import { matchProject } from '../inference/match'
import type { ActivitySample, Snapshot } from './engine'

export interface SchedulerDeps {
  store: Store
  sample: () => Promise<ActivitySample | null>
  snapshot?: () => Promise<Snapshot>
  checkpoint: (
    trigger: CheckpointTrigger,
    projectId?: string | null,
    snapshot?: Snapshot,
  ) => Promise<unknown>
  idleSeconds: () => number
  now?: () => Date
  onContext?: (ctx: {
    projectId: string | null
    frontApp: string | null
    confidence: number
  }) => void
  onSuggestionsDue?: () => void
}

/**
 * Hybrid capture triggers:
 *  - every tick (default 60 s): record a metadata sample in the rolling activity buffer
 *  - project switch: a different confirmed project wins two ticks in a row → checkpoint the previous one
 *  - idle: system idle ≥ threshold → checkpoint once per idle period
 *  - end of day: first tick at/after `endOfDayHour` with activity today → checkpoint once per day
 *  - sleep / lock: called by power events → checkpoint immediately
 */
export class CaptureScheduler {
  private timer: NodeJS.Timeout | null = null
  private lastSnapshot: Snapshot | undefined
  private selectedProject: string | null = null
  private contextVersion = 0
  private currentProject: string | null = null
  private candidate: { id: string | null; count: number } = { id: null, count: 0 }
  private idleFired = false
  private lastEod = ''
  private lastPrune = 0
  private ticks = 0
  private running = false
  lastContext: { projectId: string | null; frontApp: string | null; confidence: number } = {
    projectId: null,
    frontApp: null,
    confidence: 0,
  }

  constructor(private readonly d: SchedulerDeps) {}

  start(): void {
    this.stop()
    const sec = this.d.store.getSettings().captureIntervalSec
    this.timer = setInterval(() => void this.tick(), sec * 1000)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async selectProject(id: string | null): Promise<void> {
    const previous = this.currentProject
    const snapshot = this.lastSnapshot
    this.contextVersion++
    this.selectedProject = id
    this.currentProject = id
    this.lastSnapshot = previous === id ? snapshot : undefined
    this.candidate = { id: null, count: 0 }
    this.lastContext = { projectId: id, frontApp: null, confidence: id ? 1 : 0 }
    if (previous && previous !== id && snapshot && this.d.store.getSettings().captureEnabled)
      await this.d
        .checkpoint('project-switch', previous, snapshot)
        .catch((error) => console.error('[capture] switch checkpoint failed', error))
  }

  clearCaptureContext(): void {
    this.contextVersion++
    this.lastSnapshot = undefined
    this.currentProject = this.manualProject
    this.candidate = { id: null, count: 0 }
    this.lastContext = { projectId: this.manualProject, frontApp: null, confidence: 0 }
  }

  snapshotFor(projectId: string | null | undefined): Snapshot | undefined {
    return projectId && projectId === this.currentProject ? this.lastSnapshot : undefined
  }

  get manualProject(): string | null {
    const project = this.selectedProject && this.d.store.getProject(this.selectedProject)
    return project && !project.archived ? project.id : null
  }

  private now(): Date {
    return this.d.now?.() ?? new Date()
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const settings = this.d.store.getSettings()
      // Nothing is captured until the intro has explained what Savespace reads (and why macOS will ask).
      if (!settings.captureEnabled || !settings.onboardingComplete) return
      const now = this.now()

      // Idle detection first: no sampling while away.
      const idle = this.d.idleSeconds()
      if (idle >= settings.idleThresholdMin * 60) {
        if (!this.idleFired) {
          this.idleFired = true
          await this.d.checkpoint('idle', this.currentProject ?? undefined, this.lastSnapshot)
        }
        return
      }
      this.idleFired = false

      const version = this.contextVersion
      const s = await this.d.sample()
      if (version !== this.contextVersion || !this.d.store.getSettings().captureEnabled) return
      if (s) {
        const projects = this.d.store.listProjects()
        const m = matchProject(projects, s.signals)
        const pid = this.manualProject ?? (m.confidence >= 0.3 ? m.projectId : null)
        this.d.store.addActivity({
          at: now.getTime(),
          bundleId: s.bundleId,
          appName: s.appName,
          windowTitle: s.windowTitle,
          signals: s.signals,
          ref: s.refs[0] ?? null,
          projectId: pid,
        })
        this.lastContext = { projectId: pid, frontApp: s.appName, confidence: m.confidence }
        this.d.onContext?.(this.lastContext)
        const switched = this.considerSwitch(pid)
        if (pid && pid === this.currentProject && this.d.snapshot) {
          const snapshot = await this.d.snapshot()
          if (
            version === this.contextVersion &&
            this.d.store.getSettings().captureEnabled &&
            snapshot.system.front.bundleId === s.bundleId
          )
            this.lastSnapshot = snapshot
        }
        await switched
        if (version !== this.contextVersion) return
      } else if (!this.manualProject) {
        this.candidate = { id: null, count: 0 }
      }

      // End of day (once per calendar day, only if there was activity today).
      const day = now.toDateString()
      if (now.getHours() >= settings.endOfDayHour && this.lastEod !== day) {
        this.lastEod = day
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        if (this.d.store.recentActivity(startOfDay).length > 0)
          await this.d.checkpoint('end-of-day', this.currentProject ?? undefined, this.lastSnapshot)
      }

      if (now.getTime() - this.lastPrune > 6 * 3600_000) {
        this.lastPrune = now.getTime()
        this.d.store.pruneActivity(settings.activityRetentionDays, now.getTime())
      }
      if (++this.ticks % 10 === 0) this.d.onSuggestionsDue?.()
    } catch (e) {
      console.error('[capture] tick failed', e)
    } finally {
      this.running = false
    }
  }

  private async considerSwitch(pid: string | null): Promise<void> {
    if (pid === this.currentProject) {
      this.candidate = { id: null, count: 0 }
      return
    }
    if (pid === null) {
      this.candidate = { id: null, count: 0 }
      return
    }
    this.candidate =
      this.candidate.id === pid
        ? { id: pid, count: this.candidate.count + 1 }
        : { id: pid, count: 1 }
    if (!this.currentProject || this.candidate.count >= 2) {
      const previous = this.currentProject
      this.currentProject = pid
      this.candidate = { id: null, count: 0 }
      const snapshot = this.lastSnapshot
      this.lastSnapshot = undefined
      if (previous && (snapshot || !this.d.snapshot))
        await this.d
          .checkpoint('project-switch', previous, snapshot)
          .catch((error) => console.error('[capture] switch checkpoint failed', error))
    }
  }

  /** Power events: lid close / sleep / screen lock / quit. */
  async onPowerEvent(trigger: 'sleep' | 'lock' | 'quit'): Promise<void> {
    const s = this.d.store.getSettings()
    if (!s.captureEnabled || !s.onboardingComplete) return
    await this.d.checkpoint(trigger, this.currentProject ?? undefined, this.lastSnapshot)
  }

  get project(): string | null {
    return this.currentProject
  }
}
