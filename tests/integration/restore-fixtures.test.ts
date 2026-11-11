/**
 * OPEN-ONLY PROOF: capture + restore a checkpoint against fixture files, drafts and a real git
 * repository, then assert that every file's SHA-256 hash, size and mtime are unchanged and that no
 * file was created or deleted.
 *
 * Default mode: git/ps/lsof run for real (read-only queries); `open`, editor CLIs and osascript are
 * recorded instead of executed (CI-safe, no windows appear).
 * Live mode (WAYPOINT_LIVE_RESTORE=1): `open` really runs, opening the fixture text file in TextEdit,
 * the PDF in Preview and the folder in Finder, and hashes are checked after the apps have them open.
 */
import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/constants'
import { allAdapters } from '../../src/main/adapters'
import { AdapterRegistry } from '../../src/main/adapters/registry'
import { CaptureEngine } from '../../src/main/capture/engine'
import { buildRules } from '../../src/main/capture/privacy-filter'
import { CheckpointService } from '../../src/main/checkpoints/service'
import { RestoreEngine } from '../../src/main/restore/engine'
import { defaultRunner, SafeExec, type Runner } from '../../src/main/safe-exec'
import { SCRIPTS } from '../../src/main/safe-exec/scripts/registry'
import { TemplateSummarizer } from '../../src/main/summarizer/template'
import { tempDb } from '../helpers/db'

const LIVE = process.env['WAYPOINT_LIVE_RESTORE'] === '1'
let root: string
let home: string
let project: string
let db: ReturnType<typeof tempDb>

type Fingerprint = Map<string, { sha: string; size: number; mtime: number }>

function fingerprint(dir: string, out: Fingerprint = new Map()): Fingerprint {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) fingerprint(p, out)
    else if (e.isFile()) {
      const st = statSync(p)
      out.set(p, {
        sha: createHash('sha256').update(readFileSync(p)).digest('hex'),
        size: st.size,
        mtime: st.mtimeMs,
      })
    }
  }
  return out
}

const MIN_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'waypoint-fixtures-'))
  home = join(root, 'home')
  project = join(root, 'home/code/fixture-project')
  mkdirSync(join(project, 'src'), { recursive: true })
  writeFileSync(
    join(project, 'notes.txt'),
    'Fixture notes. Waypoint must never change this file.\n',
  )
  writeFileSync(join(project, 'README.md'), '# Fixture project\n')
  writeFileSync(join(project, 'src/app.ts'), 'export const answer = 42\n'.repeat(50))
  writeFileSync(join(project, 'brief.pdf'), MIN_PDF)
  // A "draft" saved as a file (e.g. an .eml draft) is just another document that must stay untouched.
  writeFileSync(
    join(project, 'draft-reply.eml'),
    'Subject: Re: plan\n\nDraft body that must not change.\n',
  )
  // Real git repository with a commit and an uncommitted change.
  const git = (...a: string[]) =>
    execFileSync('git', ['-C', project, ...a], {
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    })
  git('init', '-q', '-b', 'feature/checkpoints')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  writeFileSync(join(project, 'README.md'), '# Fixture project\n\nuncommitted\n')

  // Fake VS Code workspace state that points at the fixture project.
  const ws = join(home, 'Library/Application Support/Code/User/workspaceStorage/abc123')
  mkdirSync(ws, { recursive: true })
  writeFileSync(join(ws, 'workspace.json'), JSON.stringify({ folder: `file://${project}` }))
  const s = new Database(join(ws, 'state.vscdb'))
  s.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)')
  const ed = (p: string) => ({
    id: 'workbench.editors.files.fileEditorInput',
    value: JSON.stringify({ resourceJSON: { $mid: 1, fsPath: p, path: p, scheme: 'file' } }),
  })
  s.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(
    'memento/workbench.parts.editor',
    JSON.stringify({
      'editorpart.state': {
        serializedGrid: {
          root: {
            type: 'branch',
            data: [
              {
                type: 'leaf',
                data: {
                  id: 0,
                  editors: [ed(join(project, 'README.md')), ed(join(project, 'src/app.ts'))],
                  mru: [1, 0],
                },
              },
            ],
          },
        },
        activeGroup: 0,
      },
    }),
  )
  s.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(
    'memento/workbench.editors.files.textFileEditor',
    JSON.stringify({
      textEditorViewState: [
        [
          `file://${join(project, 'src/app.ts')}`,
          { 0: { cursorState: [{ position: { lineNumber: 17, column: 5 } }] } },
        ],
      ],
    }),
  )
  s.close()

  // Make every mtime old and distinctive so any touch is detectable.
  const old = new Date('2026-01-02T03:04:05Z')
  for (const p of fingerprint(root).keys()) utimesSync(p, old, old)
  // The editor state must look recent (the adapter ignores workspaces untouched for 24 h); still hash-checked.
  const recent = new Date(Date.now() - 60_000)
  utimesSync(join(ws, 'state.vscdb'), recent, recent)
  db = tempDb()
})

