/**
 * Static guarantees checked against the source tree on every test run.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../..')
function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) files(p, out)
    else if (/\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}
const src = files(join(ROOT, 'src')).map((p) => ({
  path: relative(ROOT, p),
  code: readFileSync(p, 'utf8'),
}))

describe('open-only enforcement (static)', () => {
  it('only src/main/safe-exec may import child_process', () => {
    const offenders = src.filter(
      (f) =>
        /from ['"](node:)?child_process['"]|require\(['"](node:)?child_process/.test(f.code) &&
        !f.path.startsWith('src/main/safe-exec/'),
    )
    expect(offenders.map((f) => f.path)).toEqual([])
  })

  it('no shell strings: execFile only, never exec/spawn with shell', () => {
    const se = src
      .filter(
        (f) =>
          f.path.startsWith('src/main/safe-exec/') && f.path !== 'src/main/safe-exec/service.ts',
      )
      .map((f) => f.code)
      .join('\n')
    expect(se).not.toMatch(/\bexec\(|execSync|spawn\(|shell:\s*true/)
    expect(se).toMatch(/shell:\s*false/)
  })

  it('the only long-running process is the bundled AI engine: exact binary, `serve`, clean env, loopback, cloud off', () => {
    const svc = src.find((f) => f.path === 'src/main/safe-exec/service.ts')!.code
    expect(svc.match(/spawn\(/g)?.length).toBe(1)
    expect(svc).toMatch(
      /spawn\(o\.binary, \[\.\.\.ENGINE_ARGS\], \{\s*env: engineEnv\(o\),\s*shell: false/,
    )
    expect(svc).toMatch(/ENGINE_ARGS = \['serve'\] as const/)
    expect(svc).toMatch(/o\.binary !== allowedBinary/)
    expect(svc).toMatch(/OLLAMA_HOST: `127\.0\.0\.1:\$\{o\.port\}`/)
    expect(svc).toMatch(/OLLAMA_NO_CLOUD: '1'/)
    expect(svc).not.toMatch(/\.\.\.process\.env/)
  })

  it('no file writes outside Savespace-owned paths (writeFile only in db, privacy export, connectors, editor-state temp copies)', () => {
    const allowed = [
      'src/main/db/client.ts',
      'src/main/privacy/export.ts',
      'src/main/connectors/google.ts',
      'src/main/adapters/vscode-family.ts',
      'src/main/demo-seed.ts',
    ]
    const writers = src
      .filter((f) =>
        /\b(writeFileSync|writeFile|appendFile|copyFileSync|rmSync|unlinkSync|renameSync)\b/.test(
          f.code,
        ),
      )
      .map((f) => f.path)
    expect(writers.filter((p) => !allowed.includes(p))).toEqual([])
  })

  it('network access only through guardedFetch (no fetch/net/http clients elsewhere in main)', () => {
    const offenders = src.filter(
      (f) =>
        f.path.startsWith('src/main/') &&
        f.path !== 'src/main/net.ts' &&
        /(?<![.\w])fetch\(|net\.request|from ['"](node:)?https?['"]|axios/.test(f.code),
    )
    // The OAuth loopback receiver and the AI engine's egress gate import node:http only to LISTEN on
    // 127.0.0.1. The gate's single outbound connect() is checked separately below.
    expect(offenders.map((f) => f.path).sort()).toEqual([
      'src/main/connectors/oauth.ts',
      'src/main/summarizer/egress.ts',
    ])
    const oauth = offenders.find((f) => f.path.endsWith('oauth.ts'))!.code
    expect(oauth).toMatch(/import \{ createServer, type Server \} from 'node:http'/)
    expect(oauth).toMatch(/listen\(0, '127\.0\.0\.1'/)
    expect(oauth).not.toMatch(/\bhttps?\.(request|get)\(/)
  })

  it('raw sockets (node:net connect) exist only in the egress gate, behind the registry allowlist', () => {
    const users = src
      .filter(
        (f) =>
          f.path.startsWith('src/main/') &&
          /\bconnect\(Number\(|net\.connect|createConnection/.test(f.code),
      )
      .map((f) => f.path)
    expect(users).toEqual(['src/main/summarizer/egress.ts'])
    const gate = src.find((f) => f.path === 'src/main/summarizer/egress.ts')!.code
    expect(gate).toMatch(/if \(!egressAllowed\(target, this\.downloads > 0\)\)/)
    expect(gate).toMatch(/listen\(0, '127\.0\.0\.1'/)
  })

  it('the renderer never touches the network or Node', () => {
    const offenders = src.filter(
      (f) =>
        f.path.startsWith('src/renderer/') &&
        /(?<![.\w])fetch\(|XMLHttpRequest|WebSocket\(|require\(|from ['"]node:/.test(f.code),
    )
    expect(offenders.map((f) => f.path)).toEqual([])
  })
})

describe('Electron security baseline (static)', () => {
  const sec = readFileSync(join(ROOT, 'src/main/windows/security.ts'), 'utf8')
  const win = readFileSync(join(ROOT, 'src/main/windows/index.ts'), 'utf8')
  it('secure webPreferences', () => {
    expect(sec).toMatch(/contextIsolation: true/)
    expect(sec).toMatch(/nodeIntegration: false/)
    expect(sec).toMatch(/sandbox: true/)
    expect(sec).toMatch(/webSecurity: true/)
    expect(sec).toMatch(/webviewTag: false/)
    expect(win.match(/secureWebPreferences\(preloadPath\)/g)?.length).toBe(3)
    expect(win).not.toMatch(/webPreferences:\s*\{/)
  })
  it('denies window.open, navigation, webviews and permission requests', () => {
    expect(sec).toMatch(/setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/)
    expect(sec).toMatch(/will-navigate/)
    expect(sec).toMatch(/will-attach-webview/)
    expect(sec).toMatch(/setPermissionRequestHandler\(\(_wc, _permission, cb\) => cb\(false\)\)/)
  })
  it('strict CSP: no remote origins, no inline scripts', () => {
    const csp = readFileSync(join(ROOT, 'src/main/windows/csp.ts'), 'utf8')
    expect(csp).toMatch(/default-src 'none'/)
    expect(csp).toMatch(/script-src 'self'"/)
    expect(csp).not.toMatch(/https?:\/\//)
  })
  it('windows only load the local bundle (or dev server)', () => {
    expect(win).toMatch(/loadFile\(join\(__dirname, '\.\.\/renderer\/index\.html'\)/)
    expect(win.match(/loadURL\(/g)?.length).toBe(1)
    expect(win).toMatch(/if \(devUrl\) void win\.loadURL/)
  })
  it('preload exposes only the named-channel bridge', () => {
    const pre = readFileSync(join(ROOT, 'src/preload/index.ts'), 'utf8')
    expect(pre.match(/exposeInMainWorld/g)?.length).toBe(1)
    expect(pre).toMatch(/allowedChannels\.has\(channel\)/)
    expect(pre).not.toMatch(/ipcRenderer\.send\(|exposeInMainWorld\('ipcRenderer'/)
  })
  it('no Screen Recording APIs anywhere', () => {
    const bad = src.filter((f) =>
      /desktopCapturer|getDisplayMedia|CGWindowListCreateImage|screencapture|ScreenCapture/i.test(
        f.code,
      ),
    )
    expect(bad.map((f) => f.path)).toEqual([])
  })
})
