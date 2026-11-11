#!/usr/bin/env node
/**
 * Privacy & safety audit runner. Produces docs/evidence/safety-audit-results.txt.
 *   npm run audit:safety            # static + unit + fixture-hash (dry) tests
 *   npm run audit:safety -- --live  # also runs the LIVE fixture restore (opens TextEdit/Preview/Finder)
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const live = process.argv.includes('--live')
const root = new URL('..', import.meta.url).pathname
const electron = join(root, 'node_modules/.bin/electron')
const vitest = join(root, 'node_modules/vitest/vitest.mjs')
const run = (files, env = {}) => {
  try {
    return execFileSync(electron, [vitest, 'run', ...files, '--reporter=verbose'], {
      cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    return String(e.stdout ?? '') + String(e.stderr ?? '') + '\nAUDIT: FAILED'
  }
}

const sections = [
  [
    'Script registry linter (forbidden verbs, method/assignment allowlists)',
    ['tests/unit/script-registry.test.ts'],
  ],
  [
    'SafeExec (allowlisted binaries, argument validation, blocked schemes/executables)',
    ['tests/unit/safe-exec.test.ts'],
  ],
  [
    'Static source checks (child_process, network, file writes, Electron baseline, CSP)',
    ['tests/unit/security-static.test.ts'],
  ],
  [
    'Privacy filter (password managers, private windows, secrets in URLs)',
    ['tests/unit/capture.test.ts'],
  ],
  ['Encrypted storage, export, delete-all', ['tests/unit/db.test.ts']],
  [
    'Fixture-hash integration (capture + restore leaves files unchanged)',
    ['tests/integration/restore-fixtures.test.ts'],
  ],
]
let out = `Savespace privacy & safety audit\nRun at: ${new Date().toISOString()}\nmacOS: ${execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()}\nLive restore: ${live}\n\n`
let failed = false
for (const [title, files] of sections) {
  const r = run(files)
  const summary = r
    .split('\n')
    .filter((l) => /Tests\s+\d|Test Files|\[fixture-hash\]|AUDIT: FAILED|FAIL /.test(l))
    .join('\n')
  failed ||= /AUDIT: FAILED|failed/.test(summary)
  out += `== ${title}\n${summary}\n\n`
}
if (live) {
  const r = run(['tests/integration/restore-fixtures.test.ts'], { SAVESPACE_LIVE_RESTORE: '1' })
  const summary = r
    .split('\n')
    .filter((l) => /Tests\s+\d|\[fixture-hash\]|AUDIT: FAILED/.test(l))
    .join('\n')
  failed ||= /AUDIT: FAILED|failed/.test(summary)
  out += `== LIVE fixture restore (TextEdit, Preview, Finder really opened the fixtures)\n${summary}\n\n`
}
out += failed ? 'RESULT: FAIL\n' : 'RESULT: PASS\n'
mkdirSync(join(root, 'docs/evidence'), { recursive: true })
writeFileSync(join(root, 'docs/evidence/safety-audit-results.txt'), out)
process.stdout.write(out)
process.exit(failed ? 1 : 0)
