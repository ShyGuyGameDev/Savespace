import { z } from 'zod'
import {
  AdapterInfoSchema,
  ProjectAppSchema,
  ProjectItemSchema,
  AiDownloadSchema,
  AiStatusSchema,
  AuditEntrySchema,
  CheckpointSchema,
  ConnectorStatusSchema,
  ExclusionRuleSchema,
  PermissionsStatusSchema,
  ProjectSchema,
  RestorePlanSchema,
  ResourceRefSchema,
  RestoreReportSchema,
  SuggestionSchema,
} from './schemas'
import { CHANNELS, EVENTS } from './channels'

const id = z.string().min(1).max(100)
const none = z.undefined().or(z.null()).or(z.object({}).strict())
const ok = z.object({ ok: z.literal(true) })

const SettingsPatchSchema = z
  .object({
    onboardingComplete: z.boolean(),
    captureEnabled: z.boolean(),
    captureIntervalSec: z.number().int().min(15).max(3600),
    idleThresholdMin: z.number().int().min(1).max(240),
    endOfDayHour: z.number().int().min(0).max(23),
    activityRetentionDays: z.number().int().min(1).max(365),
    arrangeWindows: z.boolean(),
    captureSafariTabs: z.boolean(),
    launchAtLogin: z.boolean(),
    ollamaModel: z.string().max(200),
    aiEnabled: z.boolean(),
    aiProvider: z.enum(['auto', 'apple', 'downloaded']),
    aiDownloadConsent: z.enum(['unasked', 'yes', 'no']),
    appsCaptureOff: z.array(z.string().max(100)).max(300),
    appsRestoreOff: z.array(z.string().max(100)).max(300),
    automationStates: z.record(z.string().max(200), z.enum(['granted', 'denied'])),
    hotkeyPalette: z.string().min(1).max(60),
    hotkeyCheckpoint: z.string().min(1).max(60),
    connectorsEnabled: z.record(z.string(), z.boolean()),
  })
  .partial()
  .strict()

export const SettingsSchema = SettingsPatchSchema.required()

/**
 * The complete IPC surface. The preload exposes only these channels, and the main process
 * validates every input (and output) against these schemas.
 */
