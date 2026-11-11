import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

/**
 * Every external binary Savespace may execute, with absolute candidate paths (never a PATH/shell
 * lookup) and a validator that rejects any argument vector outside the allowed shape.
 */
export interface BinarySpec {
  id: string
  candidates: string[]
  validate(args: string[]): string | null // returns an error message, or null if OK
}

const isAbs = (s: string) => s.startsWith('/') && !s.includes('\0')
const noFlagInjection = (s: string) => !s.startsWith('-')
const posLike = /^\/[^\0]*?(:\d+(:\d+)?)?$/

/** VS Code-family CLIs: open folders/files, optionally -r (reuse window), -g file:line:col. Nothing else. */
const vscodeFamilyValidate = (args: string[]): string | null => {
  const allowedFlags = new Set(['-r', '--reuse-window', '-g', '--goto', '-n', '--new-window'])
  for (const a of args) {
    if (a.startsWith('-')) {
      if (!allowedFlags.has(a)) return `flag not allowed: ${a}`
    } else if (!posLike.test(a)) return `argument must be an absolute path: ${a}`
  }
  return null
}

const appCli = (bundle: string, rel: string) => [
  `/Applications/${bundle}/${rel}`,
  `${homedir()}/Applications/${bundle}/${rel}`,
]

const jetbrainsValidate = (args: string[]): string | null => {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--line' || a === '--column') {
      if (!/^\d+$/.test(args[i + 1] ?? '')) return `${a} needs a number`
      i++
    } else if (a.startsWith('-')) return `flag not allowed: ${a}`
    else if (!isAbs(a)) return `argument must be an absolute path: ${a}`
  }
  return null
}

export const BINARIES: Record<string, BinarySpec> = {
  open: {
    id: 'open',
    candidates: ['/usr/bin/open'],
    // Only: open [-g] [-b bundleId | -a AppName] -- <target>
    validate(args) {
      let i = 0
      if (args[i] === '-g') i++
      if (args[i] === '-b' || args[i] === '-a') {
        const v = args[i + 1]
        if (!v || v.startsWith('-')) return 'missing app for -a/-b'
        i += 2
      }
      if (args[i] !== '--') return 'open requires "--" before the target'
      const rest = args.slice(i + 1)
      if (rest.length > 1) return 'open accepts exactly one target'
      return null
    },
  },
  osascript: {
    id: 'osascript',
    candidates: ['/usr/bin/osascript'],
    // Only: osascript -l JavaScript -e <registered template> [args...]  (checked again by SafeExec)
    validate(args) {
      if (
        args[0] !== '-l' ||
        args[1] !== 'JavaScript' ||
        args[2] !== '-e' ||
        typeof args[3] !== 'string'
      ) {
        return 'osascript must be invoked as -l JavaScript -e <template>'
      }
      return null
    },
  },
  lsappinfo: {
    id: 'lsappinfo',
    candidates: ['/usr/bin/lsappinfo'],
    validate(args) {
      const ok =
        (args.length === 1 && (args[0] === 'front' || args[0] === 'visibleProcessList')) ||
        (args[0] === 'info' &&
          args[1] === '-only' &&
          ['bundleid', 'name'].includes(args[2] ?? '') &&
          /^[\w-]+:[\w-]+$|^ASN:[\w:-]+$/.test(args[3] ?? '') &&
          args.length === 4)
      return ok
        ? null
        : 'lsappinfo: only front / visibleProcessList / info -only bundleid|name <ASN>'
    },
  },
  git: {
    id: 'git',
    candidates: ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'],
    // Only a fixed set of read-only queries. --no-optional-locks prevents index refresh writes.
    validate(args) {
      if (args[0] !== '--no-optional-locks' || args[1] !== '-C' || !isAbs(args[2] ?? '')) {
        return 'git must be invoked as --no-optional-locks -C <abs path> <read-only query>'
      }
      const q = args.slice(3).join(' ')
      const allowed = [
        'rev-parse --show-toplevel',
        'rev-parse --abbrev-ref HEAD',
        'status --porcelain=v1 --untracked-files=normal',
        'remote get-url origin',
        'rev-list --left-right --count HEAD...@{upstream}',
      ]
      return allowed.includes(q) ? null : `git query not allowed: ${q}`
    },
  },
  lsof: {
    id: 'lsof',
    candidates: ['/usr/sbin/lsof'],
    validate(args) {
      return args.length === 6 &&
        args[0] === '-a' &&
        args[1] === '-d' &&
        args[2] === 'cwd' &&
        args[3] === '-p' &&
        /^\d+$/.test(args[4] ?? '') &&
        args[5] === '-Fn'
        ? null
        : 'lsof: only -a -d cwd -p <pid> -Fn'
    },
  },
  ps: {
    id: 'ps',
    candidates: ['/bin/ps'],
    validate(args) {
      return args.length === 4 &&
        args[0] === '-o' &&
        args[1] === 'pid=,comm=' &&
        args[2] === '-t' &&
        /^ttys\d{3,4}$/.test(args[3] ?? '')
        ? null
        : 'ps: only -o pid=,comm= -t ttysNNN'
    },
  },
  code: {
    id: 'code',
    candidates: [
      '/usr/local/bin/code',
      '/opt/homebrew/bin/code',
      ...appCli('Visual Studio Code.app', 'Contents/Resources/app/bin/code'),
    ],
    validate: vscodeFamilyValidate,
  },
  'code-insiders': {
    id: 'code-insiders',
    candidates: [
      '/usr/local/bin/code-insiders',
      ...appCli('Visual Studio Code - Insiders.app', 'Contents/Resources/app/bin/code-insiders'),
    ],
    validate: vscodeFamilyValidate,
  },
  cursor: {
    id: 'cursor',
    candidates: [
      '/usr/local/bin/cursor',
      ...appCli('Cursor.app', 'Contents/Resources/app/bin/cursor'),
    ],
    validate: vscodeFamilyValidate,
  },
  windsurf: {
    id: 'windsurf',
    candidates: [
      '/usr/local/bin/windsurf',
      ...appCli('Windsurf.app', 'Contents/Resources/app/bin/windsurf'),
    ],
    validate: vscodeFamilyValidate,
  },
  zed: {
    id: 'zed',
    candidates: ['/usr/local/bin/zed', ...appCli('Zed.app', 'Contents/MacOS/cli')],
    validate: (args) =>
      args.every((a) => posLike.test(a))
        ? null
        : 'zed: only absolute paths (with optional :line:col)',
  },
  subl: {
    id: 'subl',
    candidates: [
      '/usr/local/bin/subl',
      ...appCli('Sublime Text.app', 'Contents/SharedSupport/bin/subl'),
    ],
    validate: (args) =>
      args.every((a) => posLike.test(a))
        ? null
        : 'subl: only absolute paths (with optional :line:col)',
  },
  xed: {
    id: 'xed',
    candidates: ['/usr/bin/xed'],
    validate(args) {
      if (args[0] === '--line') {
        if (!/^\d+$/.test(args[1] ?? '') || !isAbs(args[2] ?? '') || args.length !== 3)
          return 'xed --line N <abs path>'
        return null
      }
      return args.length === 1 && isAbs(args[0]!) ? null : 'xed: one absolute path'
    },
  },
  idea: {
    id: 'idea',
    candidates: ['/usr/local/bin/idea', `${homedir()}/.local/bin/idea`],
    validate: jetbrainsValidate,
  },
  webstorm: {
    id: 'webstorm',
    candidates: ['/usr/local/bin/webstorm', `${homedir()}/.local/bin/webstorm`],
    validate: jetbrainsValidate,
  },
  pycharm: {
    id: 'pycharm',
    candidates: ['/usr/local/bin/pycharm', `${homedir()}/.local/bin/pycharm`],
    validate: jetbrainsValidate,
  },
  goland: {
    id: 'goland',
    candidates: ['/usr/local/bin/goland', `${homedir()}/.local/bin/goland`],
    validate: jetbrainsValidate,
  },
}

