#!/usr/bin/env node
/**
 * Compiles the tiny Apple on-device AI bridge (native/apple-ai/main.swift) into
 * resources/apple-ai/waypoint-apple-ai. Needs Apple's Swift compiler (Xcode Command Line Tools)
 * and a macOS 26+ SDK. If either is missing, the app still works: it just skips Apple's model
 * and uses the downloaded fallback model instead.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const src = join(root, 'native/apple-ai/main.swift')
const out = join(root, 'resources/apple-ai/waypoint-apple-ai')

if (process.platform !== 'darwin') process.exit(0)
if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) {
  console.log('[apple-ai] helper up to date')
  process.exit(0)
}
mkdirSync(join(root, 'resources/apple-ai'), { recursive: true })
try {
  execFileSync(
    '/usr/bin/xcrun',
    ['swiftc', '-O', '-parse-as-library', '-target', 'arm64-apple-macos15.0', src, '-o', out],
    { stdio: 'inherit' },
  )
  console.log('[apple-ai] built resources/apple-ai/waypoint-apple-ai')
} catch {
  console.warn(
    '[apple-ai] could not build the Apple on-device AI helper (needs Xcode Command Line Tools with a macOS 26+ SDK). Waypoint will use the downloaded model instead.',
  )
}
