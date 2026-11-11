import Database from 'better-sqlite3'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ResourceRef, RestoreItemResult } from '@shared/schemas'
import type { AppAdapter, CaptureContext, RestoreContext } from './types'
import { basename, errorReason, result } from './util'

interface Variant {
  id: string
  displayName: string
  bundleIds: string[]
  cli: string
  /** Folder under ~/Library/Application Support */
  supportDir: string
}

export interface VsEditorState {
  files: string[]
  active: string | null
  cursors: Map<string, { line: number; column: number }>
}

/** Parses the two workbench memento values (verified on this Mac against VS Code's state.vscdb). */
export function parseVsState(
  editorPartJson: string | null,
  textEditorJson: string | null,
): VsEditorState {
  const files: string[] = []
  let active: string | null = null
  const cursors = new Map<string, { line: number; column: number }>()
  try {
    const part = editorPartJson ? JSON.parse(editorPartJson) : null
    const state = part?.['editorpart.state']
    const activeGroup = state?.activeGroup
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      const n = node as { type?: string; data?: unknown }
      if (n.type === 'leaf' && n.data && typeof n.data === 'object') {
        const leaf = n.data as {
          id?: number
          editors?: { id?: string; value?: string }[]
          mru?: number[]
        }
        const groupFiles: string[] = []
        for (const ed of leaf.editors ?? []) {
          try {
            const v = JSON.parse(ed.value ?? '{}')
            const res = v.resourceJSON
            if (
              res?.scheme === 'file' &&
              typeof res.fsPath === 'string' &&
              res.fsPath.startsWith('/')
            )
              groupFiles.push(res.fsPath)
            else groupFiles.push('')
          } catch {
            groupFiles.push('')
          }
        }
        for (const f of groupFiles) if (f && !files.includes(f)) files.push(f)
        if (leaf.id === activeGroup && leaf.mru?.length) active = groupFiles[leaf.mru[0]!] || active
      } else if (Array.isArray(n.data)) for (const c of n.data) walk(c)
    }
    walk(state?.serializedGrid?.root)
  } catch {
    /* ignore malformed state */
  }
  try {
    const te = textEditorJson ? JSON.parse(textEditorJson) : null
    for (const entry of te?.textEditorViewState ?? []) {
      const [uri, perGroup] = entry as [
        string,
        Record<string, { cursorState?: { position?: { lineNumber: number; column: number } }[] }>,
      ]
      if (!uri.startsWith('file://')) continue
      const path = decodeURIComponent(new URL(uri).pathname)
      const first = Object.values(perGroup ?? {})[0]
      const pos = first?.cursorState?.[0]?.position
      if (pos) cursors.set(path, { line: pos.lineNumber, column: pos.column })
    }
  } catch {
    /* ignore */
  }
  return { files, active, cursors }
}

