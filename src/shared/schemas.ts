import { z } from 'zod'

const absPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => p.startsWith('/'), 'must be an absolute path')
const httpUrl = z
  .string()
  .max(8192)
  .refine((u) => /^https?:\/\//i.test(u), 'must be http(s)')
const deepLinkUrl = z
  .string()
  .max(8192)
  .refine(
    (u) => /^[a-z][a-z0-9+.-]*:/i.test(u) && !/^(javascript|file|data|vbscript):/i.test(u),
    'invalid scheme',
  )

export const FrameSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
})
export type Frame = z.infer<typeof FrameSchema>

const base = {
  /** Bundle id of the app this resource belongs to (the app that should open it). */
  app: z.string().min(1).max(200),
  title: z.string().max(500).optional(),
  /** Was this the focused item (front window / active tab) when captured? */
  focused: z.boolean().optional(),
}

/** Every kind of thing Savespace can remember and reopen. */
export const ResourceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('app'), ...base }),
  z.object({
    kind: z.literal('file'),
    ...base,
    path: absPath,
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
  }),
  z.object({ kind: z.literal('folder'), ...base, path: absPath }),
  z.object({ kind: z.literal('workspace'), ...base, path: absPath }),
  z.object({
    kind: z.literal('url'),
    ...base,
    url: httpUrl,
    browserWindow: z.number().int().optional(),
    /** Browser profile (account) the tab was open in, e.g. { dir: 'Profile 1', name: 'Work' }. */
    profile: z
      .object({
        dir: z.string().regex(/^(Default|Profile \d{1,4}|Guest Profile)$/),
        name: z.string().max(100),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal('draft'),
    ...base,
    messageId: z.string().min(1).max(998),
    subject: z.string().max(500).optional(),
  }),
  z.object({
    kind: z.literal('message'),
    ...base,
    messageId: z.string().min(1).max(998),
    subject: z.string().max(500).optional(),
  }),
  z.object({ kind: z.literal('note'), ...base, noteId: z.string().min(1).max(500) }),
  z.object({
    kind: z.literal('calendarEvent'),
    ...base,
    uid: z.string().min(1).max(500),
    start: z.string().optional(),
  }),
  z.object({ kind: z.literal('doc'), ...base, url: deepLinkUrl }),
  z.object({ kind: z.literal('deepLink'), ...base, url: deepLinkUrl }),
  z.object({ kind: z.literal('terminalCwd'), ...base, path: absPath }),
  z.object({
    kind: z.literal('windowFrame'),
    ...base,
    windowTitle: z.string().max(500),
    frame: FrameSchema,
  }),
  z.object({
    kind: z.literal('gitState'),
    ...base,
    repoPath: absPath,
    branch: z.string().max(300),
    dirtyFiles: z.number().int().nonnegative(),
    ahead: z.number().int().nonnegative().optional(),
    behind: z.number().int().nonnegative().optional(),
    remoteUrl: z.string().max(2000).optional(),
  }),
])
export type ResourceRef = z.infer<typeof ResourceRefSchema>
export type ResourceKind = ResourceRef['kind']

export const RestoreStatusSchema = z.enum([
  'opened',
  'already-open',
  'skipped',
  'failed',
  'cancelled',
])
export type RestoreStatus = z.infer<typeof RestoreStatusSchema>

export const RestoreItemResultSchema = z.object({
  ref: ResourceRefSchema,
  adapterId: z.string(),
  status: RestoreStatusSchema,
  reason: z.string().max(1000).optional(),
  durationMs: z.number().nonnegative().optional(),
})
export type RestoreItemResult = z.infer<typeof RestoreItemResultSchema>

export const PlannedActionSchema = z.enum([
  'launch',
  'focus',
  'open',
  'focus-existing',
  'arrange',
  'skip',
  'info',
])
export const RestorePlanItemSchema = z.object({
  ref: ResourceRefSchema,
  adapterId: z.string(),
  adapterName: z.string(),
  tier: z.enum(['deep', 'partial', 'launch-only']),
  action: PlannedActionSchema,
  description: z.string(),
  reason: z.string().optional(),
})
export type RestorePlanItem = z.infer<typeof RestorePlanItemSchema>

export const RestorePlanSchema = z.object({
  checkpointId: z.string(),
  items: z.array(RestorePlanItemSchema),
  arrangeWindows: z.boolean(),
})
export type RestorePlan = z.infer<typeof RestorePlanSchema>

export const RestoreReportSchema = z.object({
  runId: z.string(),
  checkpointId: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  cancelled: z.boolean(),
  results: z.array(RestoreItemResultSchema),
})
export type RestoreReport = z.infer<typeof RestoreReportSchema>

/** Something specific pinned to an app in a project: a tab/web page, a folder or a file. */
export const ProjectItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('url'),
    url: z
      .string()
      .max(8192)
      .refine((u) => /^https?:\/\//i.test(u), 'must be http(s)'),
    title: z.string().max(300).optional(),
  }),
  z.object({
    kind: z.literal('folder'),
    path: z
      .string()
      .min(2)
      .max(4096)
      .refine((p) => p.startsWith('/'), 'must be absolute'),
  }),
  z.object({
    kind: z.literal('file'),
    path: z
      .string()
      .min(2)
      .max(4096)
      .refine((p) => p.startsWith('/'), 'must be absolute'),
  }),
])
export type ProjectItem = z.infer<typeof ProjectItemSchema>

