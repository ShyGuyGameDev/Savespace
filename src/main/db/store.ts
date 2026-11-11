import { and, asc, count, desc, eq, inArray, isNull, lt, min, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_SETTINGS,
  HARD_EXCLUDED_BUNDLE_IDS,
  HARD_EXCLUDED_URL_HOSTS,
  type Settings,
} from '@shared/constants'
import {
  ResourceRefSchema,
  type AuditEntry,
  type Checkpoint,
  type CheckpointTrigger,
  type ExclusionRule,
  type Project,
  type ResourceRef,
  type Suggestion,
  type SummarySource,
} from '@shared/schemas'
import type { Db } from './client'
import * as t from './schema'

const PROJECT_COLORS = [
  '#4b86ff',
  '#22a06b',
  '#e5793b',
  '#a35ce8',
  '#d9488b',
  '#1aa0b5',
  '#c99a16',
  '#6a7bd8',
]

export type AuditAction = AuditEntry['action']

export interface ActivityEventInput {
  at: number
  bundleId: string
  appName: string
  windowTitle?: string | null
  signals: string[]
  ref?: ResourceRef | null
  projectId?: string | null
}

/** All persistence goes through this class. Every write that matters is also audit-logged. */
export class Store {
  constructor(public readonly db: Db) {}

  // ---------- settings ----------
  getSettings(): Settings {
    const rows = this.db.select().from(t.settings).all()
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value
    return out as Settings
  }

