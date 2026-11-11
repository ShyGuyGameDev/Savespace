import type { ResourceRef, RestoreStatus } from '@shared/schemas'

const APP_NAMES: Record<string, string> = {
  'com.microsoft.VSCode': 'VS Code',
  'com.microsoft.VSCodeInsiders': 'VS Code Insiders',
  'com.todesktop.230313mzl4w4u92': 'Cursor',
  'com.exafunction.windsurf': 'Windsurf',
  'dev.zed.Zed': 'Zed',
  'com.apple.dt.Xcode': 'Xcode',
  'com.google.Chrome': 'Chrome',
  'com.brave.Browser': 'Brave',
  'com.microsoft.edgemac': 'Edge',
  'company.thebrowser.Browser': 'Arc',
  'com.apple.Safari': 'Safari',
  'org.mozilla.firefox': 'Firefox',
  'com.apple.mail': 'Mail',
  'com.apple.Notes': 'Notes',
  'com.apple.iCal': 'Calendar',
  'com.apple.finder': 'Finder',
  'com.apple.Terminal': 'Terminal',
  'com.googlecode.iterm2': 'iTerm2',
  'dev.warp.Warp-Stable': 'Warp',
  'com.tinyspeck.slackmacgap': 'Slack',
  'com.hnc.Discord': 'Discord',
  'com.apple.Preview': 'Preview',
  'com.apple.TextEdit': 'TextEdit',
  'com.apple.iWork.Pages': 'Pages',
  'com.apple.iWork.Numbers': 'Numbers',
  'com.apple.iWork.Keynote': 'Keynote',
  'md.obsidian': 'Obsidian',
  git: 'Git',
}

export function appName(bundleId: string, fallback?: string): string {
  return APP_NAMES[bundleId] ?? fallback ?? bundleId.split('.').pop() ?? bundleId
}

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')
const base = (p: string) => p.replace(/\/$/, '').split('/').pop() ?? p

export function refLabel(r: ResourceRef): { primary: string; secondary?: string } {
  switch (r.kind) {
    case 'app':
      return { primary: r.title ?? appName(r.app) }
    case 'file':
      return {
        primary: base(r.path),
        secondary: `${home(r.path)}${r.line ? `:${r.line}${r.column ? `:${r.column}` : ''}` : ''}`,
      }
    case 'folder':
    case 'workspace':
    case 'terminalCwd':
      return { primary: base(r.path) || '/', secondary: home(r.path) }
    case 'url':
    case 'doc':
      try {
        const u = new URL(r.url)
        return {
          primary: r.title || u.hostname,
          secondary: u.hostname.replace(/^www\./, '') + u.pathname.slice(0, 60),
        }
      } catch {
        return { primary: r.title ?? r.url }
      }
    case 'deepLink':
      return { primary: r.title ?? r.url, secondary: r.url.split('?')[0] }
    case 'draft':
      return { primary: r.subject || r.title || '(no subject)', secondary: 'Draft' }
    case 'message':
      return { primary: r.subject || r.title || '(no subject)', secondary: 'Email' }
    case 'note':
      return { primary: r.title ?? 'Note' }
    case 'calendarEvent':
      return {
        primary: r.title ?? 'Event',
        secondary: r.start
          ? new Date(r.start).toLocaleString(undefined, {
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })
          : undefined,
      }
    case 'gitState':
      return {
        primary: `${base(r.repoPath)} · ${r.branch}`,
        secondary: `${r.dirtyFiles} uncommitted${r.ahead ? ` · ${r.ahead} ahead` : ''}${r.behind ? ` · ${r.behind} behind` : ''}`,
      }
    case 'windowFrame':
      return {
        primary: r.windowTitle,
        secondary: `${r.frame.w}×${r.frame.h} at ${r.frame.x},${r.frame.y}`,
      }
  }
}

export const KIND_LABEL: Record<ResourceRef['kind'], string> = {
  app: 'App',
  file: 'File',
  folder: 'Folder',
  workspace: 'Workspace',
  url: 'Web page',
  doc: 'Document',
  deepLink: 'Link',
  draft: 'Draft',
  message: 'Email',
  note: 'Note',
  calendarEvent: 'Event',
  terminalCwd: 'Terminal',
  gitState: 'Git',
  windowFrame: 'Window',
}

export function groupByApp<T extends { ref: ResourceRef }>(items: T[]): [string, T[]][] {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const key = it.ref.kind === 'windowFrame' ? '__frames' : it.ref.app
    m.set(key, [...(m.get(key) ?? []), it])
  }
  return [...m.entries()]
}

export const STATUS_META: Record<
  RestoreStatus,
  { label: string; tone: 'success' | 'neutral' | 'warning' | 'danger' | 'accent' }
> = {
  opened: { label: 'Opened', tone: 'success' },
  'already-open': { label: 'Already open', tone: 'accent' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
}
