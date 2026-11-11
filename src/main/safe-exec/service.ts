import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * The only long-running child process Savespace may start: its own bundled AI engine
 * (`<app>/Contents/Resources/ollama/ollama serve`). Exact binary path, exact args, clean env
 * (no inherited proxies/tokens), no shell, bound to loopback only, cloud features off.
 */
export interface EngineSpawnOptions {
  binary: string
  port: number
  /** Savespace's egress gate; ALL of the engine's outbound traffic goes through it. */
  proxyPort: number
  modelsDir: string
  home: string
}

export const ENGINE_ARGS = ['serve'] as const

export function engineEnv(o: EngineSpawnOptions): Record<string, string> {
  if (!Number.isInteger(o.port) || o.port < 1024 || o.port > 65535)
    throw new Error('invalid engine port')
  if (!Number.isInteger(o.proxyPort) || o.proxyPort < 1024 || o.proxyPort > 65535)
    throw new Error('invalid proxy port')
  const proxy = `http://127.0.0.1:${o.proxyPort}`
  return {
    HTTPS_PROXY: proxy,
    HTTP_PROXY: proxy,
    ALL_PROXY: proxy,
    HOME: o.home,
    PATH: '/usr/bin:/bin',
    OLLAMA_HOST: `127.0.0.1:${o.port}`,
    OLLAMA_MODELS: o.modelsDir,
    OLLAMA_NO_CLOUD: '1',
    OLLAMA_NOHISTORY: '1',
    OLLAMA_KEEP_ALIVE: '5m',
    OLLAMA_MAX_LOADED_MODELS: '1',
    OLLAMA_NUM_PARALLEL: '1',
  }
}

export function spawnEngine(o: EngineSpawnOptions, allowedBinary: string): ChildProcess {
  if (o.binary !== allowedBinary || !o.binary.endsWith('/ollama/ollama') || !existsSync(o.binary)) {
    throw new Error('Blocked by SafeExec: only the bundled AI engine may be started')
  }
  return spawn(o.binary, [...ENGINE_ARGS], {
    env: engineEnv(o),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })
}
export type EngineProcess = ChildProcess
