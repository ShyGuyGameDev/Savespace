/** Manual check: capture VS Code/Cursor state from this Mac (read-only copies), print a summary. */
import { mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS } from '../src/shared/constants'
import { cursorAdapter, vscodeAdapter } from '../src/main/adapters/vscode-family'
import { SafeExec } from '../src/main/safe-exec'

const tempDir = join(tmpdir(), 'waypoint-smoke-tmp')
mkdirSync(tempDir, { recursive: true })
const ctx = {
  exec: new SafeExec(),
  settings: DEFAULT_SETTINGS,
  apps: [],
  accessibility: false,
  isRunning: () => true,
  noteAutomation: () => {},
  tempDir,
  homeDir: homedir(),
}
const run = async () => {
  for (const a of [vscodeAdapter, cursorAdapter]) {
    const refs = await a.capture(ctx)
    const ws = refs.filter((r) => r.kind === 'workspace').length
    const files = refs.filter((r) => r.kind === 'file')
    console.log(
      `${a.displayName}: ${ws} recent workspace(s), ${files.length} open file(s), ${files.filter((f) => f.kind === 'file' && f.line).length} with cursor line`,
    )
  }
}
run()
