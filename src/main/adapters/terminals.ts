import { existsSync } from 'node:fs'
import type { ResourceRef, RestoreItemResult } from '@shared/schemas'
import type { AppAdapter, CaptureContext } from './types'
import { basename, errorReason, result } from './util'

/**
 * Terminals are restored by opening a NEW window at the saved directory. Waypoint never types into a
 * terminal and never runs a command (no `do script`, no iTerm `write text`).
 */
const tildeTitle = /(?:^|[\s:—-])((?:~|\/)[^\s—]*)\s*(?:$|[—-])/

function cwdFromTitle(title: string | null, home: string): string | null {
  if (!title) return null
  const m = tildeTitle.exec(title)
  if (!m) return null
  const p = m[1]!.replace(/^~/, home).replace(/\/$/, '') || '/'
  return p.startsWith('/') && existsSync(p) ? p : null
}

async function cwdOfTty(ctx: CaptureContext, tty: string): Promise<string | null> {
  const dev = tty.replace('/dev/', '')
  if (!/^ttys\d{3,4}$/.test(dev)) return null
  const ps = await ctx.exec.run('ps', ['-o', 'pid=,comm=', '-t', dev])
  const shell = ps.stdout
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .find(([, comm]) => /(^|\/)-?(zsh|bash|fish|sh|nu|tcsh|ksh)$/.test(comm ?? ''))
  if (!shell?.[0]) return null
  const lsof = await ctx.exec.run('lsof', ['-a', '-d', 'cwd', '-p', shell[0], '-Fn'])
  const line = lsof.stdout.split('\n').find((l) => l.startsWith('n/'))
  return line ? line.slice(1) : null
}

interface TermSpec {
  id: string
  displayName: string
  bundleId: string
  notes: string
  capture: (ctx: CaptureContext) => Promise<string[]>
  open: (ctx: Parameters<AppAdapter['restore']>[1], dir: string) => Promise<void>
  tier: 'deep' | 'partial'
}

function createTerminalAdapter(spec: TermSpec): AppAdapter {
  return {
    id: spec.id,
    displayName: spec.displayName,
    bundleIds: [spec.bundleId],
    tier: spec.tier,
    needsAutomation: spec.id !== 'warp',
    notes: spec.notes,
    handles: (ref) => ref.kind === 'terminalCwd' && ref.app === spec.bundleId,
    async capture(ctx) {
      if (!ctx.isRunning(spec.bundleId)) return []
      const dirs = [...new Set(await spec.capture(ctx).catch(() => []))]
      return dirs.slice(0, 12).map((path): ResourceRef => ({
        kind: 'terminalCwd',
        app: spec.bundleId,
        path,
        title: basename(path),
      }))
    },
    isRunning: (ctx) => ctx.isRunning(spec.bundleId),
    alreadyOpen: async () => false,
    describe: (ref) =>
      ref.kind === 'terminalCwd'
        ? {
            action: 'open',
            description: `New ${spec.displayName} window in ${ref.path.replace(process.env['HOME'] ?? '\0', '~')}`,
            reason: 'Opens a window at the folder; never runs a command',
          }
        : { action: 'info', description: '' },
    async restore(refs, ctx) {
      const out: RestoreItemResult[] = []
      for (const ref of refs) {
        const t0 = Date.now()
        if (ref.kind !== 'terminalCwd') continue
        try {
          if (!existsSync(ref.path)) {
            out.push(result(ref, spec.id, 'failed', 'Folder no longer exists', t0))
            continue
          }
          await spec.open(ctx, ref.path)
          out.push(
            result(
              ref,
              spec.id,
              'opened',
              'Opened a new window at this folder (no command was run)',
              t0,
            ),
          )
        } catch (e) {
          out.push(result(ref, spec.id, 'failed', errorReason(e), t0))
        }
      }
      return out
    },
  }
}

export const terminalAdapter = createTerminalAdapter({
  id: 'terminal',
  displayName: 'Terminal',
  bundleId: 'com.apple.Terminal',
  tier: 'partial',
  notes:
    'Captures each tab’s working directory (tab tty → shell pid via `ps` → cwd via `lsof`; never history or contents). Restores with `open -b com.apple.Terminal <dir>`, which opens a new window there without running anything.',
  async capture(ctx) {
    const r = await ctx.exec.script<{ tabs: { tty: string }[] }>('terminal.ttys')
    ctx.noteAutomation('com.apple.Terminal', 'granted')
    const dirs: string[] = []
    for (const t of r.tabs.slice(0, 12)) {
      const d = await cwdOfTty(ctx, t.tty).catch(() => null)
      if (d) dirs.push(d)
    }
    return dirs
  },
  open: (ctx, dir) => ctx.exec.openPath(dir, { bundleId: 'com.apple.Terminal' }),
})

export const itermAdapter = createTerminalAdapter({
  id: 'iterm2',
  displayName: 'iTerm2',
  bundleId: 'com.googlecode.iterm2',
  tier: 'partial',
  notes:
    'Captures each session’s `path` variable via iTerm2’s scripting dictionary (read-only). Restores with `open -b com.googlecode.iterm2 <dir>` (new window at that folder). Never uses `write text`. Untested on this Mac.',
  async capture(ctx) {
    const r = await ctx.exec.script<{ paths: { path: string }[] }>('iterm.paths')
    return r.paths.map((p) => p.path).filter((p) => p.startsWith('/'))
  },
  open: (ctx, dir) => ctx.exec.openPath(dir, { bundleId: 'com.googlecode.iterm2' }),
})

export const warpAdapter = createTerminalAdapter({
  id: 'warp',
  displayName: 'Warp',
  bundleId: 'dev.warp.Warp-Stable',
  tier: 'partial',
  notes:
    'No scripting: the working directory is read from window titles when they show a path. Restores with `warp://action/new_window?path=<dir>` (documented URI; cannot run commands). Untested on this Mac.',
  async capture(ctx) {
    const app = ctx.apps.find((a) => a.bundleId === 'dev.warp.Warp-Stable')
    return (app?.windows ?? [])
      .map((w) => cwdFromTitle(w.title, ctx.homeDir))
      .filter((p): p is string => !!p)
  },
  open: (ctx, dir) => ctx.exec.openUrl(`warp://action/new_window?path=${encodeURIComponent(dir)}`),
})

export { cwdFromTitle }
