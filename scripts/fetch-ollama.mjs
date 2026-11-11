#!/usr/bin/env node
/**
 * Fetches the pinned Ollama engine into resources/ollama (bundled into the app).
 * Verifies the release's SHA-256 and keeps only what Waypoint needs on Apple Silicon:
 * `ollama`, `llama-server` and the license files (~93 MB instead of 580 MB).
 * No-op if the right version is already present.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const OLLAMA_VERSION = 'v0.40.12'
const SHA256 = '1d1b4c2cf40d2a239f9b08a77384830800a8542c744a55f47247f9baf85b55d2'
const URL_ = `https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-darwin.tgz`

const root = new URL('..', import.meta.url).pathname
const dest = join(root, 'resources/ollama')
const stamp = join(dest, 'VERSION')

if (process.platform !== 'darwin') {
  console.log('[fetch-ollama] not macOS; skipping')
  process.exit(0)
}
if (
  existsSync(stamp) &&
  readFileSync(stamp, 'utf8').trim() === OLLAMA_VERSION &&
  existsSync(join(dest, 'ollama'))
) {
  console.log(`[fetch-ollama] Ollama ${OLLAMA_VERSION} already present`)
  process.exit(0)
}

console.log(`[fetch-ollama] downloading Ollama ${OLLAMA_VERSION} (~186 MB)…`)
const res = await fetch(URL_, { redirect: 'follow' })
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
const buf = Buffer.from(await res.arrayBuffer())
const got = createHash('sha256').update(buf).digest('hex')
if (got !== SHA256) throw new Error(`checksum mismatch: expected ${SHA256}, got ${got}`)

const work = mkdtempSync(join(tmpdir(), 'waypoint-ollama-'))
try {
  writeFileSync(join(work, 'ollama-darwin.tgz'), buf)
  mkdirSync(join(work, 'x'))
  execFileSync('/usr/bin/tar', ['-xzf', join(work, 'ollama-darwin.tgz'), '-C', join(work, 'x')])
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  const keep = readdirSync(join(work, 'x')).filter(
    (f) => f === 'ollama' || f === 'llama-server' || /LICENSE|NOTICE/.test(f),
  )
  for (const f of keep) copyFileSync(join(work, 'x', f), join(dest, f))
  chmodSync(join(dest, 'ollama'), 0o755)
  chmodSync(join(dest, 'llama-server'), 0o755)
  const lic = await fetch(
    `https://raw.githubusercontent.com/ollama/ollama/${OLLAMA_VERSION}/LICENSE`,
  )
  writeFileSync(
    join(dest, 'OLLAMA_LICENSE'),
    lic.ok
      ? await lic.text()
      : 'Ollama is MIT licensed: https://github.com/ollama/ollama/blob/main/LICENSE\n',
  )
  writeFileSync(stamp, OLLAMA_VERSION + '\n')
  console.log(`[fetch-ollama] verified and installed ${keep.length} files into resources/ollama`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
