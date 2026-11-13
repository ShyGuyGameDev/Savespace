import { ALLOWED_NETWORK_HOSTS } from './windows/security'

/**
 * The only network entry point in the main process. Refuses every host that isn't local Ollama
 * or the explicitly allowed connector hosts. No telemetry exists.
 */
/** Loopback ports of Savespace's own bundled AI engine (set when the engine starts). */
const loopbackPorts = new Set<number>()
export function allowLoopbackPort(port: number): void {
  loopbackPorts.add(port)
}
export function revokeLoopbackPort(port: number): void {
  loopbackPorts.delete(port)
}

export async function guardedFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const u = new URL(url)
  // Loopback is allowed only for the port of Savespace's own running AI engine.
  const isEngine = u.hostname === '127.0.0.1' && loopbackPorts.has(Number(u.port))
  if (!isEngine && !ALLOWED_NETWORK_HOSTS.has(u.host))
    throw new Error(`Network access to ${u.host} is not allowed`)
  if (isEngine) {
    if (u.protocol !== 'http:') throw new Error('Local services must use http on loopback')
  } else if (u.protocol !== 'https:') throw new Error('Remote APIs must use https')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000)
  init.signal?.addEventListener('abort', () => ctrl.abort())
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, redirect: 'error' })
  } finally {
    clearTimeout(t)
  }
}
