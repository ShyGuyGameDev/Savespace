import type { Settings } from '@shared/constants'
import type { RestoreItemResult, ResourceRef } from '@shared/schemas'
import type { SafeExec } from '../safe-exec'

/** One visible app as seen by System Events (or lsappinfo in degraded mode). */
export interface AppWindowInfo {
  name: string
  bundleId: string | null
  pid: number | null
  frontmost: boolean
  windows: {
    title: string | null
    position: [number, number] | null
    size: [number, number] | null
    document: string | null
  }[]
}

export interface CaptureContext {
  exec: SafeExec
  settings: Settings
  /** Visible apps and windows. Empty window lists when Accessibility is not granted. */
  apps: AppWindowInfo[]
  accessibility: boolean
  isRunning(bundleId: string): boolean
  /** Report an Automation outcome (keeps the Privacy center accurate). */
  noteAutomation(bundleId: string, state: 'granted' | 'denied'): void
  /** Where adapters may write temporary copies (inside Savespace's own data dir). */
  tempDir: string
  homeDir: string
}

export interface RestoreContext {
  exec: SafeExec
  settings: Settings
  /** Cheap cache of running state for this restore run. */
  isRunning(bundleId: string): Promise<boolean>
  isCancelled(): boolean
  /** Visible windows at the start of the run (empty without Accessibility). Cached per run. */
  windows(): Promise<AppWindowInfo[]>
  /** Small wait used after launching an app before talking to it. */
  sleep(ms: number): Promise<void>
}

export type Tier = 'deep' | 'partial' | 'launch-only'

export interface PlanDescription {
  action: 'launch' | 'focus' | 'open' | 'focus-existing' | 'arrange' | 'skip' | 'info'
  description: string
  reason?: string
}

export interface AppAdapter {
  id: string
  displayName: string
  bundleIds: string[]
  tier: Tier
  /** Needs a per-app Automation consent for deep features. */
  needsAutomation: boolean
  /** What exactly this adapter captures/restores, shown in the support matrix and settings. */
  notes: string
  /** Read-only metadata capture. Must never change anything. */
  capture(ctx: CaptureContext): Promise<ResourceRef[]>
  /** Open-only restore. One result per ref, never throws for a single item. */
  restore(refs: ResourceRef[], ctx: RestoreContext): Promise<RestoreItemResult[]>
  isRunning(ctx: RestoreContext): Promise<boolean>
  alreadyOpen(ref: ResourceRef, ctx: RestoreContext): Promise<boolean>
  /** Which refs this adapter knows how to restore (beyond its own bundle ids, e.g. URL hosts). */
  handles?(ref: ResourceRef): boolean
  describe(ref: ResourceRef): PlanDescription
}
