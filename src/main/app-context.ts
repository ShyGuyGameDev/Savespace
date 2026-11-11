import { app, powerMonitor, safeStorage } from 'electron'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { allAdapters } from './adapters'
import { googleConnectorAdapter } from './adapters/google-connectors'
import { loadGoogleClient } from './connectors/config'
import { GoogleConnectors, type ConnectorId } from './connectors/google'
import { AdapterRegistry } from './adapters/registry'
import { CaptureEngine } from './capture/engine'
import { buildRules } from './capture/privacy-filter'
import { CaptureScheduler } from './capture/scheduler'
import { CheckpointService } from './checkpoints/service'
import { loadOrCreateKeyAsync, openDb, type AsyncKeyProvider, type OpenedDb } from './db/client'
import { Store } from './db/store'
import { InferenceService } from './inference/service'
import { RestoreEngine } from './restore/engine'
import { readSystem } from './capture/system'
import { Permissions } from './privacy/permissions'
import { dryRunRunner, SafeExec } from './safe-exec'
import type { Summarizer } from './summarizer/types'
import { cosine, OllamaSummarizer } from './summarizer/ollama'
import { AiEngine } from './summarizer/engine'
import { AiManager } from './summarizer/manager'
import { AppleSummarizer, AutoSummarizer } from './summarizer/apple'
import { registerAppleAiHelper } from './safe-exec/allowlist'
import { existsSync } from 'node:fs'

export interface AppContext {
  dataDir: string
  opened: OpenedDb
  store: Store
  exec: SafeExec
  permissions: Permissions
  registry: AdapterRegistry
  engine: CaptureEngine
  checkpoints: CheckpointService
  scheduler: CaptureScheduler
  summarizer: Summarizer
  ollama: OllamaSummarizer
  ai: AiManager
  inference: InferenceService
  restore: RestoreEngine
  google: GoogleConnectors
}

export const keychainKeys: AsyncKeyProvider = {
  isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: (s) => safeStorage.encryptStringAsync(s),
  decrypt: (b) => safeStorage.decryptStringAsync(b),
}

export function migrationsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'migrations')
    : join(app.getAppPath(), 'src/main/db/migrations')
}

export function appleHelperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'apple-ai/waypoint-apple-ai')
    : join(app.getAppPath(), 'resources/apple-ai/waypoint-apple-ai')
}

export function engineBinary(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'ollama/ollama')
    : join(app.getAppPath(), 'resources/ollama/ollama')
}

export interface ContextHooks {
  onAiProgress?: (d: import('@shared/schemas').AiDownload) => void
  onRestoreProgress?: (r: import('@shared/schemas').RestoreReport) => void
  onCheckpoint?: (cp: import('@shared/schemas').Checkpoint) => void
  onSuggestionsDue?: () => void
  summarizer?: Summarizer
}

export async function createContext(hooks: ContextHooks = {}): Promise<AppContext> {
  const dataDir = app.getPath('userData')
  const tempDir = join(dataDir, 'tmp')
  mkdirSync(tempDir, { recursive: true, mode: 0o700 })
  const hexKey = await loadOrCreateKeyAsync(dataDir, keychainKeys)
  const opened = openDb({ dataDir, migrationsDir: migrationsDir(), hexKey })
  const store = new Store(opened.db)
  store.seedBuiltInExclusions()
  const exec = new SafeExec(process.env['WAYPOINT_DRY_RUN'] === '1' ? dryRunRunner : undefined, {
    canArrange: () => store.getSettings().arrangeWindows,
  })
  const permissions = new Permissions(exec)
  const google = new GoogleConnectors(
    dataDir,
    keychainKeys,
    () => loadGoogleClient(dataDir),
    (url) => exec.openUrl(url),
    (id: ConnectorId) => !!store.getSettings().connectorsEnabled[id],
  )
  const registry = new AdapterRegistry([...allAdapters(), googleConnectorAdapter(google)])
  const engine = new CaptureEngine({
    exec,
    registry,
    getSettings: () => store.getSettings(),
    getRules: () => buildRules(store.listExclusions()),
    accessibility: () => permissions.accessibility() === 'granted',
    noteAutomation: (b, s) => permissions.noteAutomation(b, s),
    tempDir,
    homeDir: homedir(),
    enrich: (refs) => google.enrichDriveTitles(refs).catch(() => refs),
  })
  let lastBlocked = 0
  const aiEngine = new AiEngine(
    engineBinary(),
    join(dataDir, 'ai/models'),
    join(dataDir, 'ai/home'),
    (l) => {
      if (/error|panic|fatal/i.test(l)) console.warn('[ai-engine]', l)
    },
    (target) => {
      // Rate-limited so a retry loop can't flood the log.
      if (Date.now() - lastBlocked < 60_000) return
      lastBlocked = Date.now()
      store.audit('summarize', `Blocked an outbound connection from the AI engine to ${target}`)
    },
  )
  const ollama = new OllamaSummarizer(
    () => store.getSettings().ollamaModel,
    () => store.getSettings().aiEnabled && aiEngine.state === 'running',
    undefined,
    () => aiEngine.baseUrl(),
    () => aiEngine.available,
  )
  const helper = appleHelperPath()
  if (existsSync(helper)) registerAppleAiHelper(helper)
  const apple = new AppleSummarizer(exec, () => existsSync(helper))
  const ai = new AiManager(
    aiEngine,
    ollama,
    () => store.getSettings(),
    hooks.onAiProgress,
    (l) => console.warn(l),
    apple,
  )
  // Apple's on-device model first, then the downloaded model, then the plain summary.
  const auto = new AutoSummarizer(apple, ollama, () => store.getSettings())
  const summarizer = hooks.summarizer ?? auto
  const checkpoints = new CheckpointService({
    store,
    engine,
    summarizer,
    ask: (instructions, prompt) => auto.ask(instructions, prompt),
    onCreated: hooks.onCheckpoint,
  })
  const inference = new InferenceService(store, homedir(), engine.git.repoRootOf, {
    fn: async (texts) => (store.getSettings().aiEnabled ? ollama.embed(texts) : null),
    cos: cosine,
  })
  const scheduler = new CaptureScheduler({
    store,
    sample: () => engine.sample(),
    checkpoint: (trigger, projectId) => checkpoints.create(trigger, projectId),
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    onSuggestionsDue: () => {
      void inference.refresh().then(() => hooks.onSuggestionsDue?.())
    },
  })
  const restore = new RestoreEngine({
    exec,
    registry,
    getSettings: () => store.getSettings(),
    readWindows: async () =>
      (await readSystem(exec, permissions.accessibility() === 'granted')).apps,
    onProgress: hooks.onRestoreProgress,
    onFinished: (r) => {
      const counts = r.results.reduce<Record<string, number>>(
        (acc, x) => ({ ...acc, [x.status]: (acc[x.status] ?? 0) + 1 }),
        {},
      )
      store.audit(
        'restore',
        `Restored checkpoint: ${Object.entries(counts)
          .map(([k, v]) => `${v} ${k}`)
          .join(', ')}`,
        {
          checkpointId: r.checkpointId,
          items: r.results.map((x) => ({
            status: x.status,
            adapter: x.adapterId,
            kind: x.ref.kind,
            app: x.ref.app,
            reason: x.reason,
          })),
        },
      )
    },
  })
  return {
    dataDir,
    opened,
    store,
    exec,
    permissions,
    registry,
    engine,
    checkpoints,
    scheduler,
    summarizer,
    ollama,
    ai,
    inference,
    restore,
    google,
  }
}