/** Reads a COPY of state.vscdb in Savespace's temp dir, read-only. The editor's own file is never opened. */
function readWorkspaceState(dbPath: string, tempDir: string): VsEditorState {
  const dir = join(tempDir, `vscdb-${randomUUID()}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    const copy = join(dir, 'state.vscdb')
    copyFileSync(dbPath, copy)
    if (existsSync(dbPath + '-wal')) copyFileSync(dbPath + '-wal', copy + '-wal')
    const db = new Database(copy, { readonly: true, fileMustExist: true })
    try {
      const get = (k: string) =>
        (
          db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(k) as
            { value?: string | Buffer } | undefined
        )?.value?.toString() ?? null
      return parseVsState(
        get('memento/workbench.parts.editor'),
        get('memento/workbench.editors.files.textFileEditor'),
      )
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function createVsCodeAdapter(v: Variant): AppAdapter {
  const bundle = v.bundleIds[0]!
  const runCli = async (ctx: RestoreContext, args: string[], ref: ResourceRef) => {
    try {
      const r = await ctx.exec.run(v.cli, args, { timeoutMs: 10_000 })
      if (r.code !== 0) throw new Error(r.stderr.trim() || `${v.cli} exited with ${r.code}`)
      return 'cli'
    } catch (e) {
      // CLI not installed: fall back to LaunchServices (no line/column).
      if (/not installed/.test((e as Error).message) && 'path' in ref) {
        await ctx.exec.openPath((ref as { path: string }).path, { bundleId: bundle })
        return 'open'
      }
      throw e
    }
  }

  return {
    id: v.id,
    displayName: v.displayName,
    bundleIds: v.bundleIds,
    tier: 'deep',
    needsAutomation: false,
    notes: `Reads open folder, open files and cursor line/column from a read-only copy of ${v.displayName}'s workspace state. Restores with \`${v.cli} <folder>\` then \`${v.cli} -r -g file:line:col\` (focuses existing windows/tabs).`,
    handles: (ref) =>
      v.bundleIds.includes(ref.app) &&
      (ref.kind === 'workspace' || ref.kind === 'file' || ref.kind === 'folder'),

    async capture(ctx: CaptureContext) {
      if (!v.bundleIds.some((b) => ctx.isRunning(b))) return []
      const root = join(
        ctx.homeDir,
        'Library/Application Support',
        v.supportDir,
        'User/workspaceStorage',
      )
      if (!existsSync(root)) return []
      const app = ctx.apps.find((a) => a.bundleId && v.bundleIds.includes(a.bundleId))
      const titles = (app?.windows ?? []).map((w) => w.title ?? '')
      const frontTitle = app?.frontmost ? titles[0] : undefined
      const cutoff = Date.now() - 24 * 3600_000
      const candidates: { folder: string; db: string; mtime: number }[] = []
      for (const d of readdirSync(root)) {
        try {
          const ws = JSON.parse(readFileSync(join(root, d, 'workspace.json'), 'utf8')) as {
            folder?: string
          }
          if (!ws.folder?.startsWith('file://')) continue
          const folder = decodeURIComponent(new URL(ws.folder).pathname).replace(/\/$/, '')
          const db = join(root, d, 'state.vscdb')
          const mtime = statSync(db).mtimeMs
          if (mtime < cutoff) continue
          const name = basename(folder)
          const openNow = titles.length
            ? titles.some((t) => t.includes(name))
            : mtime > Date.now() - 2 * 3600_000
          if (openNow) candidates.push({ folder, db, mtime })
        } catch {
          /* skip unreadable */
        }
      }
      const out: ResourceRef[] = []
      for (const c of candidates.sort((a, b) => b.mtime - a.mtime).slice(0, 6)) {
        const name = basename(c.folder)
        const focusedWs = !!frontTitle && frontTitle.includes(name)
        out.push({
          kind: 'workspace',
          app: bundle,
          path: c.folder,
          title: name,
          focused: focusedWs || undefined,
        })
        let st: VsEditorState
        try {
          st = readWorkspaceState(c.db, ctx.tempDir)
        } catch {
          continue
        }
        for (const f of st.files.slice(0, 25)) {
          const cur = st.cursors.get(f)
          out.push({
            kind: 'file',
            app: bundle,
            path: f,
            title: basename(f),
            line: cur?.line,
            column: cur?.column,
            focused: (focusedWs && st.active === f) || undefined,
          })
        }
      }
      return out
    },

    isRunning: async (ctx) => {
      for (const b of v.bundleIds) if (await ctx.isRunning(b)) return true
      return false
    },

    async alreadyOpen(ref, ctx) {
      if (ref.kind !== 'workspace' && ref.kind !== 'folder') return false
      const wins = await ctx.windows()
      const name = basename(ref.path)
      return wins.some(
        (a) =>
          a.bundleId &&
          v.bundleIds.includes(a.bundleId) &&
          a.windows.some((w) => (w.title ?? '').includes(name)),
      )
    },

    describe(ref) {
      if (ref.kind === 'workspace' || ref.kind === 'folder')
        return {
          action: 'open',
          description: `Open the ${basename(ref.path)} folder in ${v.displayName}`,
        }
      if (ref.kind === 'file')
        return {
          action: 'open',
          description: `Open ${basename(ref.path)}${ref.line ? ` at line ${ref.line}${ref.column ? `:${ref.column}` : ''}` : ''}`,
        }
      return { action: 'info', description: '' }
    },

    async restore(refs, ctx) {
      const out: RestoreItemResult[] = []
      for (const ref of refs) {
        const t0 = Date.now()
        try {
          if (ref.kind === 'workspace' || ref.kind === 'folder') {
            if (!existsSync(ref.path)) {
              out.push(result(ref, v.id, 'failed', 'Folder no longer exists', t0))
              continue
            }
            const already = await this.alreadyOpen(ref, ctx)
            await runCli(ctx, [ref.path], ref)
            out.push(
              result(
                ref,
                v.id,
                already ? 'already-open' : 'opened',
                already ? 'Window was already open; focused it' : undefined,
                t0,
              ),
            )
          } else if (ref.kind === 'file') {
            if (!existsSync(ref.path)) {
              out.push(result(ref, v.id, 'failed', 'File no longer exists', t0))
              continue
            }
            const target = ref.line
              ? `${ref.path}:${ref.line}${ref.column ? `:${ref.column}` : ''}`
              : ref.path
            const how = await runCli(ctx, ref.line ? ['-r', '-g', target] : ['-r', ref.path], ref)
            out.push(
              result(
                ref,
                v.id,
                'opened',
                how === 'open'
                  ? `${v.cli} command-line tool not installed; opened without line position`
                  : 'Focused the tab if it was already open',
                t0,
              ),
            )
          } else out.push(result(ref, v.id, 'skipped', 'Not an editor item', t0))
        } catch (e) {
          out.push(result(ref, v.id, 'failed', errorReason(e), t0))
        }
      }
      return out
    },
  }
}

export const vscodeAdapter = createVsCodeAdapter({
  id: 'vscode',
  displayName: 'Visual Studio Code',
  bundleIds: ['com.microsoft.VSCode'],
  cli: 'code',
  supportDir: 'Code',
})
export const vscodeInsidersAdapter = createVsCodeAdapter({
  id: 'vscode-insiders',
  displayName: 'VS Code Insiders',
  bundleIds: ['com.microsoft.VSCodeInsiders'],
  cli: 'code-insiders',
  supportDir: 'Code - Insiders',
})
export const cursorAdapter = createVsCodeAdapter({
  id: 'cursor',
  displayName: 'Cursor',
  bundleIds: ['com.todesktop.230313mzl4w4u92'],
  cli: 'cursor',
  supportDir: 'Cursor',
})
export const windsurfAdapter = createVsCodeAdapter({
  id: 'windsurf',
  displayName: 'Windsurf',
  bundleIds: ['com.exafunction.windsurf'],
  cli: 'windsurf',
  supportDir: 'Windsurf',
})
