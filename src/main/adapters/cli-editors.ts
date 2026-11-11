import { existsSync } from 'node:fs'
import type { ResourceRef, RestoreItemResult } from '@shared/schemas'
import type { AppAdapter, CaptureContext } from './types'
import { basename, errorReason, result } from './util'

interface CliEditorSpec {
  id: string
  displayName: string
  bundleIds: string[]
  tier: 'deep' | 'partial'
  /** Allowlisted CLI id (see safe-exec/allowlist.ts), or null to use `open -b`. */
  cli: string | null
  /** Builds CLI args for a file at an optional line/column. */
  fileArgs?: (path: string, line?: number, column?: number) => string[]
  notes: string
  /** Extract a project folder from a window title, if the app puts one there. */
  projectFromTitle?: (title: string, ctx: CaptureContext) => string | null
}

/**
 * Factory for editors whose state we capture from window metadata (AXDocument path + title) and
 * restore through their own CLI (line/column where supported) or LaunchServices.
 */
export function createCliEditorAdapter(spec: CliEditorSpec): AppAdapter {
  const bundle = spec.bundleIds[0]!
  const openFile = async (
    ctx: Parameters<AppAdapter['restore']>[1],
    ref: Extract<ResourceRef, { kind: 'file' }>,
  ) => {
    if (spec.cli && spec.fileArgs) {
      try {
        const r = await ctx.exec.run(spec.cli, spec.fileArgs(ref.path, ref.line, ref.column), {
          timeoutMs: 10_000,
        })
        if (r.code === 0) return true
      } catch {
        /* CLI missing: fall through */
      }
    }
    await ctx.exec.openPath(ref.path, { bundleId: ref.app.includes('.') ? ref.app : bundle })
    return false
  }
  return {
    id: spec.id,
    displayName: spec.displayName,
    bundleIds: spec.bundleIds,
    tier: spec.tier,
    needsAutomation: false,
    notes: spec.notes,
    handles: (ref) =>
      spec.bundleIds.includes(ref.app) &&
      (ref.kind === 'file' || ref.kind === 'folder' || ref.kind === 'workspace'),
    async capture(ctx) {
      if (!spec.projectFromTitle) return []
      const out: ResourceRef[] = []
      for (const a of ctx.apps) {
        if (!a.bundleId || !spec.bundleIds.includes(a.bundleId)) continue
        a.windows.forEach((w, i) => {
          const folder = w.title ? spec.projectFromTitle!(w.title, ctx) : null
          if (folder)
            out.push({
              kind: 'workspace',
              app: a.bundleId!,
              path: folder,
              title: basename(folder),
              focused: (a.frontmost && i === 0) || undefined,
            })
        })
      }
      return out
    },
    isRunning: async (ctx) => {
      for (const b of spec.bundleIds) if (await ctx.isRunning(b)) return true
      return false
    },
    async alreadyOpen(ref, ctx) {
      if (!('path' in ref)) return false
      const wins = await ctx.windows()
      const name = basename(ref.path as string)
      return wins.some(
        (a) =>
          a.bundleId &&
          spec.bundleIds.includes(a.bundleId) &&
          a.windows.some(
            (w) => (w.document ?? '').endsWith(encodeURI(name)) || (w.title ?? '').includes(name),
          ),
      )
    },
    describe(ref) {
      if (ref.kind === 'file')
        return {
          action: 'open',
          description: `Open ${basename(ref.path)}${ref.line && spec.fileArgs ? ` at line ${ref.line}` : ''} in ${spec.displayName}`,
        }
      if (ref.kind === 'folder' || ref.kind === 'workspace')
        return { action: 'open', description: `Open ${basename(ref.path)} in ${spec.displayName}` }
      return { action: 'info', description: '' }
    },
    async restore(refs, ctx) {
      const out: RestoreItemResult[] = []
      for (const ref of refs) {
        const t0 = Date.now()
        try {
          if (ref.kind === 'file' || ref.kind === 'folder' || ref.kind === 'workspace') {
            if (!existsSync(ref.path)) {
              out.push(
                result(
                  ref,
                  spec.id,
                  'failed',
                  `${ref.kind === 'file' ? 'File' : 'Folder'} no longer exists`,
                  t0,
                ),
              )
              continue
            }
            const already = await this.alreadyOpen(ref, ctx)
            if (ref.kind === 'file') {
              const usedCli = await openFile(ctx, ref)
              out.push(
                result(
                  ref,
                  spec.id,
                  already ? 'already-open' : 'opened',
                  already
                    ? 'Already open; focused it'
                    : ref.line && !usedCli && spec.fileArgs
                      ? 'Command-line tool not found; opened without line position'
                      : undefined,
                  t0,
                ),
              )
            } else {
              await ctx.exec.openPath(ref.path, { bundleId: bundle })
              out.push(
                result(
                  ref,
                  spec.id,
                  already ? 'already-open' : 'opened',
                  already ? 'Already open; focused it' : undefined,
                  t0,
                ),
              )
            }
          } else out.push(result(ref, spec.id, 'skipped', 'Not an editor item', t0))
        } catch (e) {
          out.push(result(ref, spec.id, 'failed', errorReason(e), t0))
        }
      }
      return out
    },
  }
}

