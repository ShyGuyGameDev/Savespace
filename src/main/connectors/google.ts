import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ConnectorStatus, ResourceRef } from '@shared/schemas'
import type { AsyncKeyProvider } from '../db/client'
import { guardedFetch } from '../net'
import { authorize, refresh, type OAuthClient, type StoredToken } from './oauth'

export type ConnectorId = 'gmail' | 'drive' | 'calendar'

export const CONNECTORS: Record<
  ConnectorId,
  { displayName: string; scope: string; unlocks: string }
> = {
  gmail: {
    displayName: 'Gmail',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    unlocks: 'Lists your recent Gmail drafts (subject + id only) so checkpoints can reopen them.',
  },
  drive: {
    displayName: 'Google Drive',
    scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
    unlocks: 'Looks up file names for Google Docs/Sheets/Slides links (no file contents).',
  },
  calendar: {
    displayName: 'Google Calendar',
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    unlocks: 'Titles of events happening around a checkpoint, with a link to open them.',
  },
}

const DraftsSchema = z.object({
  drafts: z
    .array(
      z.object({
        id: z.string(),
        message: z.object({ id: z.string(), threadId: z.string().optional() }),
      }),
    )
    .optional(),
})
const DraftSchema = z.object({
  id: z.string(),
  message: z.object({
    id: z.string(),
    internalDate: z.string().optional(),
    payload: z
      .object({ headers: z.array(z.object({ name: z.string(), value: z.string() })).optional() })
      .optional(),
  }),
})
const EventsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        summary: z.string().optional(),
        htmlLink: z.string().optional(),
        start: z
          .object({ dateTime: z.string().optional(), date: z.string().optional() })
          .optional(),
      }),
    )
    .optional(),
})
const DriveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
})

/** Read-only Google connectors. All opt-in; Savespace works fully without them. */
export class GoogleConnectors {
  constructor(
    private readonly dataDir: string,
    private readonly keys: AsyncKeyProvider,
    private readonly client: () => OAuthClient | null,
    private readonly openBrowser: (url: string) => Promise<void>,
    private readonly enabled: (id: ConnectorId) => boolean,
  ) {}

  private tokenPath(id: ConnectorId): string {
    return join(this.dataDir, 'connectors', `${id}.token.enc`)
  }

  private async load(id: ConnectorId): Promise<StoredToken | null> {
    const p = this.tokenPath(id)
    if (!existsSync(p)) return null
    const { result } = await this.keys.decrypt(readFileSync(p))
    return JSON.parse(result) as StoredToken
  }

  private async save(id: ConnectorId, t: StoredToken): Promise<void> {
    mkdirSync(join(this.dataDir, 'connectors'), { recursive: true, mode: 0o700 })
    writeFileSync(this.tokenPath(id), await this.keys.encrypt(JSON.stringify(t)), { mode: 0o600 })
  }

  async status(): Promise<ConnectorStatus[]> {
    const c = this.client()
    return (Object.keys(CONNECTORS) as ConnectorId[]).map((id) => ({
      id,
      displayName: CONNECTORS[id].displayName,
      scope: CONNECTORS[id].scope.replace('https://www.googleapis.com/auth/', ''),
      configured: !!c,
      connected: existsSync(this.tokenPath(id)),
      enabled: this.enabled(id),
      missing: c ? undefined : 'Needs SAVESPACE_GOOGLE_CLIENT_ID (see MISSING_CREDENTIALS.md)',
    }))
  }

  async connect(id: ConnectorId): Promise<void> {
    const c = this.client()
    if (!c)
      throw new Error(
        'Google sign-in isn’t set up yet. Add SAVESPACE_GOOGLE_CLIENT_ID (see MISSING_CREDENTIALS.md).',
      )
    await this.save(id, await authorize(c, CONNECTORS[id].scope, this.openBrowser))
  }

  disconnect(id: ConnectorId): void {
    rmSync(this.tokenPath(id), { force: true })
  }

  private async token(id: ConnectorId): Promise<string | null> {
    const c = this.client()
    let t = await this.load(id).catch(() => null)
    if (!t || !c || !this.enabled(id)) return null
    if (Date.now() > t.expiresAt) {
      t = await refresh(c, t)
      await this.save(id, t)
    }
    return t.accessToken
  }

  private async get<T>(id: ConnectorId, url: string, schema: z.ZodType<T>): Promise<T | null> {
    const tok = await this.token(id)
    if (!tok) return null
    const res = await guardedFetch(url, {
      headers: { authorization: `Bearer ${tok}` },
      timeoutMs: 8000,
    })
    if (!res.ok) return null
    return schema.parse(await res.json())
  }

  /** Gmail drafts updated in the last day → reopenable Gmail links (subject + id only). */
  async gmailDrafts(): Promise<ResourceRef[]> {
    const list = await this.get(
      'gmail',
      'https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=10',
      DraftsSchema,
    )
    const out: ResourceRef[] = []
    for (const d of list?.drafts ?? []) {
      const full = await this.get(
        'gmail',
        `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(d.id)}?format=metadata&metadataHeaders=Subject`,
        DraftSchema,
      )
      if (!full) continue
      if (full.message.internalDate && Date.now() - Number(full.message.internalDate) > 86_400_000)
        continue
      const subject =
        full.message.payload?.headers?.find((h) => h.name.toLowerCase() === 'subject')?.value ??
        '(no subject)'
      out.push({
        kind: 'url',
        app: 'web',
        url: `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(full.message.id)}`,
        title: `Draft: ${subject}`.slice(0, 300),
      })
    }
    return out
  }

  /** Google Calendar events overlapping now ± 2 h → links that open the event. */
  async calendarNow(): Promise<ResourceRef[]> {
    const now = Date.now()
    const q = new URLSearchParams({
      timeMin: new Date(now - 7_200_000).toISOString(),
      timeMax: new Date(now + 7_200_000).toISOString(),
      singleEvents: 'true',
      maxResults: '10',
      orderBy: 'startTime',
    })
    const r = await this.get(
      'calendar',
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`,
      EventsSchema,
    )
    return (r?.items ?? [])
      .filter((e) => e.htmlLink?.startsWith('https://'))
      .map((e): ResourceRef => ({
        kind: 'url',
        app: 'web',
        url: e.htmlLink!,
        title: `Event: ${e.summary ?? 'untitled'}`.slice(0, 300),
      }))
  }

  /** Fills in missing titles for Google Docs/Sheets/Slides/Drive links (metadata only). */
  async enrichDriveTitles(refs: ResourceRef[]): Promise<ResourceRef[]> {
    if (!(await this.token('drive'))) return refs
    const out: ResourceRef[] = []
    for (const r of refs) {
      const id =
        r.kind === 'url'
          ? /\/(?:document|spreadsheets|presentation|file)\/d\/([\w-]{20,})/.exec(r.url)?.[1]
          : undefined
      if (id && (!r.title || /^https?:/.test(r.title))) {
        const f = await this.get(
          'drive',
          `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType`,
          DriveFileSchema,
        ).catch(() => null)
        out.push(f ? { ...r, title: f.name } : r)
      } else out.push(r)
    }
    return out
  }
}
