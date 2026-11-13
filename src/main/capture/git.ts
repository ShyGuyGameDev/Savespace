import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ResourceRef } from '@shared/schemas'
import type { SafeExec } from '../safe-exec'

/**
 * Read-only git inspection. Finds repo roots by looking for a `.git` entry on disk (no process),
 * then asks git a fixed set of read-only questions with --no-optional-locks (so git never
 * refreshes or writes the index).
 */
export class GitInspector {
  private rootCache = new Map<string, string | null>()

  constructor(
    private readonly exec: SafeExec,
    private readonly exists: (p: string) => boolean = existsSync,
  ) {}

  repoRootOf = (path: string): string | null => {
    if (this.rootCache.has(path)) return this.rootCache.get(path)!
    let dir = path
    try {
      if (this.exists(path) && !statSync(path).isDirectory()) dir = dirname(path)
    } catch {
      dir = dirname(path)
    }
    let found: string | null = null
    for (let i = 0; i < 40 && dir && dir !== '/'; i++) {
      if (this.exists(join(dir, '.git'))) {
        found = dir
        break
      }
      dir = dirname(dir)
    }
    this.rootCache.set(path, found)
    return found
  }

  async state(repoPath: string): Promise<Extract<ResourceRef, { kind: 'gitState' }> | null> {
    const q = async (...args: string[]) => {
      const r = await this.exec.run('git', ['--no-optional-locks', '-C', repoPath, ...args], {
        timeoutMs: 4000,
      })
      return r.code === 0 ? r.stdout.trim() : null
    }
    try {
      const branch = await q('rev-parse', '--abbrev-ref', 'HEAD')
      if (branch === null) return null
      const head = await q('rev-parse', 'HEAD')
      const status = (await q('status', '--porcelain=v1', '--untracked-files=normal')) ?? ''
      const remote = await q('remote', 'get-url', 'origin')
      const counts = await q('rev-list', '--left-right', '--count', 'HEAD...@{upstream}')
      const [ahead, behind] = counts
        ? counts.split(/\s+/).map((n) => Number(n))
        : [undefined, undefined]
      return {
        kind: 'gitState',
        app: 'git',
        title: `${repoPath.split('/').pop()} @ ${branch}`,
        repoPath,
        branch,
        head: head && /^[a-f0-9]{40,64}$/.test(head) ? head : undefined,
        dirtyFiles: status ? status.split('\n').filter(Boolean).length : 0,
        ahead: Number.isFinite(ahead) ? ahead : undefined,
        behind: Number.isFinite(behind) ? behind : undefined,
        remoteUrl: remote ? stripCredentials(remote) : undefined,
      }
    } catch {
      return null
    }
  }
}

export function stripCredentials(remote: string): string {
  return remote.replace(/^(https?:\/\/)[^@/]+@/, '$1')
}
