import type { ResourceRef } from '@shared/schemas'

/**
 * Signals are short typed strings that describe "what this is about":
 *   repo:/abs/root   path:/abs/dir   host:example.com   token:word   cal:event title
 * Projects own a set of signals; activity produces signals; matching is prefix-aware.
 */

const STOP = new Set(
  'the a an and or of to in on for with from by at is it this that new tab untitled window document file edit view home inbox draft drafts mail google chrome safari finder terminal code visual studio cursor slack discord notion figma github gitlab jira linear docs sheets slides drive calendar preview pages numbers keynote png jpg pdf md ts tsx js json html css txt index main readme src app lib'.split(
    ' ',
  ),
)

const GENERIC_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'mail.google.com',
  'calendar.google.com',
  'docs.google.com',
  'drive.google.com',
  'github.com',
  'gitlab.com',
  'app.slack.com',
  'www.notion.so',
  'notion.so',
  'www.figma.com',
  'linear.app',
  'teams.microsoft.com',
  'discord.com',
  'localhost',
  'www.youtube.com',
  'youtube.com',
])

export function titleTokens(title: string | null | undefined): string[] {
  if (!title) return []
  return [
    ...new Set(
      title
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && w.length <= 30 && !STOP.has(w) && !/^\d+$/.test(w)),
    ),
  ].slice(0, 8)
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i > 0 ? p.slice(0, i) : p
}

/** Signals that a resource contributes; `repoRootOf` lets callers map paths to git roots. */
export function signalsForRef(
  r: ResourceRef,
  repoRootOf: (p: string) => string | null = () => null,
): string[] {
  const out: string[] = []
  const addPath = (p: string) => {
    const root = repoRootOf(p)
    if (root) out.push(`repo:${root}`)
    else out.push(`path:${p}`)
  }
  switch (r.kind) {
    case 'gitState':
      out.push(`repo:${r.repoPath}`)
      break
    case 'workspace':
    case 'folder':
    case 'terminalCwd':
      addPath(r.path)
      break
    case 'file':
      addPath(dirOf(r.path))
      break
    case 'url':
    case 'doc': {
      try {
        const u = new URL(r.url)
        if (u.protocol.startsWith('http')) {
          out.push(`url:${u.href.replace(/#.*$/, '').replace(/\/$/, '')}`)
          const host = u.hostname.replace(/^www\./, '')
          if (!GENERIC_HOSTS.has(u.hostname) && !GENERIC_HOSTS.has(host)) out.push(`host:${host}`)
          // Repo-ish paths on code hosts identify a project precisely.
          if (/^(github\.com|gitlab\.com)$/.test(host)) {
            const [owner, repo] = u.pathname.split('/').filter(Boolean)
            if (owner && repo) out.push(`token:${repo.toLowerCase()}`)
          }
        }
      } catch {
        /* ignore */
      }
      break
    }
    case 'calendarEvent':
      if (r.title) out.push(`cal:${r.title.toLowerCase()}`)
      break
    default:
      break
  }
  for (const t of titleTokens(r.title)) out.push(`token:${t}`)
  return [...new Set(out)]
}

/** Does an observed signal fall under a project's signal? (prefix-aware for paths) */
export function signalMatches(projectSignal: string, observed: string): boolean {
  if (projectSignal === observed) return true
  const [pk, pv = ''] = splitSignal(projectSignal)
  const [ok, ov = ''] = splitSignal(observed)
  if ((pk === 'repo' || pk === 'path') && (ok === 'repo' || ok === 'path')) {
    return ov === pv || ov.startsWith(pv.endsWith('/') ? pv : pv + '/')
  }
  if (pk === 'url' && ok === 'url') return ov.startsWith(pv + '/') || ov.startsWith(pv + '?')
  if (pk === 'host' && ok === 'host') return ov === pv || ov.endsWith('.' + pv)
  return false
}

export function splitSignal(s: string): [string, string] {
  const i = s.indexOf(':')
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]
}

/** Weight of a signal kind when scoring project matches. */
export function signalWeight(s: string): number {
  const k = splitSignal(s)[0]
  return k === 'url'
    ? 8
    : k === 'repo'
      ? 5
      : k === 'path'
        ? 3
        : k === 'host'
          ? 2
          : k === 'cal'
            ? 2
            : k === 'app'
              ? 1
              : 1
}
