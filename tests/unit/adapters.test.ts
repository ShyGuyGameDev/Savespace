import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/constants'
import type { ResourceRef } from '@shared/schemas'
import { allAdapters } from '../../src/main/adapters'
import { chromeAdapter, safariAdapter } from '../../src/main/adapters/browsers'
import { mailAdapter } from '../../src/main/adapters/apple-apps'
import { lz4BlockDecompress, readMozLz4, tabsFromSession } from '../../src/main/adapters/firefox'
import { cwdFromTitle } from '../../src/main/adapters/terminals'
import type { RestoreContext } from '../../src/main/adapters/types'
import { parseVsState, vscodeAdapter } from '../../src/main/adapters/vscode-family'
import { classifyUrl } from '../../src/main/adapters/web-apps'
import { SafeExec, type Runner } from '../../src/main/safe-exec'

function rctx(
  runner: Runner,
  running: Record<string, boolean> = {},
): { ctx: RestoreContext; calls: string[][] } {
  const calls: string[][] = []
  const exec = new SafeExec(
    async (f, a, t) => {
      calls.push([f, ...a])
      return runner(f, a, t)
    },
    { resolve: (id) => `/bin/${id}` },
  )
  return {
    calls,
    ctx: {
      exec,
      settings: DEFAULT_SETTINGS,
      isRunning: async (b) => !!running[b],
      isCancelled: () => false,
      windows: async () => [],
      sleep: async () => {},
    },
  }
}

describe('adapter registry contents', () => {
  it('every adapter has a unique id, a tier and support notes', () => {
    const all = allAdapters()
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length)
    for (const a of all) {
      expect(['deep', 'partial', 'launch-only']).toContain(a.tier)
      expect(a.notes.length).toBeGreaterThan(20)
    }
  })
})

describe('VS Code state parsing (fixture shaped like the real state.vscdb)', () => {
  const editorPart = JSON.stringify({
    'editorpart.state': {
      serializedGrid: {
        root: {
          type: 'branch',
          data: [
            {
              type: 'leaf',
              data: {
                id: 0,
                editors: [
                  {
                    id: 'workbench.editors.files.fileEditorInput',
                    value: JSON.stringify({
                      resourceJSON: {
                        $mid: 1,
                        fsPath: '/w/README.md',
                        path: '/w/README.md',
                        scheme: 'file',
                      },
                    }),
                  },
                  {
                    id: 'workbench.editors.files.fileEditorInput',
                    value: JSON.stringify({
                      resourceJSON: {
                        $mid: 1,
                        fsPath: '/w/src/a.ts',
                        path: '/w/src/a.ts',
                        scheme: 'file',
                      },
                    }),
                  },
                  {
                    id: 'x',
                    value: JSON.stringify({
                      resourceJSON: { scheme: 'vscode-remote', path: '/remote' },
                    }),
                  },
                ],
                mru: [1, 0],
              },
            },
            {
              type: 'leaf',
              data: {
                id: 1,
                editors: [
                  {
                    id: 'x',
                    value: JSON.stringify({ resourceJSON: { fsPath: '/w/b.ts', scheme: 'file' } }),
                  },
                ],
                mru: [0],
              },
            },
          ],
        },
      },
      activeGroup: 0,
    },
  })
  const textEditor = JSON.stringify({
    textEditorViewState: [
      [
        'file:///w/src/a.ts',
        { 0: { cursorState: [{ position: { lineNumber: 78, column: 41 } }] } },
      ],
    ],
  })
  it('extracts open files, the active file and cursor positions', () => {
    const s = parseVsState(editorPart, textEditor)
    expect(s.files).toEqual(['/w/README.md', '/w/src/a.ts', '/w/b.ts'])
    expect(s.active).toBe('/w/src/a.ts')
    expect(s.cursors.get('/w/src/a.ts')).toEqual({ line: 78, column: 41 })
  })
  it('tolerates garbage', () => {
    expect(parseVsState('{not json', null).files).toEqual([])
  })
  it('restores with `code -r -g file:line:col` via the CLI', async () => {
    const { ctx, calls } = rctx(async () => ({ stdout: '', stderr: '', code: 0 }))
    const ref: ResourceRef = {
      kind: 'file',
      app: 'com.microsoft.VSCode',
      path: __filename,
      line: 12,
      column: 3,
    }
    const [r] = await vscodeAdapter.restore([ref], ctx)
    expect(r?.status).toBe('opened')
    expect(calls[0]).toEqual(['/bin/code', '-r', '-g', `${__filename}:12:3`])
  })
  it('reports missing files instead of opening them', async () => {
    const { ctx, calls } = rctx(async () => ({ stdout: '', stderr: '', code: 0 }))
    const [r] = await vscodeAdapter.restore(
      [{ kind: 'file', app: 'com.microsoft.VSCode', path: '/definitely/not/here.ts' }],
      ctx,
    )
    expect(r).toMatchObject({ status: 'failed', reason: 'File no longer exists' })
    expect(calls).toHaveLength(0)
  })
})

