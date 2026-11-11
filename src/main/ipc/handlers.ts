import { app, BrowserWindow } from 'electron'
import { release } from 'node:os'
import { APP_NAME } from '@shared/constants'
import type { AppContext } from '../app-context'
import { exportToDataDir } from '../privacy/export'
import { broadcast, showDashboard } from '../windows'
import type { Handlers } from './register'
import { listAdapters } from '../adapters/info'

export function createHandlers(
  ctx: AppContext,
  hooks: { onSettingsChanged?: (keys: string[]) => void } = {},
): Handlers {
  const { store, permissions } = ctx
  const changed = (scope: 'projects' | 'checkpoints' | 'suggestions' | 'settings' | 'all') =>
    broadcast('data:changed', { scope })
  const ok = { ok: true as const }

  return {
    'settings:get': () => store.getSettings(),
    'settings:set': (patch) => {
      const s = store.setSettings(patch)
      hooks.onSettingsChanged?.(Object.keys(patch))
      changed('settings')
      return s
    },

    'projects:list': () => store.listProjects(),
    'projects:create': ({ name }) => {
      const p = store.createProject(name)
      changed('projects')
      return p
    },
    'projects:rename': ({ id, name }) => {
      const p = store.renameProject(id, name)
      changed('projects')
      return p
    },
    'projects:archive': ({ id, archived }) => {
      store.archiveProject(id, archived)
      changed('projects')
      return ok
    },
    'projects:merge': ({ sourceId, targetId }) => {
      store.mergeProjects(sourceId, targetId)
      changed('all')
      return ok
    },
    'projects:split': ({ id, newName, signals }) => {
      const p = store.splitProject(id, newName, signals)
      changed('all')
      return p
    },

    'checkpoints:list': ({ projectId, limit }) => store.listCheckpoints({ projectId, limit }),
    'checkpoints:get': ({ id }) => store.getCheckpoint(id),
    'checkpoints:create': async (input) => {
      const cp = await ctx.checkpoints.create('manual', input?.projectId ?? undefined)
      if (!cp) throw new Error('Nothing to save right now')
      changed('checkpoints')
      return cp
    },
    'checkpoints:reassign': ({ id, projectId }) => {
      store.reassignCheckpoint(id, projectId)
      changed('checkpoints')
      return ok
    },
    'checkpoints:delete': ({ id }) => {
      store.deleteCheckpoint(id)
      changed('checkpoints')
      return ok
    },

    'suggestions:list': () => store.listSuggestions(),
    'suggestions:accept': ({ id, name }) => {
      ctx.inference.accept(id, name)
      changed('all')
      return ok
    },
    'suggestions:dismiss': ({ id }) => {
      store.setSuggestionStatus(id, 'dismissed')
      changed('suggestions')
      return ok
    },
    'suggestions:refresh': async () => {
      await ctx.inference.refresh()
      changed('suggestions')
      return store.listSuggestions()
    },

    'restore:preview': ({ checkpointId }) => {
      const cp = store.getCheckpoint(checkpointId)
      if (!cp) throw new Error('Checkpoint not found')
      return ctx.restore.plan(cp)
    },
    'restore:run': ({ checkpointId, skip }) => {
      const cp = store.getCheckpoint(checkpointId)
      if (!cp) throw new Error('Checkpoint not found')
      return { runId: ctx.restore.start(cp, skip ?? []) }
    },
    'restore:cancel': ({ runId }) => {
      ctx.restore.cancel(runId)
      return ok
    },
    'restore:report': ({ runId }) => ctx.restore.report(runId),

    'permissions:status': () => permissions.status(),
    'permissions:openSettings': async ({ pane }) => {
      await permissions.openSettings(pane)
      return ok
    },
    'permissions:promptAccessibility': () => {
      store.audit('permission', 'Requested Accessibility permission')
      return permissions.promptAccessibility()
    },
    'permissions:requestAutomation': async ({ bundleId }) => {
      store.audit('permission', `Requested Automation permission for ${bundleId}`)
      return permissions.requestAutomation(bundleId)
    },

    'ai:status': () => ctx.ai.status(),
    'ai:download': (input) => {
      store.audit(
        'summarize',
        `Downloading local AI model ${input?.model ?? ctx.ai.selectedModel()} into Waypoint's data folder`,
      )
      // UI tests never trigger real multi-GB downloads.
      if (!process.env['WAYPOINT_E2E'] || process.env['WAYPOINT_E2E_AI'])
        void ctx.ai.ensureModel(input?.model ?? ctx.ai.selectedModel()).catch(() => {})
      return ok
    },
    'ai:test': async () => {
      const latest = store.listCheckpoints({ limit: 1 })[0]
      const project = latest?.projectId ? store.getProject(latest.projectId) : null
      const input = {
        project,
        trigger: 'manual' as const,
        refs: latest?.resources ?? [
          { kind: 'app' as const, app: 'com.apple.finder', title: 'Finder' },
        ],
        recentTitles: [],
        at: Date.now(),
      }
      const r = await ctx.summarizer.summarize(input)
      return { ok: r.source !== 'template', sample: r.text, source: r.source }
    },

    'privacy:audit': (input) => store.listAudit(input?.limit ?? 300),
    'privacy:export': async () => {
      const path = exportToDataDir(store, ctx.dataDir)
      await ctx.exec.openPath(path.replace(/\/[^/]+$/, ''))
      return { path }
    },
    'privacy:deleteAll': () => {
      store.deleteAll()
      changed('all')
      return ok
    },
    'privacy:stats': () => ({ ...store.stats(), dataDir: ctx.dataDir, encrypted: true }),

    'exclusions:list': () => store.listExclusions(),
    'exclusions:add': ({ type, value }) => store.addExclusion(type, value),
    'exclusions:remove': ({ id }) => {
      store.removeExclusion(id)
      return ok
    },

    'adapters:list': () => listAdapters(ctx),

    'connectors:status': () => ctx.google.status(),
    'connectors:connect': async ({ id }) => {
      await ctx.google.connect(id)
      store.setSettings({
        connectorsEnabled: { ...store.getSettings().connectorsEnabled, [id]: true },
      })
      store.audit('connector', `Connected ${id} (read-only)`)
      return ctx.google.status()
    },
    'connectors:disconnect': async ({ id }) => {
      ctx.google.disconnect(id)
      store.setSettings({
        connectorsEnabled: { ...store.getSettings().connectorsEnabled, [id]: false },
      })
      store.audit('connector', `Disconnected ${id}; token deleted`)
      return ctx.google.status()
    },

    'app:info': () => ({
      name: APP_NAME,
      version: app.getVersion(),
      dataDir: ctx.dataDir,
      macos: release(),
      arch: process.arch,
    }),
    'app:openDashboard': (input) => {
      showDashboard(input?.route ?? '/')
      return ok
    },
    'app:hideWindow': (_input, e) => {
      BrowserWindow.fromWebContents(e.sender)?.hide()
      return ok
    },
    'app:currentContext': () => {
      const c = ctx.scheduler.lastContext
      return {
        ...c,
        projectName: c.projectId ? (store.getProject(c.projectId)?.name ?? null) : null,
      }
    },
  }
}