afterAll(() => {
  db?.cleanup()
  rmSync(root, { recursive: true, force: true })
})

describe('open-only guarantee (fixture hashes)', () => {
  it('capture + restore leaves every fixture file byte-identical with the same mtime', async () => {
    const before = fingerprint(root)
    expect(before.size).toBeGreaterThan(10)

    const executed: string[][] = []
    const runner: Runner = async (file, args, timeout) => {
      executed.push([file, ...args])
      const bin = file.split('/').pop()!
      if (bin === 'osascript') {
        const src = args[3] ?? ''
        if (src === SCRIPTS['system-events.windows'].source) {
          return {
            code: 0,
            stderr: '',
            stdout: JSON.stringify([
              {
                name: 'Code',
                bundleId: 'com.microsoft.VSCode',
                pid: 1,
                frontmost: true,
                windows: [
                  {
                    title: 'app.ts — fixture-project',
                    position: [0, 25],
                    size: [1200, 800],
                    document: null,
                  },
                ],
              },
              {
                name: 'TextEdit',
                bundleId: 'com.apple.TextEdit',
                pid: 2,
                frontmost: false,
                windows: [
                  {
                    title: 'notes.txt',
                    position: [40, 60],
                    size: [500, 400],
                    document: `file://${join(project, 'notes.txt')}`,
                  },
                ],
              },
              {
                name: 'Preview',
                bundleId: 'com.apple.Preview',
                pid: 3,
                frontmost: false,
                windows: [
                  {
                    title: 'brief.pdf',
                    position: [80, 90],
                    size: [500, 600],
                    document: `file://${join(project, 'brief.pdf')}`,
                  },
                ],
              },
              {
                name: 'Finder',
                bundleId: 'com.apple.finder',
                pid: 4,
                frontmost: false,
                windows: [
                  { title: 'fixture-project', position: [0, 0], size: [800, 500], document: null },
                ],
              },
            ]),
          }
        }
        if (src === SCRIPTS['finder.windows'].source)
          return {
            code: 0,
            stderr: '',
            stdout: JSON.stringify({
              running: true,
              folders: [{ url: `file://${project}/`, name: 'fixture-project' }],
            }),
          }
        if (src === SCRIPTS['app.running'].source)
          return {
            code: 0,
            stderr: '',
            stdout: JSON.stringify({ installed: true, running: false }),
          }
        return {
          code: 0,
          stderr: '',
          stdout:
            '{"running":false,"windows":[],"tabs":[],"folders":[],"notes":[],"events":[],"selected":[],"drafts":[]}',
        }
      }
      if (bin === 'git' || bin === 'ps' || bin === 'lsof') return defaultRunner(file, args, timeout)
      if (LIVE && bin === 'open') return defaultRunner(file, args, timeout)
      return { code: 0, stderr: '', stdout: '' } // recorded, not executed
    }
    const exec = new SafeExec(runner)
    const registry = new AdapterRegistry(allAdapters())
    const tmp = join(root, 'waypoint-data/tmp')
    mkdirSync(tmp, { recursive: true })
    const engine = new CaptureEngine({
      exec,
      registry,
      getSettings: () => DEFAULT_SETTINGS,
      getRules: () => buildRules([]),
      accessibility: () => true,
      noteAutomation: () => {},
      tempDir: tmp,
      homeDir: home,
    })
    const svc = new CheckpointService({
      store: db.store,
      engine,
      summarizer: new TemplateSummarizer(),
    })
    const cp = await svc.create('manual', null)
    expect(cp).not.toBeNull()

    const kinds = cp!.resources.map(
      (r) =>
        `${r.kind}:${'path' in r ? (r.path as string).replace(project, '<p>') : 'repoPath' in r ? r.repoPath.replace(project, '<p>') : r.app}`,
    )
    expect(kinds).toEqual(
      expect.arrayContaining([
        'workspace:<p>',
        'file:<p>/src/app.ts',
        'file:<p>/notes.txt',
        'file:<p>/brief.pdf',
        'folder:<p>',
        'gitState:<p>',
      ]),
    )
    const git = cp!.resources.find((r) => r.kind === 'gitState')
    expect(git).toMatchObject({ branch: 'feature/checkpoints', dirtyFiles: 1 })
    expect(cp!.resources.find((r) => r.kind === 'file' && r.path.endsWith('app.ts'))).toMatchObject(
      { line: 17, column: 5 },
    )

    // Restore: in live mode, only the document/folder items (TextEdit, Preview, Finder) are opened for real.
    const restore = new RestoreEngine({
      exec,
      registry,
      getSettings: () => DEFAULT_SETTINGS,
      readWindows: async () => [],
      sleep: async () => {},
    })
    const plan = restore.plan(cp!)
    const skip = LIVE
      ? new Set(
          plan.items
            .map((it, i) =>
              ['com.apple.TextEdit', 'com.apple.Preview', 'com.apple.finder'].includes(it.ref.app)
                ? -1
                : i,
            )
            .filter((i) => i >= 0),
        )
      : new Set<number>()
    const report = await restore.execute('fixture-run', plan, skip)
    expect(report.results).toHaveLength(plan.items.length)
    expect(report.results.filter((r) => r.status === 'failed')).toEqual([])
    if (LIVE) await new Promise((r) => setTimeout(r, 3000)) // let the apps actually open the files

    // Nothing created, nothing deleted, nothing changed (Waypoint's own temp dir excluded).
    const after = fingerprint(root)
    const strip = (m: Fingerprint) =>
      new Map([...m].filter(([p]) => !p.startsWith(join(root, 'waypoint-data'))))
    const created = [...strip(after).keys()].filter((p) => !before.has(p))
    // Finder itself writes view settings (.DS_Store) when a folder window opens; that is macOS
    // behaviour for the allowed "open a folder" action, not a Waypoint write. Anything else fails.
    expect(created.filter((p) => !(LIVE && p.endsWith('/.DS_Store')))).toEqual([])
    expect([...strip(before).keys()].filter((p) => !after.has(p))).toEqual([]) // nothing deleted
    for (const [p, fp] of strip(before)) expect(strip(after).get(p), p).toEqual(fp) // nothing modified

    // Every process Waypoint ran was an allowlisted, open-only/read-only command.
    for (const [file, ...args] of executed) {
      const bin = file!.split('/').pop()
      expect(['osascript', 'open', 'git', 'code', 'ps', 'lsof', 'xed']).toContain(bin)
      if (bin === 'git') expect(args[0]).toBe('--no-optional-locks')
      if (bin === 'osascript')
        expect(
          Object.values(SCRIPTS).some(
            (s) => s.source === args[3] && !('arrange' in s && s.arrange),
          ),
        ).toBe(true)
    }
    const opens = executed.filter(([f]) => f!.endsWith('/open')).map((a) => a.slice(1))
    expect(opens).toEqual(
      expect.arrayContaining([['-b', 'com.apple.TextEdit', '--', join(project, 'notes.txt')]]),
    )
    // Waypoint's temp copies of editor state are cleaned up.
    expect(readdirSync(tmp)).toEqual([])
    console.log(
      `[fixture-hash] ${before.size} files verified unchanged; new files by other apps: ${JSON.stringify(created.map((p) => p.replace(root, '')))}; ${executed.length} commands; live=${LIVE}; statuses=${JSON.stringify(report.results.map((r) => r.status))}`,
    )
  })
})
