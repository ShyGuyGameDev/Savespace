import { existsSync } from 'node:fs'
import type { ResourceRef, RestoreItemResult } from '@shared/schemas'
import { SafeExecError } from '../safe-exec'
import { describeGeneric, restoreGeneric } from './generic'
import type { AppAdapter, CaptureContext } from './types'
import { basename, errorReason, result } from './util'

const noteAuto = (ctx: CaptureContext, bundle: string, e: unknown) => {
  if (e instanceof SafeExecError && e.code === 'not-authorized')
    ctx.noteAutomation(bundle, 'denied')
}

// ---------------------------------------------------------------- Mail
export const mailAdapter: AppAdapter = {
  id: 'mail',
  displayName: 'Mail',
  bundleIds: ['com.apple.mail'],
  tier: 'deep',
  needsAutomation: true,
  notes:
    'Captures the subject + Message-ID of selected messages and of drafts (never bodies or recipients). Reopens each with a `message://<Message-ID>` link, which shows the existing message or draft. Never edits, sends or deletes.',
  handles: (ref) => ref.kind === 'draft' || ref.kind === 'message',
  async capture(ctx) {
    if (!ctx.isRunning('com.apple.mail')) return []
    try {
      const r = await ctx.exec.script<{
        selected: { id: string; subject: string }[]
        drafts: { id: string; subject: string }[]
      }>('mail.context')
      ctx.noteAutomation('com.apple.mail', 'granted')
      const focused = ctx.apps.find((a) => a.bundleId === 'com.apple.mail')?.frontmost
      const out: ResourceRef[] = [
        ...r.selected
          .filter((m) => m.id)
          .map((m, i): ResourceRef => ({
            kind: 'message',
            app: 'com.apple.mail',
            messageId: m.id,
            subject: m.subject?.slice(0, 300),
            title: m.subject?.slice(0, 300),
            focused: (focused && i === 0) || undefined,
          })),
        ...r.drafts
          .filter((m) => m.id)
          .map((m): ResourceRef => ({
            kind: 'draft',
            app: 'com.apple.mail',
            messageId: m.id,
            subject: m.subject?.slice(0, 300),
            title: m.subject?.slice(0, 300),
          })),
      ]
      return out
    } catch (e) {
      noteAuto(ctx, 'com.apple.mail', e)
      return []
    }
  },
  isRunning: (ctx) => ctx.isRunning('com.apple.mail'),
  alreadyOpen: async () => false,
  describe: (ref) =>
    ref.kind === 'draft' || ref.kind === 'message'
      ? {
          action: 'open',
          description: `Open ${ref.kind === 'draft' ? 'draft' : 'email'} “${ref.subject || ref.title || '(no subject)'}” in Mail`,
          reason: 'Opens the existing item; Mail focuses it if it is already open',
        }
      : { action: 'info', description: '' },
  async restore(refs, ctx) {
    const out: RestoreItemResult[] = []
    for (const ref of refs) {
      const t0 = Date.now()
      if (ref.kind !== 'draft' && ref.kind !== 'message') continue
      try {
        await ctx.exec.openUrl(
          `message://${encodeURIComponent(`<${ref.messageId.replace(/^<|>$/g, '')}>`)}`,
        )
        out.push(
          result(
            ref,
            'mail',
            'opened',
            ref.kind === 'draft'
              ? 'Opened the existing draft (nothing was edited or sent)'
              : undefined,
            t0,
          ),
        )
      } catch (e) {
        out.push(result(ref, 'mail', 'failed', errorReason(e), t0))
      }
    }
    return out
  },
}

// ---------------------------------------------------------------- Notes
export const notesAdapter: AppAdapter = {
  id: 'notes',
  displayName: 'Notes',
  bundleIds: ['com.apple.Notes'],
  tier: 'deep',
  needsAutomation: true,
  notes:
    'Captures the id + title of the selected note (never its text). Reopens it with Notes’ own `show` command.',
  handles: (ref) => ref.kind === 'note',
  async capture(ctx) {
    if (!ctx.isRunning('com.apple.Notes')) return []
    try {
      const r = await ctx.exec.script<{ notes: { id: string; name: string }[] }>('notes.selection')
      ctx.noteAutomation('com.apple.Notes', 'granted')
      return r.notes.map((n, i): ResourceRef => ({
        kind: 'note',
        app: 'com.apple.Notes',
        noteId: n.id,
        title: n.name?.slice(0, 300),
        focused: i === 0 || undefined,
      }))
    } catch (e) {
      noteAuto(ctx, 'com.apple.Notes', e)
      return []
    }
  },
  isRunning: (ctx) => ctx.isRunning('com.apple.Notes'),
  alreadyOpen: async () => false,
  describe: (ref) =>
    ref.kind === 'note'
      ? { action: 'open', description: `Show note “${ref.title ?? 'untitled'}”` }
      : { action: 'info', description: '' },
  async restore(refs, ctx) {
    const out: RestoreItemResult[] = []
    for (const ref of refs) {
      const t0 = Date.now()
      if (ref.kind !== 'note') continue
      try {
        if (!(await ctx.isRunning('com.apple.Notes'))) {
          await ctx.exec.launchApp('com.apple.Notes')
          await ctx.sleep(1200)
        }
        const r = await ctx.exec.script<{ status: string }>('notes.show', [ref.noteId])
        out.push(
          result(
            ref,
            'notes',
            r.status === 'opened' ? 'opened' : 'failed',
            r.status === 'opened'
              ? undefined
              : 'Note not found (deleted or moved to another account?)',
            t0,
          ),
        )
      } catch (e) {
        out.push(result(ref, 'notes', 'failed', errorReason(e), t0))
      }
    }
    return out
  },
}

