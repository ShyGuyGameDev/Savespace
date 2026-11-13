import { z } from 'zod'
import type { Checkpoint } from '@shared/schemas'
import { guardedFetch } from '../net'

export function githubTargets(checkpoint: Checkpoint) {
  const targets = new Map<string, { url: string; endpoint: string; label: string }>()
  for (const ref of checkpoint.resources) {
    if (ref.kind !== 'url' && ref.kind !== 'doc') continue
    const match =
      /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/([1-9]\d{0,14})(?:[/?#]|$)/i.exec(
        ref.url,
      )
    if (!match) continue
    const [, owner, repo, kind, number] = match
    if ([owner, repo].some((segment) => segment === '.' || segment === '..')) continue
    const url = `https://github.com/${owner}/${repo}/${kind}/${number}`
    const endpoint = `/repos/${owner}/${repo}/${kind === 'pull' ? 'pulls' : 'issues'}/${number}`
    targets.set(url.toLowerCase(), { url, endpoint, label: `${owner}/${repo} #${number}` })
  }
  return [...targets.values()].slice(0, 5)
}

const itemSchema = z.object({
  title: z.string(),
  state: z.enum(['open', 'closed']),
  updated_at: z.iso.datetime(),
  draft: z.boolean().optional(),
  merged: z.boolean().optional(),
  head: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }).optional(),
})

export async function githubProgress(checkpoint: Checkpoint) {
  return Promise.all(
    githubTargets(checkpoint).map(async ({ url, endpoint, label }) => {
      try {
        const response = await guardedFetch(`https://api.github.com${endpoint}`, {
          headers: { Accept: 'application/vnd.github+json' },
          timeoutMs: 8000,
        })
        if (!response.ok) throw new Error('GitHub data unavailable')
        const item = itemSchema.parse(await response.json())
        return {
          url,
          title: item.title.slice(0, 500),
          state: item.merged
            ? 'Merged'
            : item.state === 'closed'
              ? 'Closed'
              : item.draft
                ? 'Draft'
                : 'Open',
          updatedAt: item.updated_at,
          commit: item.head?.sha,
        }
      } catch {
        return { url, title: label, state: 'Unavailable' }
      }
    }),
  )
}

const timelineSchema = z.array(
  z.object({
    event: z.string(),
    id: z.number().int().positive().optional(),
    created_at: z.iso.datetime().optional(),
    submitted_at: z.iso.datetime().optional(),
    actor: z.object({ login: z.string() }).nullish(),
    user: z.object({ login: z.string() }).nullish(),
    assignee: z.object({ login: z.string() }).nullish(),
    body: z.string().nullish(),
    state: z.string().optional(),
  }),
)

export async function githubUpdates(checkpoint: Checkpoint) {
  const groups = await Promise.all(
    githubTargets(checkpoint).map(async (target) => {
      try {
        const endpoint = target.endpoint.replace('/pulls/', '/issues/')
        const response = await guardedFetch(
          `https://api.github.com${endpoint}/timeline?per_page=100`,
          {
            headers: { Accept: 'application/vnd.github+json' },
            timeoutMs: 8000,
          },
        )
        if (!response.ok) throw new Error('Timeline unavailable')
        const updates = timelineSchema.parse(await response.json()).flatMap((entry) => {
          const at = entry.submitted_at ?? entry.created_at
          if (!at || Date.parse(at) <= checkpoint.createdAt) return []
          const who = entry.actor?.login ?? entry.user?.login ?? 'A collaborator'
          const kind = entry.event
          const descriptions: Record<string, string> = {
            commented: `${who} commented`,
            reviewed:
              entry.state === 'changes_requested'
                ? `${who} requested changes`
                : `${who} reviewed the PR`,
            assigned: `Assigned to ${entry.assignee?.login ?? 'a collaborator'}`,
            unassigned: `Unassigned ${entry.assignee?.login ?? 'a collaborator'}`,
            merged: `${who} merged the PR`,
            closed: `${who} closed this item`,
            reopened: `${who} reopened this item`,
            ready_for_review: 'PR marked ready for review',
            head_ref_force_pushed: 'PR branch was force-pushed',
          }
          if (!Object.hasOwn(descriptions, kind)) return []
          const anchor =
            kind === 'commented'
              ? 'issuecomment-'
              : kind === 'reviewed'
                ? 'pullrequestreview-'
                : 'event-'
          return [
            {
              url: entry.id ? `${target.url}#${anchor}${entry.id}` : target.url,
              source: target.label,
              at,
              description: descriptions[kind]!,
              excerpt: entry.body?.trim().replace(/\s+/g, ' ').slice(0, 200) || undefined,
              priority: kind === 'commented' ? 0 : 1,
            },
          ]
        })
        return {
          updates,
          incomplete: response.headers.get('link')?.includes('rel="next"') ?? false,
        }
      } catch {
        return { updates: [], incomplete: true }
      }
    }),
  )
  return {
    updates: groups
      .flatMap((group) => group.updates)
      .sort((a, b) => b.priority - a.priority || Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 5),
    incomplete: groups.some((group) => group.incomplete),
  }
}
