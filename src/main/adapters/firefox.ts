import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ResourceRef, RestoreItemResult } from '@shared/schemas'
import type { AppAdapter } from './types'
import { errorReason, result } from './util'
import { describeUrl } from './web-apps'

/** Decompresses an LZ4 *block* (no frame). Small, dependency-free, bounds-checked. */
export function lz4BlockDecompress(src: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize)
  let si = 0
  let di = 0
  while (si < src.length) {
    const token = src[si++]!
    let lit = token >> 4
    if (lit === 15) {
      let b: number
      do {
        b = src[si++]!
        lit += b
      } while (b === 255 && si < src.length)
    }
    if (si + lit > src.length || di + lit > outSize) throw new Error('lz4: literal out of bounds')
    out.set(src.subarray(si, si + lit), di)
    si += lit
    di += lit
    if (si >= src.length) break
    const offset = src[si]! | (src[si + 1]! << 8)
    si += 2
    if (offset === 0 || offset > di) throw new Error('lz4: bad offset')
    let len = token & 15
    if (len === 15) {
      let b: number
      do {
        b = src[si++]!
        len += b
      } while (b === 255 && si < src.length)
    }
    len += 4
    if (di + len > outSize) throw new Error('lz4: match out of bounds')
    for (let k = 0; k < len; k++, di++) out[di] = out[di - offset]!
  }
  return out.subarray(0, di)
}

/** Parses Firefox's "mozLz40\0" + uint32 size + LZ4 block session file. */
export function readMozLz4(buf: Buffer): string {
  if (buf.subarray(0, 8).toString('latin1') !== 'mozLz40\0') throw new Error('not a mozlz4 file')
  const size = buf.readUInt32LE(8)
  if (size > 200 * 1024 * 1024) throw new Error('session file too large')
  return Buffer.from(lz4BlockDecompress(buf.subarray(12), size)).toString('utf8')
}

interface FxSession {
  windows?: {
    isPrivate?: boolean
    selected?: number
    tabs?: { index?: number; entries?: { url?: string; title?: string }[] }[]
  }[]
  selectedWindow?: number
}

export function tabsFromSession(json: string): { url: string; title: string; focused: boolean }[] {
  const s = JSON.parse(json) as FxSession
  const out: { url: string; title: string; focused: boolean }[] = []
  ;(s.windows ?? []).forEach((w, wi) => {
    if (w.isPrivate) return // private windows are never captured
    ;(w.tabs ?? []).forEach((t, ti) => {
      const e = t.entries?.[(t.index ?? t.entries.length) - 1]
      if (!e?.url || !/^https?:/.test(e.url)) return
      out.push({
        url: e.url,
        title: e.title ?? e.url,
        focused: wi + 1 === (s.selectedWindow ?? 1) && ti + 1 === (w.selected ?? 1),
      })
    })
  })
  return out
}

const BUNDLE = 'org.mozilla.firefox'

export const firefoxAdapter: AppAdapter = {
  id: 'firefox',
  displayName: 'Firefox',
  bundleIds: [BUNDLE],
  tier: 'partial',
  needsAutomation: false,
  notes:
    'No AppleScript. Reads tab URLs/titles from Firefox’s own session file (sessionstore-backups/recovery.jsonlz4) read-only; private windows are excluded. Restores with `open -b org.mozilla.firefox <url>` (new tab); cannot focus an existing tab, so already-open tabs are detected from the session file and skipped. Untested on this Mac (not installed).',
  handles: (ref) => ref.app === BUNDLE && ref.kind === 'url',
  async capture(ctx) {
    if (!ctx.isRunning(BUNDLE)) return []
    const file = latestSessionFile(ctx.homeDir)
    if (!file) return []
    return tabsFromSession(readMozLz4(readFileSync(file)))
      .slice(0, 120)
      .map((t): ResourceRef => ({
        kind: 'url',
        app: BUNDLE,
        url: t.url,
        title: t.title.slice(0, 300),
        focused: t.focused || undefined,
      }))
  },
  isRunning: (ctx) => ctx.isRunning(BUNDLE),
  async alreadyOpen(ref, ctx) {
    if (ref.kind !== 'url' || !(await ctx.isRunning(BUNDLE))) return false
    const file = latestSessionFile(process.env['HOME'] ?? '')
    if (!file) return false
    try {
      return tabsFromSession(readMozLz4(readFileSync(file))).some((t) => t.url === ref.url)
    } catch {
      return false
    }
  },
  describe: (ref) =>
    ref.kind === 'url'
      ? {
          action: 'open',
          description: `${describeUrl(ref.url, ref.title)} in Firefox`,
          reason: 'Firefox can’t be asked to focus a tab; opens a new tab unless already open',
        }
      : { action: 'info', description: '' },
  async restore(refs, ctx) {
    const out: RestoreItemResult[] = []
    for (const ref of refs) {
      const t0 = Date.now()
      if (ref.kind !== 'url') continue
      try {
        if (await this.alreadyOpen(ref, ctx)) {
          await ctx.exec.launchApp(BUNDLE)
          out.push(
            result(
              ref,
              'firefox',
              'already-open',
              'Tab is already open in Firefox; brought Firefox to front',
              t0,
            ),
          )
          continue
        }
        await ctx.exec.openUrl(ref.url, { bundleId: BUNDLE })
        out.push(result(ref, 'firefox', 'opened', 'Opened in a new tab', t0))
      } catch (e) {
        out.push(result(ref, 'firefox', 'failed', errorReason(e), t0))
      }
    }
    return out
  },
}

function latestSessionFile(home: string): string | null {
  const root = join(home, 'Library/Application Support/Firefox/Profiles')
  if (!existsSync(root)) return null
  let best: { p: string; m: number } | null = null
  for (const prof of readdirSync(root)) {
    const p = join(root, prof, 'sessionstore-backups/recovery.jsonlz4')
    try {
      const m = statSync(p).mtimeMs
      if (!best || m > best.m) best = { p, m }
    } catch {
      /* none */
    }
  }
  return best?.p ?? null
}
