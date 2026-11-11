import type { ResourceRef, RestoreItemResult } from '@shared/schemas'
import type { AppAdapter } from './types'
import { errorReason, result } from './util'

/** Window frames: applied only when the user turned on "Arrange windows". */
export const arrangeAdapter: AppAdapter = {
  id: 'arrange',
  displayName: 'Window arrangement',
  bundleIds: [],
  tier: 'partial',
  needsAutomation: true,
  notes:
    'Optional, off by default. Moves/resizes a matching window back to where it was via Accessibility. Never closes, minimises or reorders other windows.',
  handles: (ref) => ref.kind === 'windowFrame',
  capture: async () => [],
  isRunning: async () => true,
  alreadyOpen: async () => false,
  describe: (ref) =>
    ref.kind === 'windowFrame'
      ? {
          action: 'arrange',
          description: `Move “${ref.windowTitle.slice(0, 60)}” to ${ref.frame.x},${ref.frame.y} (${ref.frame.w}×${ref.frame.h})`,
        }
      : { action: 'info', description: '' },
  async restore(refs, ctx) {
    const out: RestoreItemResult[] = []
    for (const ref of refs) {
      const t0 = Date.now()
      if (ref.kind !== 'windowFrame') continue
      if (!ctx.settings.arrangeWindows) {
        out.push(result(ref, 'arrange', 'skipped', 'Arrange windows is off', t0))
        continue
      }
      try {
        const f = ref.frame
        const r = await ctx.exec.script<{ ok: boolean; reason?: string }>('system-events.arrange', [
          ref.app,
          ref.windowTitle,
          String(f.x),
          String(f.y),
          String(f.w),
          String(f.h),
        ])
        out.push(
          result(
            ref,
            'arrange',
            r.ok ? 'opened' : 'skipped',
            r.ok ? 'Window moved back into place' : (r.reason ?? 'Window not found'),
            t0,
          ),
        )
      } catch (e) {
        out.push(result(ref, 'arrange', 'failed', errorReason(e), t0))
      }
    }
    return out
  },
}

/** Git state is context only: Waypoint never runs a git command that changes anything. */
export const gitAdapter: AppAdapter = {
  id: 'git',
  displayName: 'Git',
  bundleIds: ['git'],
  tier: 'partial',
  needsAutomation: false,
  notes:
    'Records repo, branch, uncommitted-file count and ahead/behind using read-only git queries. Shown for context; never checks out or changes anything.',
  handles: (ref) => ref.kind === 'gitState',
  capture: async () => [],
  isRunning: async () => true,
  alreadyOpen: async () => true,
  describe: (ref: ResourceRef) =>
    ref.kind === 'gitState'
      ? {
          action: 'info',
          description: `${ref.repoPath.split('/').pop()} was on ${ref.branch} with ${ref.dirtyFiles} uncommitted file${ref.dirtyFiles === 1 ? '' : 's'}`,
          reason: 'For context only. Waypoint never changes branches.',
        }
      : { action: 'info', description: '' },
  restore: async (refs) =>
    refs.map((r) =>
      result(r, 'git', 'skipped', 'For context only. Waypoint never changes branches.'),
    ),
}