describe('browser adapters', () => {
  it('focuses an existing tab instead of duplicating it', async () => {
    const { ctx, calls } = rctx(
      async () => ({ stdout: '{"status":"already-open"}', stderr: '', code: 0 }),
      { 'com.google.Chrome': true },
    )
    const [r] = await chromeAdapter.restore(
      [{ kind: 'url', app: 'com.google.Chrome', url: 'https://x.test/a' }],
      ctx,
    )
    expect(r?.status).toBe('already-open')
    expect(calls[0]?.slice(-2)).toEqual(['Google Chrome', 'https://x.test/a'])
  })
  it('starts the browser with the URL when it is not running (no script)', async () => {
    const { ctx, calls } = rctx(async () => ({ stdout: '', stderr: '', code: 0 }))
    await chromeAdapter.restore(
      [{ kind: 'url', app: 'com.google.Chrome', url: 'https://x.test/a' }],
      ctx,
    )
    expect(calls).toEqual([['/bin/open', '-b', 'com.google.Chrome', '--', 'https://x.test/a']])
  })
  it('falls back to open-only when Automation is denied', async () => {
    const { ctx, calls } = rctx(
      async (f) =>
        f.endsWith('osascript')
          ? { stdout: '', stderr: 'Not authorized to send Apple events (-1743)', code: 1 }
          : { stdout: '', stderr: '', code: 0 },
      { 'com.google.Chrome': true },
    )
    const [r] = await chromeAdapter.restore(
      [{ kind: 'url', app: 'com.google.Chrome', url: 'https://x.test/a' }],
      ctx,
    )
    expect(r?.reason).toMatch(/without checking/)
    expect(calls.at(-1)).toEqual(['/bin/open', '-b', 'com.google.Chrome', '--', 'https://x.test/a'])
  })
  it('does not capture Safari tabs unless opted in', async () => {
    const ctx = {
      exec: new SafeExec(async () => {
        throw new Error('should not run')
      }),
      settings: DEFAULT_SETTINGS,
      apps: [],
      accessibility: true,
      isRunning: () => true,
      noteAutomation: () => {},
      tempDir: '/tmp',
      homeDir: '/tmp',
    }
    expect(await safariAdapter.capture(ctx)).toEqual([])
  })
})

describe('mail adapter', () => {
  it('opens drafts with a percent-encoded message:// link', async () => {
    const { ctx, calls } = rctx(async () => ({ stdout: '', stderr: '', code: 0 }))
    const [r] = await mailAdapter.restore(
      [{ kind: 'draft', app: 'com.apple.mail', messageId: 'ABC-123@mac.com', subject: 'Q3 plan' }],
      ctx,
    )
    expect(r?.status).toBe('opened')
    expect(calls[0]).toEqual(['/bin/open', '--', 'message://%3CABC-123%40mac.com%3E'])
  })
})

describe('firefox session reader', () => {
  it('decodes an LZ4 block with a back-reference', () => {
    // literal "abc" + match(offset 3, length 9) => "abcabcabcabc"
    const block = new Uint8Array([0x35, 0x61, 0x62, 0x63, 0x03, 0x00])
    expect(Buffer.from(lz4BlockDecompress(block, 12)).toString()).toBe('abcabcabcabc')
  })
  it('reads mozLz40 files and skips private windows', () => {
    const json = JSON.stringify({
      selectedWindow: 1,
      windows: [
        {
          selected: 2,
          tabs: [
            { index: 1, entries: [{ url: 'https://a.test', title: 'A' }] },
            {
              index: 2,
              entries: [{ url: 'https://old.test' }, { url: 'https://b.test', title: 'B' }],
            },
          ],
        },
        { isPrivate: true, tabs: [{ index: 1, entries: [{ url: 'https://secret.test' }] }] },
      ],
    })
    const raw = Buffer.from(json)
    // Literal-only LZ4 block: token with length 15 + extension bytes.
    const ext: number[] = []
    let rem = raw.length - 15
    while (rem >= 255) {
      ext.push(255)
      rem -= 255
    }
    ext.push(rem)
    const header = Buffer.alloc(12)
    header.write('mozLz40\0', 0, 'latin1')
    header.writeUInt32LE(raw.length, 8)
    const file = Buffer.concat([header, Buffer.from([0xf0, ...ext]), raw])
    const tabs = tabsFromSession(readMozLz4(file))
    expect(tabs).toEqual([
      { url: 'https://a.test', title: 'A', focused: false },
      { url: 'https://b.test', title: 'B', focused: true },
    ])
  })
})

describe('web app recognition', () => {
  it.each([
    ['https://mail.google.com/mail/u/0/#drafts?compose=CllgCJ', 'Gmail draft'],
    ['https://acme.atlassian.net/browse/WP-12', 'Jira ticket WP-12'],
    ['https://linear.app/acme/issue/ENG-7/fix', 'Linear issue ENG-7'],
    ['https://github.com/o/r/pull/42', 'GitHub PR #42 in o/r'],
    ['https://gitlab.com/g/r/-/merge_requests/5', 'GitLab MR !5 in g/r'],
    ['https://www.figma.com/design/KEY/Name?node-id=1-2', 'Figma frame'],
    ['https://docs.google.com/spreadsheets/d/abc/edit', 'Google Sheet'],
    ['https://trello.com/c/xyz', 'Trello card'],
  ])('%s → %s', (url, label) => expect(classifyUrl(url)?.label).toBe(label))
  it('maps Slack web links to desktop deep links', () => {
    expect(classifyUrl('https://app.slack.com/client/T123/C456')?.deepLink).toBe(
      'slack://channel?team=T123&id=C456',
    )
  })
})

describe('terminal cwd from titles', () => {
  it('reads ~/ paths from titles', () => {
    expect(cwdFromTitle('~ — -zsh', process.env['HOME']!)).toBe(process.env['HOME'])
    expect(cwdFromTitle('vim notes.txt', '/Users/x')).toBeNull()
  })
})