  setSettings(patch: Partial<Settings>): Settings {
    this.db.transaction((tx) => {
      for (const [key, value] of Object.entries(patch)) {
        if (!(key in DEFAULT_SETTINGS) || value === undefined) continue
        tx.insert(t.settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: t.settings.key, set: { value } })
          .run()
      }
    })
    this.audit('settings', `Changed settings: ${Object.keys(patch).join(', ')}`, patch)
    return this.getSettings()
  }

  // ---------- audit ----------
  audit(action: AuditAction, detail: string, data?: unknown): void {
    this.db
      .insert(t.auditLog)
      .values({ at: Date.now(), action, detail, data: data ?? null })
      .run()
  }

  listAudit(limit = 200): AuditEntry[] {
    return this.db
      .select()
      .from(t.auditLog)
      .orderBy(desc(t.auditLog.id))
      .limit(limit)
      .all()
      .map((r) => ({
        id: r.id,
        at: r.at,
        action: r.action as AuditAction,
        detail: r.detail,
        data: r.data ?? undefined,
      }))
  }

  // ---------- projects ----------
  private toProject(r: typeof t.projects.$inferSelect): Project {
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      signals: r.signals,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      lastCheckpointAt: r.lastCheckpointAt ?? null,
      archived: r.archived,
    }
  }

  listProjects(includeArchived = false): Project[] {
    const q = this.db.select().from(t.projects)
    const rows = includeArchived ? q.all() : q.where(eq(t.projects.archived, false)).all()
    return rows
      .map((r) => this.toProject(r))
      .sort((a, b) => (b.lastCheckpointAt ?? b.createdAt) - (a.lastCheckpointAt ?? a.createdAt))
  }

  getProject(id: string): Project | null {
    const r = this.db.select().from(t.projects).where(eq(t.projects.id, id)).get()
    return r ? this.toProject(r) : null
  }

  createProject(name: string, signals: string[] = []): Project {
    const n = this.db.select({ c: count() }).from(t.projects).get()?.c ?? 0
    const id = randomUUID()
    const ts = Date.now()
    this.db
      .insert(t.projects)
      .values({
        id,
        name: name.trim(),
        color: PROJECT_COLORS[n % PROJECT_COLORS.length]!,
        signals: [...new Set(signals)],
        createdAt: ts,
        updatedAt: ts,
      })
      .run()
    return this.getProject(id)!
  }

  renameProject(id: string, name: string): Project {
    this.db
      .update(t.projects)
      .set({ name: name.trim(), updatedAt: Date.now() })
      .where(eq(t.projects.id, id))
      .run()
    const p = this.getProject(id)
    if (!p) throw new Error('Project not found')
    return p
  }

  setProjectSignals(id: string, signals: string[]): void {
    this.db
      .update(t.projects)
      .set({ signals: [...new Set(signals)], updatedAt: Date.now() })
      .where(eq(t.projects.id, id))
      .run()
  }

  archiveProject(id: string, archived: boolean): void {
    this.db
      .update(t.projects)
      .set({ archived, updatedAt: Date.now() })
      .where(eq(t.projects.id, id))
      .run()
  }

  /** Edits a project's name, colour and/or what belongs to it (its signals). */
  updateProject(id: string, patch: { name?: string; color?: string; signals?: string[] }): Project {
    const cur = this.getProject(id)
    if (!cur) throw new Error('Project not found')
    this.db
      .update(t.projects)
      .set({
        name: patch.name?.trim() || cur.name,
        color: patch.color ?? cur.color,
        signals: patch.signals
          ? [...new Set(patch.signals.map((x) => x.trim()).filter(Boolean))]
          : cur.signals,
        updatedAt: Date.now(),
      })
      .where(eq(t.projects.id, id))
      .run()
    this.audit('settings', `Edited project “${patch.name?.trim() || cur.name}”`, {
      id,
      fields: Object.keys(patch),
    })
    return this.getProject(id)!
  }

  /** Deletes a project. Its checkpoints are kept and become unassigned. */
  deleteProject(id: string): void {
    const cur = this.getProject(id)
    if (!cur) return
    this.db.transaction((tx) => {
      tx.update(t.checkpoints).set({ projectId: null }).where(eq(t.checkpoints.projectId, id)).run()
      tx.update(t.activityEvents)
        .set({ projectId: null })
        .where(eq(t.activityEvents.projectId, id))
        .run()
      tx.delete(t.projects).where(eq(t.projects.id, id)).run()
    })
    this.audit('settings', `Deleted project “${cur.name}” (its checkpoints were kept, unassigned)`)
  }

  // ---------- checkpoints ----------
  createCheckpoint(input: {
    projectId: string | null
    trigger: CheckpointTrigger
    summary: string
    summarySource: SummarySource
    resources: ResourceRef[]
    createdAt?: number
  }): Checkpoint {
    const id = randomUUID()
    const createdAt = input.createdAt ?? Date.now()
    const valid = input.resources.map((r) => ResourceRefSchema.parse(r))
    this.db.transaction((tx) => {
      tx.insert(t.checkpoints)
        .values({
          id,
          projectId: input.projectId,
          createdAt,
          trigger: input.trigger,
          summary: input.summary,
          summarySource: input.summarySource,
        })
        .run()
      valid.forEach((r, position) => {
        tx.insert(t.resources)
          .values({ checkpointId: id, position, kind: r.kind, app: r.app, data: r })
          .run()
      })
      if (input.projectId) {
        tx.update(t.projects)
          .set({ lastCheckpointAt: createdAt })
          .where(eq(t.projects.id, input.projectId))
          .run()
      }
    })
    this.audit('capture', `Checkpoint saved (${input.trigger}) with ${valid.length} items`, {
      checkpointId: id,
      projectId: input.projectId,
      items: valid.map(describeRef),
    })
    return this.getCheckpoint(id)!
  }

  getCheckpoint(id: string): Checkpoint | null {
    const r = this.db.select().from(t.checkpoints).where(eq(t.checkpoints.id, id)).get()
    if (!r) return null
    return { ...this.toCheckpointBase(r), resources: this.resourcesFor([id]).get(id) ?? [] }
  }

  private toCheckpointBase(r: typeof t.checkpoints.$inferSelect): Omit<Checkpoint, 'resources'> {
    return {
      id: r.id,
      projectId: r.projectId ?? null,
      createdAt: r.createdAt,
      trigger: r.trigger as CheckpointTrigger,
      summary: r.summary,
      summarySource: r.summarySource as SummarySource,
    }
  }

  private resourcesFor(ids: string[]): Map<string, ResourceRef[]> {
    const map = new Map<string, ResourceRef[]>()
    if (!ids.length) return map
    const rows = this.db
      .select()
      .from(t.resources)
      .where(inArray(t.resources.checkpointId, ids))
      .orderBy(asc(t.resources.position))
      .all()
    for (const row of rows) {
      const parsed = ResourceRefSchema.safeParse(row.data)
      if (!parsed.success) continue
      const list = map.get(row.checkpointId) ?? []
      list.push(parsed.data)
      map.set(row.checkpointId, list)
    }
    return map
  }

  listCheckpoints(opts: { projectId?: string | null; limit?: number } = {}): Checkpoint[] {
    const limit = opts.limit ?? 100
    const where =
      opts.projectId === undefined
        ? undefined
        : opts.projectId === null
          ? isNull(t.checkpoints.projectId)
          : eq(t.checkpoints.projectId, opts.projectId)
    const rows = this.db
      .select()
      .from(t.checkpoints)
      .where(where)
      .orderBy(desc(t.checkpoints.createdAt))
      .limit(limit)
      .all()
    const res = this.resourcesFor(rows.map((r) => r.id))
    return rows.map((r) => ({ ...this.toCheckpointBase(r), resources: res.get(r.id) ?? [] }))
  }

  latestCheckpoint(projectId: string): Checkpoint | null {
    return this.listCheckpoints({ projectId, limit: 1 })[0] ?? null
  }

  reassignCheckpoint(id: string, projectId: string | null): void {
    this.db.update(t.checkpoints).set({ projectId }).where(eq(t.checkpoints.id, id)).run()
    if (projectId) {
      const latest = this.db
        .select({ m: sql<number>`max(${t.checkpoints.createdAt})` })
        .from(t.checkpoints)
        .where(eq(t.checkpoints.projectId, projectId))
        .get()
      this.db
        .update(t.projects)
        .set({ lastCheckpointAt: latest?.m ?? null })
        .where(eq(t.projects.id, projectId))
        .run()
    }
  }

  /** Edits a checkpoint: its "What you were doing" text and/or removes saved items (by index). */
  updateCheckpoint(id: string, patch: { summary?: string; removeItems?: number[] }): Checkpoint {
    const cp = this.getCheckpoint(id)
    if (!cp) throw new Error('Checkpoint not found')
    this.db.transaction((tx) => {
      if (patch.summary !== undefined)
        tx.update(t.checkpoints)
          .set({ summary: patch.summary.trim() })
          .where(eq(t.checkpoints.id, id))
          .run()
      if (patch.removeItems?.length) {
        const keep = cp.resources.filter((_, i) => !patch.removeItems!.includes(i))
        tx.delete(t.resources).where(eq(t.resources.checkpointId, id)).run()
        keep.forEach((r, position) =>
          tx
            .insert(t.resources)
            .values({ checkpointId: id, position, kind: r.kind, app: r.app, data: r })
            .run(),
        )
      }
    })
    this.audit(
      'capture',
      `Edited checkpoint${patch.summary !== undefined ? ' summary' : ''}${patch.removeItems?.length ? ` (removed ${patch.removeItems.length} item${patch.removeItems.length === 1 ? '' : 's'})` : ''}`,
      { checkpointId: id },
    )
    return this.getCheckpoint(id)!
  }

  deleteCheckpoint(id: string): void {
    this.db.delete(t.checkpoints).where(eq(t.checkpoints.id, id)).run()
  }

  // ---------- activity buffer ----------
  addActivity(e: ActivityEventInput): void {
    this.db
      .insert(t.activityEvents)
      .values({
        at: e.at,
        bundleId: e.bundleId,
        appName: e.appName,
        windowTitle: e.windowTitle ?? null,
        signals: e.signals,
        ref: e.ref ?? null,
        projectId: e.projectId ?? null,
      })
      .run()
  }

  recentActivity(sinceMs: number): (typeof t.activityEvents.$inferSelect)[] {
    return this.db
      .select()
      .from(t.activityEvents)
      .where(sql`${t.activityEvents.at} >= ${sinceMs}`)
      .orderBy(asc(t.activityEvents.at))
      .all()
  }

  /** Deletes activity older than `days`. Returns rows removed. */
  pruneActivity(days: number, nowMs = Date.now()): number {
    const cutoff = nowMs - days * 86_400_000
    return this.db.delete(t.activityEvents).where(lt(t.activityEvents.at, cutoff)).run().changes
  }

  // ---------- suggestions ----------
  private toSuggestion(r: typeof t.projectSuggestions.$inferSelect): Suggestion {
    return {
      id: r.id,
      kind: r.kind as Suggestion['kind'],
      name: r.name,
      signals: r.signals,
      evidence: r.evidence,
      score: r.score,
      targetProjectIds: r.targetProjectIds,
      status: r.status as Suggestion['status'],
      createdAt: r.createdAt,
    }
  }

  listSuggestions(status: Suggestion['status'] = 'pending'): Suggestion[] {
    return (
      this.db
        .select()
        .from(t.projectSuggestions)
        // Only "new project" suggestions exist now (older merge/split rows are ignored).
        .where(
          and(
            eq(t.projectSuggestions.status, status),
            eq(t.projectSuggestions.kind, 'new-project'),
          ),
        )
        .orderBy(desc(t.projectSuggestions.score))
        .all()
        .map((r) => this.toSuggestion(r))
    )
  }

  getSuggestion(id: string): Suggestion | null {
    const r = this.db
      .select()
      .from(t.projectSuggestions)
      .where(eq(t.projectSuggestions.id, id))
      .get()
    return r ? this.toSuggestion(r) : null
  }

  /** Inserts or refreshes a pending suggestion. Dismissed/accepted fingerprints are never resurrected. */
  upsertSuggestion(
    s: Omit<Suggestion, 'id' | 'status' | 'createdAt'> & { fingerprint: string },
  ): void {
    const existing = this.db
      .select()
      .from(t.projectSuggestions)
      .where(eq(t.projectSuggestions.fingerprint, s.fingerprint))
      .get()
    if (existing) {
      if (existing.status !== 'pending') return
      this.db
        .update(t.projectSuggestions)
        .set({
          name: s.name,
          signals: s.signals,
          evidence: s.evidence,
          score: s.score,
          targetProjectIds: s.targetProjectIds,
        })
        .where(eq(t.projectSuggestions.id, existing.id))
        .run()
      return
    }
    this.db
      .insert(t.projectSuggestions)
      .values({
        id: randomUUID(),
        kind: s.kind,
        name: s.name,
        signals: s.signals,
        evidence: s.evidence,
        score: s.score,
        targetProjectIds: s.targetProjectIds,
        fingerprint: s.fingerprint,
        createdAt: Date.now(),
      })
      .run()
  }

  setSuggestionStatus(id: string, status: Suggestion['status']): void {
    this.db
      .update(t.projectSuggestions)
      .set({ status })
      .where(eq(t.projectSuggestions.id, id))
      .run()
  }

  // ---------- exclusions ----------
  seedBuiltInExclusions(): void {
    const existing = new Set(
      this.db
        .select({ v: t.exclusionRules.value })
        .from(t.exclusionRules)
        .where(eq(t.exclusionRules.builtIn, true))
        .all()
        .map((r) => r.v),
    )
    for (const v of HARD_EXCLUDED_BUNDLE_IDS)
      if (!existing.has(v))
        this.db
          .insert(t.exclusionRules)
          .values({ id: randomUUID(), type: 'bundleId', value: v, builtIn: true })
          .run()
    for (const v of HARD_EXCLUDED_URL_HOSTS)
      if (!existing.has(v))
        this.db
          .insert(t.exclusionRules)
          .values({ id: randomUUID(), type: 'urlHost', value: v, builtIn: true })
          .run()
  }

  listExclusions(): ExclusionRule[] {
    return this.db
      .select()
      .from(t.exclusionRules)
      .all()
      .map((r) => ({
        id: r.id,
        type: r.type as ExclusionRule['type'],
        value: r.value,
        builtIn: r.builtIn,
      }))
  }

  addExclusion(type: ExclusionRule['type'], value: string): ExclusionRule {
    const rule = { id: randomUUID(), type, value: value.trim(), builtIn: false }
    this.db.insert(t.exclusionRules).values(rule).run()
    this.audit('settings', `Added exclusion ${type}: ${rule.value}`)
    return rule
  }

  /** Built-in rules (password managers etc.) cannot be removed. */
  removeExclusion(id: string): void {
    const r = this.db.select().from(t.exclusionRules).where(eq(t.exclusionRules.id, id)).get()
    if (!r) return
    if (r.builtIn) throw new Error('Built-in exclusions cannot be removed')
    this.db
      .delete(t.exclusionRules)
      .where(and(eq(t.exclusionRules.id, id), eq(t.exclusionRules.builtIn, false)))
      .run()
    this.audit('settings', `Removed exclusion ${r.type}: ${r.value}`)
  }

  // ---------- privacy ----------
  stats(): { projects: number; checkpoints: number; events: number; oldestEventAt: number | null } {
    return {
      projects: this.db.select({ c: count() }).from(t.projects).get()?.c ?? 0,
      checkpoints: this.db.select({ c: count() }).from(t.checkpoints).get()?.c ?? 0,
      events: this.db.select({ c: count() }).from(t.activityEvents).get()?.c ?? 0,
      oldestEventAt:
        this.db
          .select({ m: min(t.activityEvents.at) })
          .from(t.activityEvents)
          .get()?.m ?? null,
    }
  }

  exportAll(): Record<string, unknown> {
    return {
      exportedAt: new Date().toISOString(),
      format: 'savespace-export/1',
      settings: this.getSettings(),
      projects: this.listProjects(true),
      checkpoints: this.listCheckpoints({ limit: 1_000_000 }),
      suggestions: [
        ...this.listSuggestions('pending'),
        ...this.listSuggestions('accepted'),
        ...this.listSuggestions('dismissed'),
      ],
      exclusions: this.listExclusions(),
      activityEvents: this.db.select().from(t.activityEvents).all(),
      auditLog: this.listAudit(1_000_000),
    }
  }

  /** Wipes every user row. Built-in exclusions are re-seeded so protection never lapses. */
  deleteAll(): void {
    this.db.transaction((tx) => {
      tx.delete(t.resources).run()
      tx.delete(t.checkpoints).run()
      tx.delete(t.projects).run()
      tx.delete(t.activityEvents).run()
      tx.delete(t.projectSuggestions).run()
      tx.delete(t.exclusionRules).run()
      tx.delete(t.settings).run()
      tx.delete(t.auditLog).run()
    })
    this.seedBuiltInExclusions()
    this.audit('delete-all', 'All Savespace data was deleted by the user')
  }
}