// ---------------------------------------------------------------- Calendar
export const calendarAdapter: AppAdapter = {
  id: 'calendar',
  displayName: 'Calendar',
  bundleIds: ['com.apple.iCal'],
  tier: 'deep',
  needsAutomation: true,
  notes:
    'When Calendar is open, captures the titles + ids of events within ±2 hours of the checkpoint (no notes, attendees or locations). Reopens an event with Calendar’s `show` command. Google Calendar events come from the optional connector.',
  handles: (ref) => ref.kind === 'calendarEvent',
  async capture(ctx) {
    if (!ctx.isRunning('com.apple.iCal')) return []
    try {
      const r = await ctx.exec.script<{
        events: { uid: string; summary: string; start: string }[]
      }>('calendar.now', [], 8000)
      ctx.noteAutomation('com.apple.iCal', 'granted')
      return r.events.map((e): ResourceRef => ({
        kind: 'calendarEvent',
        app: 'com.apple.iCal',
        uid: e.uid,
        title: e.summary?.slice(0, 300),
        start: e.start,
      }))
    } catch (e) {
      noteAuto(ctx, 'com.apple.iCal', e)
      return []
    }
  },
  isRunning: (ctx) => ctx.isRunning('com.apple.iCal'),
  alreadyOpen: async () => false,
  describe: (ref) =>
    ref.kind === 'calendarEvent'
      ? { action: 'open', description: `Show event “${ref.title ?? ''}” in Calendar` }
      : { action: 'info', description: '' },
  async restore(refs, ctx) {
    const out: RestoreItemResult[] = []
    for (const ref of refs) {
      const t0 = Date.now()
      if (ref.kind !== 'calendarEvent') continue
      try {
        if (ref.app !== 'com.apple.iCal') {
          out.push(
            result(
              ref,
              'calendar',
              'skipped',
              'Event from Google Calendar; open it from the linked page',
              t0,
            ),
          )
          continue
        }
        if (!(await ctx.isRunning('com.apple.iCal'))) {
          await ctx.exec.launchApp('com.apple.iCal')
          await ctx.sleep(1500)
        }
        const r = await ctx.exec.script<{ status: string }>('calendar.show', [ref.uid], 10_000)
        out.push(
          result(
            ref,
            'calendar',
            r.status === 'opened' ? 'opened' : 'failed',
            r.status === 'opened' ? undefined : 'Event not found',
            t0,
          ),
        )
      } catch (e) {
        out.push(result(ref, 'calendar', 'failed', errorReason(e), t0))
      }
    }
    return out
  },
}

// ---------------------------------------------------------------- Finder
export const finderAdapter: AppAdapter = {
  id: 'finder',
  displayName: 'Finder',
  bundleIds: ['com.apple.finder'],
  tier: 'deep',
  needsAutomation: true,
  notes:
    'Captures the folders shown in open Finder windows. Reopens each with `open <folder>`; Finder focuses an existing window for the same folder.',
  handles: (ref) => ref.kind === 'folder' && ref.app === 'com.apple.finder',
  async capture(ctx) {
    try {
      const r = await ctx.exec.script<{ folders: { url: string; name: string }[] }>(
        'finder.windows',
      )
      ctx.noteAutomation('com.apple.finder', 'granted')
      const out: ResourceRef[] = []
      for (const f of r.folders) {
        if (!f.url?.startsWith('file://')) continue
        const path = decodeURIComponent(new URL(f.url).pathname).replace(/\/$/, '') || '/'
        out.push({ kind: 'folder', app: 'com.apple.finder', path, title: f.name })
      }
      return out
    } catch (e) {
      noteAuto(ctx, 'com.apple.finder', e)
      return []
    }
  },
  isRunning: async () => true,
  async alreadyOpen(ref, ctx) {
    if (ref.kind !== 'folder') return false
    const wins = await ctx.windows()
    return wins.some(
      (a) =>
        a.bundleId === 'com.apple.finder' && a.windows.some((w) => w.title === basename(ref.path)),
    )
  },
  describe: (ref) =>
    ref.kind === 'folder'
      ? { action: 'open', description: `Open folder ${basename(ref.path)} in Finder` }
      : describeGeneric(ref, 'Finder'),
  async restore(refs, ctx) {
    const out: RestoreItemResult[] = []
    for (const ref of refs) {
      const t0 = Date.now()
      if (ref.kind !== 'folder') {
        out.push(await restoreGeneric(ref, ctx, 'finder'))
        continue
      }
      try {
        if (!existsSync(ref.path)) {
          out.push(result(ref, 'finder', 'failed', 'Folder no longer exists', t0))
          continue
        }
        const already = await this.alreadyOpen(ref, ctx)
        await ctx.exec.openPath(ref.path, { bundleId: 'com.apple.finder' })
        out.push(
          result(
            ref,
            'finder',
            already ? 'already-open' : 'opened',
            already ? 'Window was already open; focused it' : undefined,
            t0,
          ),
        )
      } catch (e) {
        out.push(result(ref, 'finder', 'failed', errorReason(e), t0))
      }
    }
    return out
  },
}

