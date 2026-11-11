import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ResourceRef, RestoreItemResult } from '@shared/schemas'
import { describeGeneric, restoreGeneric } from './generic'
import type { AppAdapter, CaptureContext } from './types'
import { errorReason, result } from './util'

interface DesktopSpec {
  id: string
  displayName: string
  bundleIds: string[]
  tier: 'deep' | 'partial' | 'launch-only'
  notes: string
  capture?: (ctx: CaptureContext) => Promise<ResourceRef[]>
  /** Extra ref kinds this adapter restores (deep links). */
  handlesDeepLink?: (url: string) => boolean
}

/** Apps restored by launching/focusing and, where documented, via their own URL scheme. */
export function createDesktopAdapter(spec: DesktopSpec): AppAdapter {
  const bundle = spec.bundleIds[0]!
  return {
    id: spec.id,
    displayName: spec.displayName,
    bundleIds: spec.bundleIds,
    tier: spec.tier,
    needsAutomation: false,
    notes: spec.notes,
    handles: (ref) => ref.kind === 'deepLink' && !!spec.handlesDeepLink?.(ref.url),
    capture: async (ctx) =>
      spec.capture && spec.bundleIds.some((b) => ctx.isRunning(b))
        ? spec.capture(ctx).catch(() => [])
        : [],
    isRunning: (ctx) => ctx.isRunning(bundle),
    alreadyOpen: async (ref, ctx) => ref.kind === 'app' && (await ctx.isRunning(ref.app)),
    describe: (ref) =>
      ref.kind === 'deepLink'
        ? { action: 'open', description: `Open ${ref.title ?? 'item'} in ${spec.displayName}` }
        : describeGeneric(ref, spec.displayName),
    async restore(refs, ctx) {
      const out: RestoreItemResult[] = []
      for (const ref of refs) {
        const t0 = Date.now()
        try {
          if (ref.kind === 'deepLink') {
            await ctx.exec.openUrl(ref.url)
            out.push(result(ref, spec.id, 'opened', undefined, t0))
          } else out.push(await restoreGeneric(ref, ctx, spec.id))
        } catch (e) {
          out.push(result(ref, spec.id, 'failed', errorReason(e), t0))
        }
      }
      return out
    },
  }
}

/** Slack keeps the selected workspace in root-state.json (read-only; only ids and names are used). */
async function captureSlack(ctx: CaptureContext): Promise<ResourceRef[]> {
  const p = join(ctx.homeDir, 'Library/Application Support/Slack/storage/root-state.json')
  if (!existsSync(p)) return []
  const s = JSON.parse(readFileSync(p, 'utf8')) as {
    workspacesMeta?: { selectedWorkspaceId?: string }
    workspaces?: Record<string, { name?: string }>
  }
  const team = s.workspacesMeta?.selectedWorkspaceId
  if (!team || !/^[TE][A-Z0-9]+$/.test(team)) return []
  const win = ctx.apps.find((a) => a.bundleId === 'com.tinyspeck.slackmacgap')?.windows[0]?.title
  const name = s.workspaces?.[team]?.name ?? 'Slack'
  return [
    {
      kind: 'deepLink',
      app: 'com.tinyspeck.slackmacgap',
      url: `slack://open?team=${team}`,
      title: win ? `${name}: ${win.replace(/ - Slack$/, '')}` : name,
    },
  ]
}

/** Obsidian window titles are "Note - Vault - Obsidian vX". */
async function captureObsidian(ctx: CaptureContext): Promise<ResourceRef[]> {
  const app = ctx.apps.find((a) => a.bundleId === 'md.obsidian')
  const out: ResourceRef[] = []
  for (const w of app?.windows ?? []) {
    const m = /^(.+?) - (.+?) - Obsidian/.exec(w.title ?? '')
    if (!m) continue
    const [, note, vault] = m
    out.push({
      kind: 'deepLink',
      app: 'md.obsidian',
      url: `obsidian://open?vault=${encodeURIComponent(vault!)}&file=${encodeURIComponent(note!)}`,
      title: `${note} (${vault})`,
      focused: app?.frontmost || undefined,
    })
  }
  return out
}

