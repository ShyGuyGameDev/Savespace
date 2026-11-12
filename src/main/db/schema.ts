import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const now = sql`(unixepoch() * 1000)`

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  /** Signals that identify this project: "repo:/path", "path:/prefix", "host:example.com", "token:foo", "cal:title". */
  signals: text('signals', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  /** Apps (with pinned items) chosen in Edit project. */
  apps: text('apps', { mode: 'json' })
    .$type<import('@shared/schemas').ProjectApp[]>()
    .notNull()
    .default(sql`'[]'`),
  /** "Only restore these apps": checkpoints for this project keep only its chosen apps (and their pinned items). */
  onlyApps: integer('only_apps', { mode: 'boolean' }).notNull().default(true),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
  lastCheckpointAt: integer('last_checkpoint_at'),
})

export const checkpoints = sqliteTable(
  'checkpoints',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull().default(now),
    trigger: text('trigger').notNull(),
    summary: text('summary').notNull().default(''),
    summarySource: text('summary_source').notNull().default('template'),
  },
  (t) => [index('checkpoints_project_idx').on(t.projectId, t.createdAt)],
)

export const resources = sqliteTable(
  'resources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    checkpointId: text('checkpoint_id')
      .notNull()
      .references(() => checkpoints.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    app: text('app').notNull(),
    /** The full Zod-validated ResourceRef. */
    data: text('data', { mode: 'json' }).notNull(),
  },
  (t) => [index('resources_checkpoint_idx').on(t.checkpointId, t.position)],
)

/** Rolling buffer of raw activity (metadata only); pruned to `activityRetentionDays`. */
export const activityEvents = sqliteTable(
  'activity_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull(),
    bundleId: text('bundle_id').notNull(),
    appName: text('app_name').notNull(),
    windowTitle: text('window_title'),
    signals: text('signals', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    ref: text('ref', { mode: 'json' }),
    projectId: text('project_id'),
  },
  (t) => [index('activity_at_idx').on(t.at)],
)

export const projectSuggestions = sqliteTable(
  'project_suggestions',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    signals: text('signals', { mode: 'json' }).$type<string[]>().notNull(),
    evidence: text('evidence', { mode: 'json' }).$type<string[]>().notNull(),
    score: real('score').notNull(),
    targetProjectIds: text('target_project_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text('status').notNull().default('pending'),
    fingerprint: text('fingerprint').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('suggestions_fingerprint_idx').on(t.fingerprint)],
)

export const exclusionRules = sqliteTable('exclusion_rules', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  value: text('value').notNull(),
  builtIn: integer('built_in', { mode: 'boolean' }).notNull().default(false),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
})

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull().default(now),
    action: text('action').notNull(),
    detail: text('detail').notNull(),
    data: text('data', { mode: 'json' }),
  },
  (t) => [index('audit_at_idx').on(t.at)],
)
