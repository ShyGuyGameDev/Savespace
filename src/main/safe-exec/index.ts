import { execFile } from 'node:child_process'
import { extname } from 'node:path'
import { SCRIPT_TIMEOUT_MS } from '@shared/constants'
import { BINARIES, resolveBinary } from './allowlist'
import { SCRIPTS, type ScriptId } from './scripts/registry'

/**
 * SafeExec: the ONLY place in Waypoint that starts processes.
 *  - Uses execFile with argument arrays (no shell, no string concatenation).
 *  - Only binaries in the allowlist, each with an argument validator.
 *  - osascript only runs registered templates; parameters go through argv, never into the source.
 *  - `open` refuses executable/script files and non-allowlisted URL schemes.
 */

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

export type Runner = (file: string, args: string[], timeoutMs: number) => Promise<ExecResult>

export interface ExecRecord {
  at: number
  binary: string
  args: string[]
  scriptId?: string
  ok: boolean
  error?: string
}

export class SafeExecError extends Error {
  constructor(
    message: string,
    public readonly code:
      'blocked' | 'not-found' | 'failed' | 'timeout' | 'not-authorized' | 'not-running',
  ) {
    super(message)
  }
}

export const defaultRunner: Runner = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, shell: false },
      (err, stdout, stderr) => {
        let code = 0
        if (err) {
          const e = err as { code?: unknown; killed?: boolean }
          code = e.killed ? 124 : typeof e.code === 'number' ? e.code : 1
        }
        resolve({ stdout: String(stdout), stderr: String(stderr), code })
      },
    )
  })

/**
 * Dry-run runner for end-to-end tests (WAYPOINT_DRY_RUN=1): validation, allowlists and records all
 * still apply, but nothing is executed and no app is opened.
 */
export const dryRunRunner: Runner = async (file) => {
  if (file.endsWith('osascript'))
    return {
      stdout: '{"status":"opened","running":false,"installed":true,"windows":[],"tabs":[]}',
      stderr: '',
      code: 0,
    }
  return { stdout: '', stderr: '', code: 0 }
}

/** File types that `open` would EXECUTE rather than open. Never allowed. */
const EXECUTABLE_EXTENSIONS = new Set([
  '.command',
  '.tool',
  '.sh',
  '.zsh',
  '.bash',
  '.csh',
  '.ksh',
  '.fish',
  '.terminal',
  '.scpt',
  '.scptd',
  '.applescript',
  '.workflow',
  '.action',
  '.pkg',
  '.mpkg',
  '.jar',
  '.app',
  '.prefPane',
  '.saver',
  '.kext',
  '.plugin',
  '.webloc',
  '.inetloc',
  '.fileloc',
  '.url',
  '.shortcut',
  '.osax',
  '.qtz',
])

/** URL schemes `open` may hand to the system. Anything else (file:, javascript:, x-man-page:, mailto: ...) is blocked. */
export const ALLOWED_URL_SCHEMES = new Set([
  'http',
  'https',
  'message',
  'slack',
  'discord',
  'msteams',
  'notion',
  'obsidian',
  'figma',
  'linear',
  'warp',
  'bear',
  'x-apple.systempreferences',
  'zoommtg',
  'vscode',
  'vscode-insiders',
  'cursor',
  'zed',
  'things',
  'craftdocs',
])

export interface OpenOptions {
  /** Open without bringing the app to the front (`open -g`). */
  background?: boolean
  bundleId?: string
  appName?: string
}

export class SafeExec {
  private log: ExecRecord[] = []

  constructor(
    private readonly runner: Runner = defaultRunner,
    private readonly opts: {
      resolve?: (id: string) => string | null
      canArrange?: () => boolean
      onRecord?: (r: ExecRecord) => void
    } = {},
  ) {}

  get records(): readonly ExecRecord[] {
    return this.log
  }

  private record(r: ExecRecord): void {
    this.log.push(r)
    if (this.log.length > 500) this.log.shift()
    this.opts.onRecord?.(r)
  }

  /** Runs an allowlisted binary with validated arguments. */
  async run(
    binaryId: string,
    args: string[],
    opts: { timeoutMs?: number; scriptId?: string } = {},
  ): Promise<ExecResult> {
    const spec = BINARIES[binaryId]
    if (!spec) throw this.block(binaryId, args, `binary not allowlisted: ${binaryId}`)
    for (const a of args) {
      if (typeof a !== 'string' || a.includes('\0') || a.length > 16_384)
        throw this.block(binaryId, args, 'invalid argument')
    }
    const problem = spec.validate(args)
    if (problem) throw this.block(binaryId, args, problem)
    const file = (this.opts.resolve ?? resolveBinary)(binaryId)
    if (!file) throw new SafeExecError(`${binaryId} is not installed`, 'not-found')
    const res = await this.runner(file, args, opts.timeoutMs ?? SCRIPT_TIMEOUT_MS)
    this.record({
      at: Date.now(),
      binary: binaryId,
      args: opts.scriptId
        ? ['-l', 'JavaScript', '-e', `<${opts.scriptId}>`, ...args.slice(4)]
        : args,
      scriptId: opts.scriptId,
      ok: res.code === 0,
      error: res.code ? res.stderr.slice(0, 300) : undefined,
    })
    return res
  }