const jbArgs = (path: string, line?: number, column?: number) => [
  ...(line ? ['--line', String(line)] : []),
  ...(column ? ['--column', String(column)] : []),
  path,
]
/** JetBrains titles look like "project – file.ext" (en dash). The project folder isn't in the title, so we only use AXDocument. */

export const jetbrainsAdapters: AppAdapter[] = [
  ['intellij', 'IntelliJ IDEA', ['com.jetbrains.intellij', 'com.jetbrains.intellij.ce'], 'idea'],
  ['webstorm', 'WebStorm', ['com.jetbrains.WebStorm'], 'webstorm'],
  ['pycharm', 'PyCharm', ['com.jetbrains.pycharm', 'com.jetbrains.pycharm.ce'], 'pycharm'],
  ['goland', 'GoLand', ['com.jetbrains.goland'], 'goland'],
  ['phpstorm', 'PhpStorm', ['com.jetbrains.PhpStorm'], null],
  ['rubymine', 'RubyMine', ['com.jetbrains.rubymine'], null],
  ['clion', 'CLion', ['com.jetbrains.CLion'], null],
  ['rider', 'Rider', ['com.jetbrains.rider'], null],
  ['rustrover', 'RustRover', ['com.jetbrains.rustrover'], null],
  ['datagrip', 'DataGrip', ['com.jetbrains.datagrip'], null],
].map(([id, name, bundles, cli]) =>
  createCliEditorAdapter({
    id: id as string,
    displayName: name as string,
    bundleIds: bundles as string[],
    tier: 'partial',
    cli: cli as string | null,
    fileArgs: cli ? jbArgs : undefined,
    notes: `Files come from the window's document path. Restores with the ${cli ? `\`${cli} --line N --column M\` launcher (if installed via Tools → Create Command-line Launcher)` : 'app'}${cli ? ', else' : ''} \`open -b\`.`,
  }),
)

export const xcodeAdapter = createCliEditorAdapter({
  id: 'xcode',
  displayName: 'Xcode',
  bundleIds: ['com.apple.dt.Xcode'],
  tier: 'partial',
  cli: 'xed',
  fileArgs: (p, line) => (line ? ['--line', String(line), p] : [p]),
  notes:
    'Files/projects from window document paths; reopened with `xed` (`xed --line N` when a line is known).',
})

export const zedAdapter = createCliEditorAdapter({
  id: 'zed',
  displayName: 'Zed',
  bundleIds: ['dev.zed.Zed', 'dev.zed.Zed-Preview'],
  tier: 'partial',
  cli: 'zed',
  fileArgs: (p, line, col) => [line ? `${p}:${line}${col ? `:${col}` : ''}` : p],
  notes: 'Files from window document paths; reopened with `zed path:line:col`.',
})

export const sublimeAdapter = createCliEditorAdapter({
  id: 'sublime',
  displayName: 'Sublime Text',
  bundleIds: ['com.sublimetext.4', 'com.sublimetext.3'],
  tier: 'partial',
  cli: 'subl',
  fileArgs: (p, line, col) => [line ? `${p}:${line}${col ? `:${col}` : ''}` : p],
  notes: 'Files from window document paths; reopened with `subl path:line:col`.',
})

export const novaAdapter = createCliEditorAdapter({
  id: 'nova',
  displayName: 'Nova',
  bundleIds: ['com.panic.Nova'],
  tier: 'partial',
  cli: null,
  notes:
    'Files from window document paths; reopened with `open -b com.panic.Nova` (no documented line flag).',
})