export const slackAdapter = createDesktopAdapter({
  id: 'slack',
  displayName: 'Slack',
  bundleIds: ['com.tinyspeck.slackmacgap'],
  tier: 'partial',
  notes:
    'Desktop app: reopens the workspace you had selected (`slack://open?team=…`, read from Slack’s root-state.json) and shows the window title for context. Exact channels/threads are restored when they were open in a browser (app.slack.com links).',
  capture: captureSlack,
  handlesDeepLink: (u) => u.startsWith('slack://'),
})
export const discordAdapter = createDesktopAdapter({
  id: 'discord',
  displayName: 'Discord',
  bundleIds: ['com.hnc.Discord'],
  tier: 'launch-only',
  notes:
    'Launches/focuses Discord. Channel links (discord.com/channels/…) captured from a browser reopen exactly. The desktop app exposes no scripting or documented deep links.',
  handlesDeepLink: (u) => u.startsWith('discord://'),
})
export const teamsAdapter = createDesktopAdapter({
  id: 'teams',
  displayName: 'Microsoft Teams',
  bundleIds: ['com.microsoft.teams2', 'com.microsoft.teams'],
  tier: 'partial',
  notes:
    'Launches/focuses Teams. teams.microsoft.com/l/… links captured from a browser reopen exactly (msteams: links open the desktop client). Untested on this Mac.',
  handlesDeepLink: (u) => u.startsWith('msteams:'),
})
export const notionAdapter = createDesktopAdapter({
  id: 'notion',
  displayName: 'Notion',
  bundleIds: ['notion.id'],
  tier: 'partial',
  notes:
    'Launches/focuses Notion; notion.so page links from a browser reopen exactly. Untested on this Mac.',
  handlesDeepLink: (u) => u.startsWith('notion://'),
})
export const figmaAdapter = createDesktopAdapter({
  id: 'figma',
  displayName: 'Figma',
  bundleIds: ['com.figma.Desktop'],
  tier: 'partial',
  notes:
    'Launches/focuses Figma; figma.com file + node-id links from a browser reopen exactly (the desktop app claims them if configured). Untested on this Mac.',
  handlesDeepLink: (u) => u.startsWith('figma://'),
})
export const linearAdapter = createDesktopAdapter({
  id: 'linear',
  displayName: 'Linear',
  bundleIds: ['com.linear'],
  tier: 'partial',
  notes: 'Launches/focuses Linear; linear.app issue links reopen exactly. Untested on this Mac.',
  handlesDeepLink: (u) => u.startsWith('linear://'),
})
export const obsidianAdapter = createDesktopAdapter({
  id: 'obsidian',
  displayName: 'Obsidian',
  bundleIds: ['md.obsidian'],
  tier: 'deep',
  notes:
    'Reads note and vault names from the window title; reopens with `obsidian://open?vault=…&file=…`. Untested on this Mac.',
  capture: captureObsidian,
  handlesDeepLink: (u) => u.startsWith('obsidian://'),
})
export const bearAdapter = createDesktopAdapter({
  id: 'bear',
  displayName: 'Bear',
  bundleIds: ['net.shinyfrog.bear'],
  tier: 'launch-only',
  notes:
    'Launches/focuses Bear. Note ids are not exposed without Bear’s x-callback tokens, so notes are shown by window title only. Untested.',
  handlesDeepLink: (u) => u.startsWith('bear://'),
})
export const outlookAdapter = createDesktopAdapter({
  id: 'outlook',
  displayName: 'Microsoft Outlook',
  bundleIds: ['com.microsoft.Outlook'],
  tier: 'launch-only',
  notes:
    'Launches/focuses Outlook. New Outlook has no scripting dictionary and no documented per-message links; Outlook web links from a browser reopen exactly.',
})