/** Signals a resource contributes to project inference / matching. */
export function resourceSignals(r: ResourceRef): string[] {
  switch (r.kind) {
    case 'gitState':
      return [`repo:${r.repoPath}`]
    case 'workspace':
    case 'folder':
    case 'terminalCwd':
      return [`path:${r.path}`]
    case 'file':
      return [`path:${r.path.split('/').slice(0, -1).join('/')}`]
    case 'url':
    case 'doc':
      try {
        const u = new URL(r.url)
        return u.protocol.startsWith('http') ? [`host:${u.hostname}`] : []
      } catch {
        return []
      }
    case 'calendarEvent':
      return r.title ? [`cal:${r.title.toLowerCase()}`] : []
    default:
      return []
  }
}

export function describeRef(r: ResourceRef): string {
  switch (r.kind) {
    case 'file':
      return `file ${r.path}${r.line ? `:${r.line}` : ''}`
    case 'folder':
    case 'workspace':
    case 'terminalCwd':
      return `${r.kind} ${r.path}`
    case 'url':
    case 'doc':
    case 'deepLink':
      return `${r.kind} ${r.url}`
    case 'draft':
    case 'message':
      return `${r.kind} "${r.subject ?? r.title ?? ''}"`
    case 'note':
      return `note "${r.title ?? ''}"`
    case 'calendarEvent':
      return `event "${r.title ?? ''}"`
    case 'gitState':
      return `git ${r.repoPath} @ ${r.branch}`
    case 'windowFrame':
      return `window frame "${r.windowTitle}"`
    case 'app':
      return `app ${r.app}`
  }
}
