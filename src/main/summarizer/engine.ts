import type { EngineProcess as ChildProcess } from '../safe-exec/service'
import { spawnEngine } from '../safe-exec/service'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { allowLoopbackPort, guardedFetch, revokeLoopbackPort } from '../net'
import { EgressGate } from './egress'

export type EngineState = 'missing' | 'stopped' | 'starting' | 'running' | 'crashed'

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

/**
 * Waypoint's own copy of the Ollama engine, bundled in the app. It runs only while Waypoint runs,
 * listens only on 127.0.0.1 (random port), keeps models in Waypoint's data folder, and has
 * Ollama's cloud features disabled. Users never install anything separately.
 */
export class AiEngine {
  state: EngineState
  port: number | null = null
  private proc: ChildProcess | null = null
  private restarts = 0
  private stopping = false
  private starting: Promise<void> | null = null
  readonly egress: EgressGate

  constructor(
    readonly binary: string,
    readonly modelsDir: string,
    readonly home: string,
    private readonly log: (line: string) => void = () => {},
    onBlocked: (target: string) => void = () => {},
  ) {
    this.state = existsSync(binary) ? 'stopped' : 'missing'
    this.egress = new EgressGate(onBlocked)
  }

  get available(): boolean {
    return existsSync(this.binary)
  }

  baseUrl(): string {
    return this.port ? `http://127.0.0.1:${this.port}` : 'http://127.0.0.1:0'
  }

  /** Starts the engine (idempotent). Resolves once it answers, or throws. */
  start(): Promise<void> {
    if (this.state === 'running') return Promise.resolve()
    this.starting ??= this.doStart().finally(() => (this.starting = null))
    return this.starting
  }

  private async doStart(): Promise<void> {
    if (!this.available) {
      this.state = 'missing'
      throw new Error('The AI engine is not bundled in this build')
    }
    this.stopping = false
    this.state = 'starting'
    mkdirSync(this.modelsDir, { recursive: true, mode: 0o700 })
    mkdirSync(this.home, { recursive: true, mode: 0o700 })
    const proxyPort = await this.egress.start()
    const port = await freePort()
    this.port = port
    allowLoopbackPort(port)
    const proc = spawnEngine(
      { binary: this.binary, port, proxyPort, modelsDir: this.modelsDir, home: this.home },
      this.binary,
    )
    this.proc = proc
    proc.stderr?.on('data', (d: Buffer) => this.log(d.toString().trim().slice(0, 400)))
    proc.on('exit', (code) => {
      revokeLoopbackPort(port)
      if (this.proc !== proc) return
      this.proc = null
      if (this.stopping) {
        this.state = 'stopped'
        return
      }
      this.state = 'crashed'
      this.log(`[ai-engine] exited unexpectedly (code ${code})`)
      if (this.restarts++ < 2) setTimeout(() => void this.start().catch(() => {}), 3000)
    })
    for (let i = 0; i < 60; i++) {
      try {
        const r = await guardedFetch(`${this.baseUrl()}/api/version`, { timeoutMs: 1000 })
        if (r.ok) {
          this.state = 'running'
          return
        }
      } catch {
        /* not up yet */
      }
      if (!this.proc) break
      await new Promise((r) => setTimeout(r, 500))
    }
    this.stop()
    this.state = 'crashed'
    throw new Error('The AI engine did not start')
  }

  stop(): void {
    this.stopping = true
    if (this.port) revokeLoopbackPort(this.port)
    this.proc?.kill('SIGTERM')
    this.proc = null
    this.egress.stop()
    if (this.state !== 'missing') this.state = 'stopped'
  }
}
