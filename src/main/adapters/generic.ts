import type { ResourceRef, RestoreItemResult } from '@shared/schemas'
import { SafeExecError } from '../safe-exec'
import type { AppAdapter, PlanDescription, RestoreContext } from './types'
import { result, errorReason } from './util'

/**
 * Fallback for every app without a dedicated adapter: launch or focus it by bundle id.
 * Files/folders captured from a window's AXDocument are reopened with `open -b <app> -- <path>`,
 * which macOS turns into "focus the existing window" if the document is already open.
 */
export function createGenericAdapter(bundleId: string, displayName = bundleId): AppAdapter {
  return {
    id: `generic:${bundleId}`,
    displayName,
    bundleIds: [bundleId],
    tier: 'launch-only',
    needsAutomation: false,
    notes: 'Launches or focuses the app. Documents seen in its windows are reopened by path.',
    capture: async () => [],
    isRunning: (ctx) => ctx.isRunning(bundleId),
    alreadyOpen: async (ref, ctx) => ref.kind === 'app' && (await ctx.isRunning(bundleId)),
    describe: (ref) => describeGeneric(ref, displayName),
    async restore(refs, ctx) {
      const out: RestoreItemResult[] = []
      for (const ref of refs) out.push(await restoreGeneric(ref, ctx, `generic:${bundleId}`))
      return out
    },
  }
}

export function describeGeneric(ref: ResourceRef, appName: string): PlanDescription {
  switch (ref.kind) {
    case 'app':
      return { action: 'launch', description: `Open or focus ${appName}` }
    case 'file':
    case 'folder':
    case 'workspace':
      return { action: 'open', description: `Open ${ref.path.split('/').pop()} in ${appName}` }
    case 'url':
    case 'doc':
    case 'deepLink':
      return { action: 'open', description: `Open ${ref.title ?? ref.url}` }
    case 'windowFrame':
      return { action: 'arrange', description: `Place “${ref.windowTitle}” where it was` }
    default:
      return { action: 'info', description: `Shown for context: ${ref.title ?? ref.kind}` }
  }
}

export async function restoreGeneric(
  ref: ResourceRef,
  ctx: RestoreContext,
  adapterId: string,
): Promise<RestoreItemResult> {
  const t0 = Date.now()
  try {
    switch (ref.kind) {
      case 'app': {
        const running = await ctx.isRunning(ref.app)
        await ctx.exec.launchApp(ref.app)
        return result(
          ref,
          adapterId,
          running ? 'already-open' : 'opened',
          running ? 'App was already running; brought to front' : undefined,
          t0,
        )
      }
      case 'file':
      case 'folder':
      case 'workspace':
        await ctx.exec.openPath(ref.path, { bundleId: isBundleId(ref.app) ? ref.app : undefined })
        return result(ref, adapterId, 'opened', undefined, t0)
      case 'url':
      case 'doc':
      case 'deepLink':
        await ctx.exec.openUrl(ref.url)
        return result(ref, adapterId, 'opened', undefined, t0)
      default:
        return result(ref, adapterId, 'skipped', 'Nothing to open for this item', t0)
    }
  } catch (e) {
    return result(
      ref,
      adapterId,
      e instanceof SafeExecError && e.code === 'blocked' ? 'skipped' : 'failed',
      errorReason(e),
      t0,
    )
  }
}

export const isBundleId = (s: string) => /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(s)
