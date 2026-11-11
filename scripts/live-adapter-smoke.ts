/** Manual live smoke test of open-only restore paths that need no Automation consent. */
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { DEFAULT_SETTINGS } from '../src/shared/constants'
import { cursorAdapter, vscodeAdapter } from '../src/main/adapters/vscode-family'
import { terminalAdapter } from '../src/main/adapters/terminals'
import { slackAdapter } from '../src/main/adapters/desktop-apps'
import type { RestoreContext } from '../src/main/adapters/types'
import { SafeExec } from '../src/main/safe-exec'

const dir = process.argv[2]!
const file = `${dir}/smoke.txt`
const team = process.argv[3]
const exec = new SafeExec()
const ctx: RestoreContext = {
  exec,
  settings: DEFAULT_SETTINGS,
  isCancelled: () => false,
  windows: async () => [],
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  isRunning: async (b) => (await exec.script<{ running: boolean }>('app.running', [b])).running,
}
const hash = () =>
  createHash('sha256').update(readFileSync(file)).digest('hex') + ':' + statSync(file).mtimeMs
const run = async () => {
  const before = hash()
  const out = [
    ...(await vscodeAdapter.restore(
      [{ kind: 'file', app: 'com.microsoft.VSCode', path: file, line: 42, column: 3 }],
      ctx,
    )),
    ...(await cursorAdapter.restore(
      [{ kind: 'file', app: 'com.todesktop.230313mzl4w4u92', path: file, line: 17, column: 1 }],
      ctx,
    )),
    ...(await terminalAdapter.restore(
      [{ kind: 'terminalCwd', app: 'com.apple.Terminal', path: dir }],
      ctx,
    )),
    ...(team
      ? await slackAdapter.restore(
          [
            {
              kind: 'deepLink',
              app: 'com.tinyspeck.slackmacgap',
              url: `slack://open?team=${team}`,
            },
          ],
          ctx,
        )
      : []),
  ]
  for (const r of out)
    console.log(`${r.adapterId.padEnd(10)} ${r.status.padEnd(13)} ${r.reason ?? ''}`)
  console.log('file unchanged:', before === hash())
  console.log(
    'commands:',
    exec.records.map((r) => `${r.binary} ${r.args.join(' ')}`.slice(0, 120)),
  )
}
run()