/**
 * Savespace's own Apple on-device AI bridge (resources/apple-ai/savespace-apple-ai). Its path is only
 * known at runtime (inside the app bundle), so it's registered once at startup.
 * Allowed shapes: `status` | `summarize <instructions> <prompt>`.
 */
/**
 * Opens a URL in a specific browser profile (account). Only the browser's own executable, only
 * `--profile-directory=<Chromium profile folder>` plus one http(s) URL. If the browser is already
 * running, the call hands the URL to it (new tab in that profile) and exits.
 */
const profileCliValidate = (args: string[]): string | null => {
  if (args.length !== 2) return 'browser profile: exactly --profile-directory=<dir> <url>'
  const m = args[0]!.match(/^--profile-directory=(.+)$/)
  if (!m || !/^(Default|Profile \d{1,4}|Guest Profile)$/.test(m[1]!))
    return 'browser profile: invalid profile folder'
  if (!/^https?:\/\/[^\s]+$/i.test(args[1]!)) return 'browser profile: only http(s) URLs'
  return null
}
const browserBin = (app: string, exe: string): string[] => [
  `/Applications/${app}/Contents/MacOS/${exe}`,
  `${homedir()}/Applications/${app}/Contents/MacOS/${exe}`,
]
BINARIES['chrome-profile'] = {
  id: 'chrome-profile',
  candidates: browserBin('Google Chrome.app', 'Google Chrome'),
  validate: profileCliValidate,
}
BINARIES['brave-profile'] = {
  id: 'brave-profile',
  candidates: browserBin('Brave Browser.app', 'Brave Browser'),
  validate: profileCliValidate,
}
BINARIES['edge-profile'] = {
  id: 'edge-profile',
  candidates: browserBin('Microsoft Edge.app', 'Microsoft Edge'),
  validate: profileCliValidate,
}
BINARIES['vivaldi-profile'] = {
  id: 'vivaldi-profile',
  candidates: browserBin('Vivaldi.app', 'Vivaldi'),
  validate: profileCliValidate,
}
BINARIES['chromium-profile'] = {
  id: 'chromium-profile',
  candidates: browserBin('Chromium.app', 'Chromium'),
  validate: profileCliValidate,
}

BINARIES['apple-ai'] = {
  id: 'apple-ai',
  candidates: [],
  validate(args) {
    if (args.length === 1 && args[0] === 'status') return null
    if (
      args.length === 3 &&
      args[0] === 'summarize' &&
      args[1]!.length <= 4000 &&
      args[2]!.length <= 12000
    )
      return null
    return 'apple-ai: only `status` or `summarize <instructions> <prompt>`'
  },
}

export function registerAppleAiHelper(path: string): void {
  if (!path.endsWith('/apple-ai/savespace-apple-ai')) throw new Error('unexpected helper path')
  BINARIES['apple-ai']!.candidates = [path]
}

export function resolveBinary(
  id: string,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const spec = BINARIES[id]
  if (!spec) return null
  return spec.candidates.find((c) => exists(c)) ?? null
}

export { noFlagInjection }
