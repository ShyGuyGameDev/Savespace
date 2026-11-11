import type { AppWindowInfo } from '../adapters/types'
import { SafeExecError, type SafeExec } from '../safe-exec'

export interface SystemSnapshot {
  apps: AppWindowInfo[]
  /** True when window titles were readable (Accessibility granted). */
  windowsReadable: boolean
  /** True when the System Events process list was readable (Automation→System Events granted). */
  processesReadable: boolean
  front: { bundleId: string | null; name: string | null }
}

interface RawProc {
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

/**
 * Reads visible apps + window metadata through System Events. Degrades to `lsappinfo front`
 * (no permission needed) when System Events isn't allowed.
 */
export async function readSystem(
  exec: SafeExec,
  accessibility: boolean,
): Promise<SystemSnapshot & { automationDenied: boolean }> {
  try {
    const procs = await exec.script<RawProc[]>('system-events.windows', [], 8000)
    const front = procs.find((p) => p.frontmost)
    const anyWindows = procs.some((p) => p.windows.length > 0)
    return {
      apps: procs,
      windowsReadable: accessibility && anyWindows,
      processesReadable: true,
      front: { bundleId: front?.bundleId ?? null, name: front?.name ?? null },
      automationDenied: false,
    }
  } catch (e) {
    const denied = e instanceof SafeExecError && e.code === 'not-authorized'
    const front = await frontViaLsappinfo(exec)
    return {
      apps: front.bundleId
        ? [
            {
              name: front.name ?? front.bundleId,
              bundleId: front.bundleId,
              pid: null,
              frontmost: true,
              windows: [],
            },
          ]
        : [],
      windowsReadable: false,
      processesReadable: false,
      front,
      automationDenied: denied,
    }
  }
}

export async function frontViaLsappinfo(
  exec: SafeExec,
): Promise<{ bundleId: string | null; name: string | null }> {
  try {
    const asn = (await exec.run('lsappinfo', ['front'])).stdout.trim()
    if (!/^ASN:[\w:-]+$/.test(asn)) return { bundleId: null, name: null }
    const bid = (await exec.run('lsappinfo', ['info', '-only', 'bundleid', asn])).stdout
    const name = (await exec.run('lsappinfo', ['info', '-only', 'name', asn])).stdout
    const val = (s: string) => /="([^"]*)"/.exec(s)?.[1] ?? null
    return { bundleId: val(bid), name: val(name) }
  } catch {
    return { bundleId: null, name: null }
  }
}

/** Converts AXDocument values (file:// URLs) to POSIX paths. */
export function axDocumentPath(doc: string | null): string | null {
  if (!doc || !doc.startsWith('file://')) return null
  try {
    return decodeURIComponent(new URL(doc).pathname).replace(/\/$/, '') || null
  } catch {
    return null
  }
}