/** An app that belongs to a project, with optional specific items pinned to it. */
export const ProjectAppSchema = z.object({
  bundleId: z
    .string()
    .regex(/^[A-Za-z0-9.-]+$/)
    .max(200),
  name: z.string().max(120),
  items: z.array(ProjectItemSchema).max(200),
})
export type ProjectApp = z.infer<typeof ProjectAppSchema>

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  signals: z.array(z.string()),
  /** Apps (and their pinned items) that make up this project, set in Edit project. */
  apps: z.array(ProjectAppSchema),
  /**
   * "Only restore these apps" (only matters when `apps` isn't empty). On: checkpoints keep only the
   * chosen apps, and inside an app with pinned items only those items. Off: the chosen apps and
   * pinned items are always kept, alongside anything else that was in use and related.
   */
  onlyApps: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastCheckpointAt: z.number().nullable(),
  archived: z.boolean(),
})
export type Project = z.infer<typeof ProjectSchema>

export const CheckpointTriggerSchema = z.enum([
  'manual',
  'project-switch',
  'idle',
  'end-of-day',
  'sleep',
  'lock',
  'quit',
])
export type CheckpointTrigger = z.infer<typeof CheckpointTriggerSchema>

export const CheckpointSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  createdAt: z.number(),
  trigger: CheckpointTriggerSchema,
  summary: z.string(),
  summarySource: z.enum(['apple', 'ollama', 'template']),
  resources: z.array(ResourceRefSchema),
})
export type Checkpoint = z.infer<typeof CheckpointSchema>
export type SummarySource = Checkpoint['summarySource']

export const SuggestionSchema = z.object({
  id: z.string(),
  kind: z.literal('new-project'),
  name: z.string(),
  signals: z.array(z.string()),
  evidence: z.array(z.string()),
  score: z.number(),
  targetProjectIds: z.array(z.string()),
  status: z.enum(['pending', 'accepted', 'dismissed']),
  createdAt: z.number(),
})
export type Suggestion = z.infer<typeof SuggestionSchema>

export const ExclusionRuleSchema = z.object({
  id: z.string(),
  type: z.enum(['bundleId', 'urlHost', 'pathPrefix', 'titleContains']),
  value: z.string().min(1).max(1000),
  builtIn: z.boolean(),
})
export type ExclusionRule = z.infer<typeof ExclusionRuleSchema>

export const AuditEntrySchema = z.object({
  id: z.number(),
  at: z.number(),
  action: z.enum([
    'capture',
    'restore',
    'export',
    'delete-all',
    'permission',
    'connector',
    'settings',
    'summarize',
  ]),
  detail: z.string(),
  data: z.unknown().optional(),
})
export type AuditEntry = z.infer<typeof AuditEntrySchema>

export const PermissionStateSchema = z.enum(['granted', 'denied', 'not-determined', 'unknown'])
export const PermissionsStatusSchema = z.object({
  accessibility: PermissionStateSchema,
  automation: z.record(z.string(), PermissionStateSchema),
  /** Outcome of the most recent "Ask" click, so the UI can explain what happened. */
  lastRequest: z
    .object({
      bundleId: z.string(),
      outcome: z.enum(['granted', 'denied', 'not-installed', 'no-answer', 'error']),
      message: z.string(),
    })
    .optional(),
})
export type PermissionsStatus = z.infer<typeof PermissionsStatusSchema>

export const AiDownloadSchema = z.object({
  model: z.string(),
  status: z.string(),
  completed: z.number().nonnegative(),
  total: z.number().nonnegative(),
  active: z.boolean(),
  error: z.string().optional(),
})
export type AiDownload = z.infer<typeof AiDownloadSchema>

export const AiStatusSchema = z.object({
  installed: z.boolean(),
  running: z.boolean(),
  models: z.array(z.string()),
  selectedModel: z.string(),
  recommendedModel: z.string(),
  ramGb: z.number(),
  modelAvailable: z.boolean(),
  download: AiDownloadSchema.nullable(),
  /** Apple's on-device model (Apple Intelligence). */
  apple: z.object({ available: z.boolean(), reason: z.string().optional() }),
  /** Where a downloaded model is saved on this Mac (with ~ for the home folder). */
  modelsDir: z.string(),
  /** Which source new summaries will use right now. */
  activeSource: z.enum(['apple', 'ollama', 'template']),
})
export type AiStatus = z.infer<typeof AiStatusSchema>

export const AdapterInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  bundleIds: z.array(z.string()),
  tier: z.enum(['deep', 'partial', 'launch-only']),
  installed: z.boolean(),
  needsAutomation: z.boolean(),
  notes: z.string(),
  /** Which kinds of specific items can be pinned to this app in a project. */
  itemKinds: z.array(z.enum(['url', 'folder', 'file'])),
  /** Whether "Reopen when resuming" applies (false for context-only items like git). */
  canRestore: z.boolean(),
})
export type AdapterInfo = z.infer<typeof AdapterInfoSchema>

export const ConnectorStatusSchema = z.object({
  id: z.enum(['gmail', 'drive', 'calendar']),
  displayName: z.string(),
  scope: z.string(),
  configured: z.boolean(),
  connected: z.boolean(),
  enabled: z.boolean(),
  missing: z.string().optional(),
})
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>
