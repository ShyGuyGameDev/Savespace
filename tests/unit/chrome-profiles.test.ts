import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/constants'
import { chromeAdapter } from '../../src/main/adapters/browsers'
import {
  indexProfiles,
  profileForWindow,
  readProfiles,
  sessionUrls,
} from '../../src/main/adapters/chromium-profiles'
import type { CaptureContext, RestoreContext } from '../../src/main/adapters/types'
import { SafeExec, type Runner } from '../../src/main/safe-exec'

/** Builds a fake ~/Library/Application Support/Google/Chrome with two signed-in profiles. */
function fakeChromeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'wp-chrome-'))
  const data = join(home, 'Library/Application Support/Google/Chrome')
  mkdirSync(join(data, 'Default/Sessions'), { recursive: true })
  mkdirSync(join(data, 'Profile 1/Sessions'), { recursive: true })
  writeFileSync(
    join(data, 'Local State'),
    JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: 'Personal' },
          'Profile 1': { name: 'Work' },
          '../evil': { name: 'x' },
        },
      },
    }),
  )
  // SNSS-like binary: URLs embedded among other bytes.
  const snss = (urls: string[]) =>
    Buffer.concat([
      Buffer.from('SNSS\x03\x00\x00\x00', 'latin1'),
      ...urls.map((u) =>
        Buffer.concat([
          Buffer.from([0x10, 0, 0, 0]),
          Buffer.from(u, 'latin1'),
          Buffer.from([0, 0, 1]),
        ]),
      ),
    ])
  writeFileSync(
    join(data, 'Default/Sessions/Session_13300000000000000'),
    snss(['https://mail.google.com/mail/u/0/#inbox', 'https://youtube.com/']),
  )
  writeFileSync(
    join(data, 'Profile 1/Sessions/Session_13300000000000001'),
    snss([
      'https://mail.google.com/mail/u/0/#inbox',
      'https://acme.atlassian.net/browse/ATL-212',
      'https://github.com/acme/api',
    ]),
  )
  return home
}

describe('Chrome profile detection (read-only)', () => {
  it('reads profile names and session URLs, ignoring odd folder names', () => {
    const home = fakeChromeHome()
    const data = join(home, 'Library/Application Support/Google/Chrome')
    expect(readProfiles(data)).toEqual([
      { dir: 'Default', name: 'Personal' },
      { dir: 'Profile 1', name: 'Work' },
    ])
    expect([...sessionUrls(join(data, 'Profile 1'))]).toContain(
      'https://acme.atlassian.net/browse/ATL-212',
    )
  })

  it('assigns a window to the profile that has most of its tabs, and refuses ties', () => {
    const idx = indexProfiles(fakeChromeHome(), 'com.google.Chrome')!
    expect(
      profileForWindow(
        ['https://mail.google.com/mail/u/0/#inbox', 'https://acme.atlassian.net/browse/ATL-212'],
        idx.sessions,
      ),
    ).toBe('Profile 1')
    expect(profileForWindow(['https://youtube.com/'], idx.sessions)).toBe('Default')
    expect(profileForWindow(['https://mail.google.com/mail/u/0/#inbox'], idx.sessions)).toBeNull() // same URL open in both
    expect(profileForWindow(['https://unknown.test/'], idx.sessions)).toBeNull()
  })

  it('captures tabs with the right profile', async () => {
    const home = fakeChromeHome()
    const exec = new SafeExec(
      async () => ({
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          running: true,
          windows: [
            {
              index: 0,
              active: 1,
              tabs: [
                { url: 'https://acme.atlassian.net/browse/ATL-212', title: 'ATL-212' },
                { url: 'https://github.com/acme/api', title: 'api' },
              ],
            },
            { index: 1, active: 1, tabs: [{ url: 'https://youtube.com/', title: 'YouTube' }] },
          ],
        }),
      }),
      { resolve: (id) => `/bin/${id}` },
    )
    const ctx: CaptureContext = {
      exec,
      settings: DEFAULT_SETTINGS,
      apps: [],
      accessibility: true,
      isRunning: () => true,
      noteAutomation: () => {},
      tempDir: '/tmp',
      homeDir: home,
    }
    const refs = await chromeAdapter.capture(ctx)
    expect(refs.map((r) => (r.kind === 'url' ? `${r.url} → ${r.profile?.name}` : ''))).toEqual([
      'https://acme.atlassian.net/browse/ATL-212 → Work',
      'https://github.com/acme/api → Work',
      'https://youtube.com/ → Personal',
    ])
  })
})

describe('restoring into the right profile', () => {
  function rctx(runner: Runner) {
    const calls: string[][] = []
    const exec = new SafeExec(
      async (f, a, t) => {
        calls.push([f, ...a])
        return runner(f, a, t)
      },
      { resolve: (id) => `/bin/${id}` },
    )
    const ctx: RestoreContext = {
      exec,
      settings: DEFAULT_SETTINGS,
      isRunning: async () => true,
      isCancelled: () => false,
      windows: async () => [],
      sleep: async () => {},
    }
    return { ctx, calls }
  }
  const ref = {
    kind: 'url' as const,
    app: 'com.google.Chrome',
    url: 'https://acme.atlassian.net/browse/ATL-212',
    profile: { dir: 'Profile 1', name: 'Work' },
  }

  it('opens a new tab in the saved profile via --profile-directory', async () => {
    const { ctx, calls } = rctx(async (f) =>
      f.endsWith('osascript')
        ? { code: 0, stderr: '', stdout: '{"running":true,"windows":[]}' }
        : { code: 0, stderr: '', stdout: '' },
    )
    const [r] = await chromeAdapter.restore([ref], ctx)
    expect(r).toMatchObject({ status: 'opened', reason: 'Opened in a new tab in profile “Work”' })
    expect(calls.at(-1)).toEqual([
      '/bin/chrome-profile',
      '--profile-directory=Profile 1',
      'https://acme.atlassian.net/browse/ATL-212',
    ])
  })

  it('describes the profile in the restore preview', () => {
    expect(chromeAdapter.describe(ref).description).toMatch(/in Google Chrome \(profile “Work”\)$/)
  })

  it('the profile command accepts only a Chromium profile folder and an http(s) URL', async () => {
    const { ctx } = rctx(async () => ({ code: 0, stderr: '', stdout: '' }))
    const bad: string[][] = [
      ['--profile-directory=../../etc', 'https://x.test'],
      ['--profile-directory=Profile 1', 'file:///etc/passwd'],
      ['--profile-directory=Profile 1', 'https://x.test', '--remote-debugging-port=9222'],
      ['--remote-debugging-port=9222', 'https://x.test'],
      ['--profile-directory=Profile 1', '--headless'],
    ]
    for (const args of bad)
      await expect(ctx.exec.run('chrome-profile', args)).rejects.toThrow(/Blocked/)
  })
})
