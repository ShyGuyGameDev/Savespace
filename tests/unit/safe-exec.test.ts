import { describe, expect, it } from 'vitest'
import { SafeExec, type Runner } from '../../src/main/safe-exec'

function recorder() {
  const calls: { file: string; args: string[] }[] = []
  const runner: Runner = async (file, args) => {
    calls.push({ file, args })
    return { stdout: '{"ok":true}', stderr: '', code: 0 }
  }
  const exec = new SafeExec(runner, { resolve: (id) => `/bin/${id}` })
  return { exec, calls }
}

describe('SafeExec', () => {
  it('opens paths with execFile-style argument arrays and a "--" separator', async () => {
    const { exec, calls } = recorder()
    await exec.openPath('/Users/me/My "weird"; rm -rf ~.txt', { bundleId: 'com.apple.TextEdit' })
    expect(calls[0]).toEqual({
      file: '/bin/open',
      args: ['-b', 'com.apple.TextEdit', '--', '/Users/me/My "weird"; rm -rf ~.txt'],
    })
  })

  it.each([
    '/tmp/x.command',
    '/tmp/x.sh',
    '/Applications/Evil.app',
    '/tmp/a.scpt',
    '/tmp/a.workflow',
    '/tmp/a.terminal',
  ])('refuses to open executable %s', async (p) => {
    const { exec, calls } = recorder()
    await expect(exec.openPath(p)).rejects.toThrow(/Blocked/)
    expect(calls).toHaveLength(0)
  })

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'mailto:a@b.c',
    'x-man-page://ls',
    'ssh://host',
    'not a url',
  ])('refuses URL %s', async (u) => {
    const { exec, calls } = recorder()
    await expect(exec.openUrl(u)).rejects.toThrow(/Blocked/)
    expect(calls).toHaveLength(0)
  })

  it('allows https and known deep-link schemes', async () => {
    const { exec, calls } = recorder()
    await exec.openUrl('https://github.com/a/b/pull/1')
    await exec.openUrl('slack://channel?team=T1&id=C1')
    await exec.openUrl('message://%3cabc@x%3e')
    expect(calls.map((c) => c.args.at(-1))).toEqual([
      'https://github.com/a/b/pull/1',
      'slack://channel?team=T1&id=C1',
      'message://%3cabc@x%3e',
    ])
  })

  it('blocks binaries that are not allowlisted', async () => {
    const { exec } = recorder()
    await expect(exec.run('bash', ['-c', 'id'])).rejects.toThrow(/not allowlisted/)
    await expect(exec.run('rm', ['-rf', '/'])).rejects.toThrow(/not allowlisted/)
  })

  it('validates editor CLI flags', async () => {
    const { exec, calls } = recorder()
    await exec.run('code', ['-r', '-g', '/Users/me/p/a.ts:10:4'])
    expect(calls).toHaveLength(1)
    await expect(exec.run('code', ['--install-extension', 'evil'])).rejects.toThrow(
      /flag not allowed/,
    )
    await expect(exec.run('code', ['relative.ts'])).rejects.toThrow(/absolute/)
    await expect(exec.run('code', ['--', '/x'])).rejects.toThrow()
  })

  it('only allows read-only git queries with --no-optional-locks', async () => {
    const { exec } = recorder()
    await exec.run('git', [
      '--no-optional-locks',
      '-C',
      '/repo',
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ])
    await expect(exec.run('git', ['-C', '/repo', 'status'])).rejects.toThrow()
    await expect(
      exec.run('git', ['--no-optional-locks', '-C', '/repo', 'checkout', 'main']),
    ).rejects.toThrow(/not allowed/)
    await expect(
      exec.run('git', ['--no-optional-locks', '-C', '/repo', 'commit', '-am', 'x']),
    ).rejects.toThrow(/not allowed/)
  })

  it('runs only registered scripts, passing params as argv', async () => {
    const { exec, calls } = recorder()
    await exec.script('chromium.has-url', ['Google Chrome', 'https://x.test/"; quit app "Finder'])
    const args = calls[0]!.args
    expect(args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e'])
    expect(args.slice(4)).toEqual(['Google Chrome', 'https://x.test/"; quit app "Finder'])
    expect(args[3]).not.toContain('x.test')
    // @ts-expect-error unknown id
    await expect(exec.script('evil.script')).rejects.toThrow(/unregistered/)
  })

  it('refuses arrange scripts unless Arrange windows is on', async () => {
    const { exec } = recorder()
    await expect(
      exec.script('system-events.arrange', ['com.x', 't', '0', '0', '10', '10']),
    ).rejects.toThrow(/Arrange windows is turned off/)
    const on = new SafeExec(async () => ({ stdout: '{"ok":true}', stderr: '', code: 0 }), {
      resolve: (id) => `/bin/${id}`,
      canArrange: () => true,
    })
    await expect(
      on.script('system-events.arrange', ['com.x', 't', '0', '0', '10', '10']),
    ).resolves.toEqual({ ok: true })
  })

  it('maps Automation denial to not-authorized', async () => {
    const exec = new SafeExec(
      async () => ({
        stdout: '',
        stderr: 'execution error: Not authorized to send Apple events to Google Chrome. (-1743)',
        code: 1,
      }),
      { resolve: (id) => `/bin/${id}` },
    )
    await expect(exec.script('chromium.tabs', ['Google Chrome'])).rejects.toMatchObject({
      code: 'not-authorized',
    })
  })

  it('reads an app bundle id with plutil, but nothing else', async () => {
    const { exec } = recorder()
    await exec.run('plutil', [
      '-extract',
      'CFBundleIdentifier',
      'raw',
      '-o',
      '-',
      '/Applications/Safari.app/Contents/Info.plist',
    ])
    await expect(
      exec.run('plutil', [
        '-replace',
        'CFBundleIdentifier',
        '-string',
        'x',
        '/Applications/Safari.app/Contents/Info.plist',
      ]),
    ).rejects.toThrow(/Blocked/)
    await expect(
      exec.run('plutil', [
        '-extract',
        'CFBundleIdentifier',
        'raw',
        '-o',
        '/tmp/out',
        '/Applications/Safari.app/Contents/Info.plist',
      ]),
    ).rejects.toThrow(/Blocked/)
    await expect(
      exec.run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', '/etc/passwd']),
    ).rejects.toThrow(/Blocked/)
  })
})
