import type { ResourceRef, RestoreItemResult, RestoreStatus } from '@shared/schemas'
import { SafeExecError } from '../safe-exec'

export function result(
  ref: ResourceRef,
  adapterId: string,
  status: RestoreStatus,
  reason?: string,
  t0?: number,
): RestoreItemResult {
  return { ref, adapterId, status, reason, durationMs: t0 ? Date.now() - t0 : undefined }
}

export function errorReason(e: unknown): string {
  if (e instanceof SafeExecError) {
    switch (e.code) {
      case 'not-authorized':
        return `${e.message}. Allow it in System Settings → Privacy & Security → Automation.`
      case 'not-found':
        return `Not found: ${e.message}`
      case 'blocked':
        return e.message
      case 'timeout':
        return 'The app took too long to answer'
      default:
        return e.message
    }
  }
  return e instanceof Error ? e.message : String(e)
}

export const basename = (p: string) => p.replace(/\/$/, '').split('/').pop() ?? p

export function shortUrl(u: string): string {
  try {
    const x = new URL(u)
    return x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname.slice(0, 40) : '')
  } catch {
    return u.slice(0, 60)
  }
}