export const IpcContract = {
  'settings:get': { input: none, output: SettingsSchema },
  'settings:set': { input: SettingsPatchSchema, output: SettingsSchema },

  'projects:list': { input: none, output: z.array(ProjectSchema) },
  'projects:create': {
    input: z.object({ name: z.string().min(1).max(120) }),
    output: ProjectSchema,
  },
  'projects:rename': {
    input: z.object({ id, name: z.string().min(1).max(120) }),
    output: ProjectSchema,
  },
  'projects:archive': { input: z.object({ id, archived: z.boolean() }), output: ok },
  'projects:update': {
    input: z.object({
      id,
      name: z.string().min(1).max(120).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      signals: z.array(z.string().min(3).max(1000)).max(100).optional(),
      apps: z.array(ProjectAppSchema).max(100).optional(),
      onlyApps: z.boolean().optional(),
    }),
    output: ProjectSchema,
  },
  'apps:installed': {
    input: none,
    output: z.array(z.object({ bundleId: z.string(), name: z.string() })),
  },
  'apps:openItems': {
    input: z.object({
      bundleId: z
        .string()
        .regex(/^[A-Za-z0-9.-]+$/)
        .max(200),
    }),
    output: z.array(ProjectItemSchema),
  },
  'dialog:pick': {
    input: z.object({ kind: z.enum(['folder', 'file']) }),
    output: z.object({ path: z.string().nullable() }),
  },
  'projects:delete': { input: z.object({ id }), output: ok },

  'checkpoints:list': {
    input: z.object({
      projectId: id.nullable().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    output: z.array(CheckpointSchema),
  },
  'checkpoints:get': { input: z.object({ id }), output: CheckpointSchema.nullable() },
  'checkpoints:create': {
    input: z
      .object({
        projectId: id.nullable().optional(),
        handoff: z.string().trim().min(1).max(1000).optional(),
      })
      .optional(),
    output: CheckpointSchema,
  },
  'checkpoints:update': {
    input: z.object({
      id,
      summary: z.string().max(2000).optional(),
      handoff: z.string().max(1000).optional(),
      removeItems: z.array(z.number().int().nonnegative()).max(1000).optional(),
    }),
    output: CheckpointSchema,
  },
  'checkpoints:reassign': { input: z.object({ id, projectId: id.nullable() }), output: ok },
  'checkpoints:delete': { input: z.object({ id }), output: ok },

  'suggestions:list': { input: none, output: z.array(SuggestionSchema) },
  'suggestions:accept': {
    input: z.object({ id, name: z.string().min(1).max(120).optional() }),
    output: ok,
  },
  'suggestions:dismiss': { input: z.object({ id }), output: ok },
  'suggestions:refresh': {
    input: none,
    output: z.object({
      suggestions: z.array(SuggestionSchema),
      found: z.number().int().nonnegative(),
      source: z.enum(['activity', 'recent', 'open-now', 'none']),
      message: z.string(),
    }),
  },

  'restore:preview': { input: z.object({ checkpointId: id }), output: RestorePlanSchema },
  'restore:run': {
    input: z.object({
      checkpointId: id,
      skip: z.array(z.number().int().nonnegative()).max(1000).optional(),
    }),
    output: z.object({ runId: z.string() }),
  },
  'restore:cancel': { input: z.object({ runId: z.string() }), output: ok },
  'restore:report': {
    input: z.object({ runId: z.string() }),
    output: RestoreReportSchema.nullable(),
  },

  'permissions:status': { input: none, output: PermissionsStatusSchema },
  'permissions:openSettings': {
    input: z.object({ pane: z.enum(['accessibility', 'automation']) }),
    output: ok,
  },
  'permissions:promptAccessibility': { input: none, output: PermissionsStatusSchema },
  'permissions:requestAutomation': {
    input: z.object({ bundleId: z.string().max(200) }),
    output: PermissionsStatusSchema,
  },

  'ai:status': { input: none, output: AiStatusSchema },
  'ai:download': {
    input: z.object({ model: z.string().min(1).max(200).optional() }).optional(),
    output: z.object({ ok: z.literal(true) }),
  },
  'ai:test': {
    input: none,
    output: z.object({
      ok: z.boolean(),
      sample: z.string(),
      source: z.enum(['apple', 'ollama', 'template']),
    }),
  },

  'privacy:audit': {
    input: z.object({ limit: z.number().int().min(1).max(2000).optional() }).optional(),
    output: z.array(AuditEntrySchema),
  },
  'privacy:export': { input: none, output: z.object({ path: z.string() }) },
  'privacy:deleteAll': { input: z.object({ confirm: z.literal('DELETE') }), output: ok },
  'privacy:stats': {
    input: none,
    output: z.object({
      projects: z.number(),
      checkpoints: z.number(),
      events: z.number(),
      oldestEventAt: z.number().nullable(),
      dataDir: z.string(),
      encrypted: z.boolean(),
    }),
  },

  'exclusions:list': { input: none, output: z.array(ExclusionRuleSchema) },
  'exclusions:add': {
    input: z.object({ type: ExclusionRuleSchema.shape.type, value: z.string().min(1).max(1000) }),
    output: ExclusionRuleSchema,
  },
  'exclusions:remove': { input: z.object({ id }), output: ok },

  'adapters:list': { input: none, output: z.array(AdapterInfoSchema) },

  'connectors:status': { input: none, output: z.array(ConnectorStatusSchema) },
  'connectors:connect': {
    input: z.object({ id: ConnectorStatusSchema.shape.id }),
    output: z.array(ConnectorStatusSchema),
  },
  'connectors:disconnect': {
    input: z.object({ id: ConnectorStatusSchema.shape.id }),
    output: z.array(ConnectorStatusSchema),
  },

  'app:info': {
    input: none,
    output: z.object({
      name: z.string(),
      version: z.string(),
      dataDir: z.string(),
      macos: z.string(),
      arch: z.string(),
    }),
  },
  'app:openDashboard': {
    input: z.object({ route: z.string().max(200).optional() }).optional(),
    output: ok,
  },
  'app:hideWindow': { input: none, output: ok },
  'app:selectProject': { input: z.object({ projectId: id.nullable() }), output: ok },
  'checkpoints:githubProgress': {
    input: z.object({ id }),
    output: z.array(
      z.object({
        url: z.url(),
        title: z.string(),
        state: z.string(),
        updatedAt: z.string().optional(),
        commit: z.string().optional(),
      }),
    ),
  },
  'checkpoints:githubUpdates': {
    input: z.object({ id }),
    output: z.object({
      incomplete: z.boolean(),
      updates: z.array(
        z.object({
          url: z.url(),
          source: z.string(),
          at: z.string(),
          description: z.string(),
          excerpt: z.string().optional(),
        }),
      ),
    }),
  },
  'checkpoints:openEvidence': {
    input: z.object({ id, url: z.url().max(2048) }),
    output: ok,
  },
  'checkpoints:gitChanges': {
    input: z.object({ id }),
    output: z.array(
      z.object({ repoPath: z.string(), before: ResourceRefSchema, now: ResourceRefSchema }),
    ),
  },
  'app:currentContext': {
    input: none,
    output: z.object({
      projectId: z.string().nullable(),
      projectName: z.string().nullable(),
      frontApp: z.string().nullable(),
      confidence: z.number(),
      manual: z.boolean(),
    }),
  },
} as const

export type IpcChannel = keyof typeof IpcContract
export type IpcInput<C extends IpcChannel> = z.input<(typeof IpcContract)[C]['input']>
export type IpcOutput<C extends IpcChannel> = z.output<(typeof IpcContract)[C]['output']>
export const IPC_CHANNELS = Object.keys(IpcContract) as IpcChannel[]

// Compile-time check: the preload's plain channel list matches the contract exactly.
type _ChannelsMatch = [IpcChannel] extends [(typeof CHANNELS)[number]]
  ? [(typeof CHANNELS)[number]] extends [IpcChannel]
    ? true
    : never
  : never
export const _channelsMatch: _ChannelsMatch = true

/** Main → renderer events. */
export const IpcEvents = {
  'ai:progress': AiDownloadSchema,
  'restore:progress': RestoreReportSchema,
  'data:changed': z.object({
    scope: z.enum(['projects', 'checkpoints', 'suggestions', 'settings', 'all']),
  }),
  'nav:route': z.object({ route: z.string() }),
  'checkpoint:created': z.object({ id: z.string(), projectName: z.string().nullable() }),
} as const
export type IpcEvent = keyof typeof IpcEvents
export const IPC_EVENTS = Object.keys(IpcEvents) as IpcEvent[]
type _EventsMatch = [IpcEvent] extends [(typeof EVENTS)[number]]
  ? [(typeof EVENTS)[number]] extends [IpcEvent]
    ? true
    : never
  : never
export const _eventsMatch: _EventsMatch = true

export interface SavespaceBridge {
  invoke<C extends IpcChannel>(channel: C, input?: IpcInput<C>): Promise<IpcOutput<C>>
  on<E extends IpcEvent>(
    event: E,
    cb: (payload: z.output<(typeof IpcEvents)[E]>) => void,
  ): () => void
}