  /** Runs a registered JXA template. `params` are passed as argv (no interpolation). Returns parsed JSON. */
  async script<T = unknown>(
    id: ScriptId,
    params: string[] = [],
    timeoutMs = SCRIPT_TIMEOUT_MS,
  ): Promise<T> {
    const tpl = SCRIPTS[id]
    if (!tpl) throw this.block('osascript', [], `unregistered script: ${String(id)}`)
    if ('arrange' in tpl && tpl.arrange && !(this.opts.canArrange?.() ?? false)) {
      throw this.block('osascript', [], 'Arrange windows is turned off')
    }
    const res = await this.run('osascript', ['-l', 'JavaScript', '-e', tpl.source, ...params], {
      timeoutMs,
      scriptId: id,
    })
    if (res.code !== 0) {
      const err = res.stderr
      if (/-1743|not allowed|Not authorized/i.test(err))
        throw new SafeExecError(`Automation permission needed for ${tpl.target}`, 'not-authorized')
      if (/-1719|assistive access|accessibility/i.test(err))
        throw new SafeExecError('Accessibility permission needed', 'not-authorized')
      if (/-600|isn.t running|not running/i.test(err))
        throw new SafeExecError('App is not running', 'not-running')
      if (res.code === 124) throw new SafeExecError(`Script ${id} timed out`, 'timeout')
      throw new SafeExecError(`Script ${id} failed: ${err.trim().slice(0, 300)}`, 'failed')
    }
    const out = res.stdout.trim()
    try {
      return JSON.parse(out) as T
    } catch {
      throw new SafeExecError(`Script ${id} returned non-JSON output`, 'failed')
    }
  }

  /** `open` a file or folder (optionally with a specific app). Refuses executables. */
  async openPath(path: string, o: OpenOptions = {}): Promise<void> {
    if (!path.startsWith('/')) throw this.block('open', [path], 'path must be absolute')
    const ext = extname(path.replace(/\/+$/, '')).toLowerCase()
    if (EXECUTABLE_EXTENSIONS.has(ext))
      throw this.block('open', [path], `refusing to open executable file type ${ext}`)
    await this.openRaw(path, o)
  }

  /** `open` a URL or deep link. Only allowlisted schemes. */
  async openUrl(url: string, o: OpenOptions = {}): Promise<void> {
    let scheme: string
    try {
      scheme = new URL(url).protocol.replace(/:$/, '').toLowerCase()
    } catch {
      throw this.block('open', [url], 'invalid URL')
    }
    if (!ALLOWED_URL_SCHEMES.has(scheme))
      throw this.block('open', [url], `URL scheme not allowed: ${scheme}`)
    await this.openRaw(url, o)
  }

  /** Launch or focus an app by bundle id (`open -b <id>`). macOS focuses it if it's already running. */
  async launchApp(bundleId: string, o: { background?: boolean } = {}): Promise<void> {
    if (!/^[A-Za-z0-9.-]+$/.test(bundleId))
      throw this.block('open', [bundleId], 'invalid bundle id')
    const args = [...(o.background ? ['-g'] : []), '-b', bundleId, '--']
    const res = await this.run('open', args)
    if (res.code !== 0)
      throw new SafeExecError(
        res.stderr.trim() || `Could not launch ${bundleId}`,
        /Unable to find application/i.test(res.stderr) ? 'not-found' : 'failed',
      )
  }

  private async openRaw(target: string, o: OpenOptions): Promise<void> {
    const args: string[] = []
    if (o.background) args.push('-g')
    if (o.bundleId) {
      if (!/^[A-Za-z0-9.-]+$/.test(o.bundleId))
        throw this.block('open', [target], 'invalid bundle id')
      args.push('-b', o.bundleId)
    } else if (o.appName) args.push('-a', o.appName)
    args.push('--', target)
    const res = await this.run('open', args)
    if (res.code !== 0) {
      const msg = res.stderr.trim() || `open failed for ${target}`
      throw new SafeExecError(
        msg,
        /does not exist|Unable to find application|No application knows/i.test(msg)
          ? 'not-found'
          : 'failed',
      )
    }
  }

  private block(binary: string, args: string[], why: string): SafeExecError {
    this.record({
      at: Date.now(),
      binary,
      args: args.slice(0, 6).map((a) => a.slice(0, 200)),
      ok: false,
      error: `BLOCKED: ${why}`,
    })
    return new SafeExecError(`Blocked by SafeExec: ${why}`, 'blocked')
  }
}
