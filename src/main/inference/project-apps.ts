import type { ProjectApp, ProjectItem, ResourceRef } from '@shared/schemas'

/** Signals a project's chosen apps contribute: the app itself, plus each pinned item. */
export function signalsFromApps(apps: ProjectApp[]): string[] {
  const out: string[] = []
  for (const a of apps) {
    out.push(`app:${a.bundleId}`)
    for (const it of a.items) {
      if (it.kind === 'url') {
        try {
          out.push(`host:${new URL(it.url).hostname.replace(/^www\./, '')}`)
        } catch {
          /* ignore */
        }
      } else if (it.kind === 'folder') out.push(`path:${it.path.replace(/\/$/, '')}`)
      else out.push(`path:${it.path.split('/').slice(0, -1).join('/')}`)
    }
  }
  return [...new Set(out)]
}

const normUrl = (u: string) => u.replace(/#.*$/, '').replace(/\/$/, '')

/** Does a captured item match something pinned to its app in the project? */
export function matchesPinned(ref: ResourceRef, items: ProjectItem[]): boolean {
  for (const it of items) {
    if (it.kind === 'url' && (ref.kind === 'url' || ref.kind === 'doc')) {
      const a = normUrl(ref.url)
      const b = normUrl(it.url)
      if (a === b || a.startsWith(b + '/') || a.startsWith(b + '?')) return true
    }
    if (
      (it.kind === 'folder' || it.kind === 'file') &&
      'path' in ref &&
      typeof ref.path === 'string'
    ) {
      const p = ref.path.replace(/\/$/, '')
      const q = it.path.replace(/\/$/, '')
      if (p === q || (it.kind === 'folder' && p.startsWith(q + '/'))) return true
    }
  }
  return false
}

/** Turns a project's pinned items into things the restore engine can open. */
export function refsFromApps(
  apps: ProjectApp[],
  kindForFolder: (bundleId: string) => 'workspace' | 'folder' | 'terminalCwd',
): ResourceRef[] {
  const out: ResourceRef[] = []
  for (const a of apps) {
    out.push({ kind: 'app', app: a.bundleId, title: a.name })
    for (const it of a.items) {
      if (it.kind === 'url')
        out.push({ kind: 'url', app: a.bundleId, url: it.url, title: it.title })
      else if (it.kind === 'file')
        out.push({ kind: 'file', app: a.bundleId, path: it.path, title: it.path.split('/').pop() })
      else
        out.push({
          kind: kindForFolder(a.bundleId),
          app: a.bundleId,
          path: it.path,
          title: it.path.split('/').pop(),
        })
    }
  }
  return out
}