// ---------------------------------------------------------------- Document apps
interface DocAppSpec {
  id: string
  displayName: string
  bundleIds: string[]
  verified?: boolean
}

/** Document-based apps: files come from each window's AXDocument (path only, never contents). */
export function createDocumentAppAdapter(spec: DocAppSpec): AppAdapter {
  return {
    id: spec.id,
    displayName: spec.displayName,
    bundleIds: spec.bundleIds,
    tier: 'deep',
    needsAutomation: false,
    notes: `Captures the file path of each open document window (Accessibility \`AXDocument\`; contents are never read). Reopens with \`open -b\`, which focuses the document if it is already open.${spec.verified ? '' : ' Untested on this Mac.'}`,
    handles: (ref) => spec.bundleIds.includes(ref.app) && ref.kind === 'file',
    capture: async () => [],
    isRunning: async (ctx) => {
      for (const b of spec.bundleIds) if (await ctx.isRunning(b)) return true
      return false
    },
    async alreadyOpen(ref, ctx) {
      if (ref.kind !== 'file') return false
      const wins = await ctx.windows()
      const url = 'file://' + encodeURI(ref.path)
      return wins.some(
        (a) =>
          a.bundleId &&
          spec.bundleIds.includes(a.bundleId) &&
          a.windows.some((w) => w.document?.replace(/\/$/, '') === url),
      )
    },
    describe: (ref) =>
      ref.kind === 'file'
        ? { action: 'open', description: `Open ${basename(ref.path)} in ${spec.displayName}` }
        : describeGeneric(ref, spec.displayName),
    async restore(refs, ctx) {
      const out: RestoreItemResult[] = []
      for (const ref of refs) {
        const t0 = Date.now()
        if (ref.kind !== 'file') {
          out.push(await restoreGeneric(ref, ctx, spec.id))
          continue
        }
        try {
          if (!existsSync(ref.path)) {
            out.push(
              result(ref, spec.id, 'failed', 'File no longer exists (moved or renamed?)', t0),
            )
            continue
          }
          const already = await this.alreadyOpen(ref, ctx)
          await ctx.exec.openPath(ref.path, { bundleId: ref.app })
          out.push(
            result(
              ref,
              spec.id,
              already ? 'already-open' : 'opened',
              already ? 'Document was already open; focused it' : undefined,
              t0,
            ),
          )
        } catch (e) {
          out.push(result(ref, spec.id, 'failed', errorReason(e), t0))
        }
      }
      return out
    },
  }
}

export const documentAppAdapters: AppAdapter[] = [
  { id: 'pages', displayName: 'Pages', bundleIds: ['com.apple.iWork.Pages'], verified: true },
  { id: 'numbers', displayName: 'Numbers', bundleIds: ['com.apple.iWork.Numbers'], verified: true },
  { id: 'keynote', displayName: 'Keynote', bundleIds: ['com.apple.iWork.Keynote'], verified: true },
  { id: 'preview', displayName: 'Preview', bundleIds: ['com.apple.Preview'], verified: true },
  { id: 'textedit', displayName: 'TextEdit', bundleIds: ['com.apple.TextEdit'], verified: true },
  { id: 'word', displayName: 'Microsoft Word', bundleIds: ['com.microsoft.Word'] },
  { id: 'excel', displayName: 'Microsoft Excel', bundleIds: ['com.microsoft.Excel'] },
  {
    id: 'powerpoint',
    displayName: 'Microsoft PowerPoint',
    bundleIds: ['com.microsoft.Powerpoint'],
  },
  { id: 'sketch', displayName: 'Sketch', bundleIds: ['com.bohemiancoding.sketch3'] },
  {
    id: 'acrobat',
    displayName: 'Adobe Acrobat',
    bundleIds: ['com.adobe.Acrobat.Pro', 'com.adobe.Reader'],
  },
].map(createDocumentAppAdapter)
