import { app, BrowserWindow, dialog } from 'electron'
import { githubProgress, githubTargets, githubUpdates } from '../connectors/github-progress'
import { release } from 'node:os'
import { APP_NAME } from '@shared/constants'
import type { AppContext } from '../app-context'
import { exportToDataDir } from '../privacy/export'
import { broadcast, showDashboard } from '../windows'
import type { Handlers } from './register'
import { listAdapters } from '../adapters/info'
import { listInstalledApps } from '../adapters/installed-apps'
import type { ProjectItem } from '@shared/schemas'

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
      const before = store.getSettings().captureEnabled
      const s = store.setSettings(patch)
      if (
        patch.captureEnabled === false ||
        patch.appsCaptureOff ||
        patch.captureSafariTabs === false
      )
        ctx.scheduler.clearCaptureContext()
      if (patch.captureEnabled !== undefined && patch.captureEnabled !== before)
        store.audit(
          'settings',
          patch.captureEnabled ? 'Tracking resumed' : 'Tracking paused: nothing is being watched',
        )
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
    'projects:update': ({ id, ...patch }) => {
      const p = store.updateProject(id, patch)
      changed('projects')
      return p
    },
    'projects:delete': ({ id }) => {
      store.deleteProject(id)
      changed('all')
      return ok
    },

    'checkpoints:list': ({ projectId, limit }) => store.listCheckpoints({ projectId, limit }),
    'checkpoints:get': ({ id }) => store.getCheckpoint(id),
    'checkpoints:create': async (input) => {
      const projectId =
        input?.projectId === undefined
          ? (ctx.scheduler.manualProject ??
            (store.getSettings().captureEnabled ? ctx.scheduler.lastContext.projectId : null) ??
            undefined)
          : input.projectId
      if (input?.projectId && !store.getProject(input.projectId))
        throw new Error('Project not found')
      const cp = await ctx.checkpoints.create('manual', projectId, {
        handoff: input?.handoff,
        snapshot: input?.handoff ? ctx.scheduler.snapshotFor(projectId) : undefined,
      })
      if (!cp) throw new Error('Nothing to save right now')
      changed('checkpoints')
      return cp
    },
    'checkpoints:update': ({ id, ...patch }) => {
      const cp = store.updateCheckpoint(id, patch)
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
      const r = await ctx.inference.lookAgain(async () => {
        const snap = await ctx.engine.snapshot()
        const front = snap.system.apps.find((a) => a.frontmost && a.bundleId)
        return {
          refs: snap.refs,
          frontApp: front?.bundleId ? { bundleId: front.bundleId, name: front.name } : null,
        }
      })
      changed('suggestions')
      return { ...r, suggestions: store.listSuggestions() }
    },

    'restore:preview': ({ checkpointId }) => {
      const cp = store.getCheckpoint(checkpointId)
      if (!cp) throw new Error('Checkpoint not found')
      return ctx.restore.plan(cp)
    },
    'restore:run': ({ checkpointId, skip }) => {
      const cp = store.getCheckpoint(checkpointId)
      if (!cp) throw new Error('Checkpoint not found')
      if (cp.projectId && store.getProject(cp.projectId)?.archived === false) {
        void ctx.scheduler.selectProject(cp.projectId).catch(console.error)
        changed('projects')
      }
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
      const name = ctx.registry.adapters.find((a) => a.bundleIds.includes(bundleId))?.displayName
      return permissions.requestAutomation(bundleId, name)
    },

    'ai:status': () => ctx.ai.status(),
    'ai:download': (input) => {
      // Clicking Yes / Download is the user's consent.
      if (store.getSettings().aiDownloadConsent !== 'yes')
        store.setSettings({ aiDownloadConsent: 'yes' })
      store.audit(
        'summarize',
        `Downloading local AI model ${input?.model ?? ctx.ai.selectedModel()} into Savespace's data folder`,
      )
      // UI tests never trigger real multi-GB downloads.
      if (!process.env['SAVESPACE_E2E'] || process.env['SAVESPACE_E2E_AI'])
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
        handoff: latest?.handoff ?? undefined,
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
      void ctx.scheduler.selectProject(null)
      ctx.scheduler.clearCaptureContext()
      changed('all')
      return ok
    },
    'privacy:stats': () => ({ ...store.stats(), dataDir: ctx.dataDir, encrypted: true }),

    'exclusions:list': () => store.listExclusions(),
    'exclusions:add': ({ type, value }) => {
      const rule = store.addExclusion(type, value)
      ctx.scheduler.clearCaptureContext()
      return rule
    },
    'exclusions:remove': ({ id }) => {
      store.removeExclusion(id)
      return ok
    },

    'adapters:list': () => listAdapters(ctx),
    'apps:installed': () => listInstalledApps(ctx.exec),
    'apps:openItems': async ({ bundleId }) => {
      // What this app has open right now (same read-only capture as a checkpoint), as pinnable items.
      const snap = await ctx.engine.snapshot()
      const out: ProjectItem[] = []
      const seen = new Set<string>()
      for (const r of snap.refs) {
        if (r.app !== bundleId) continue
        let it: ProjectItem | null = null
        if (r.kind === 'url' || r.kind === 'doc')
          it = /^https?:/i.test(r.url)
            ? { kind: 'url', url: r.url, title: r.title?.slice(0, 300) }
            : null
        else if (r.kind === 'file') it = { kind: 'file', path: r.path }
        else if (r.kind === 'folder' || r.kind === 'workspace' || r.kind === 'terminalCwd')
          it = { kind: 'folder', path: r.path }
        const key = it ? JSON.stringify(it.kind === 'url' ? it.url : it.path) : ''
        if (it && !seen.has(key)) {
          seen.add(key)
          out.push(it)
        }
      }
      return out.slice(0, 100)
    },
    'dialog:pick': async ({ kind }, e) => {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const opts: Electron.OpenDialogOptions = {
        properties: kind === 'folder' ? ['openDirectory'] : ['openFile'],
        buttonLabel: 'Add',
      }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return { path: r.canceled ? null : (r.filePaths[0] ?? null) }
    },

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
    'app:selectProject': async ({ projectId }) => {
      if (projectId && store.getProject(projectId)?.archived !== false)
        throw new Error('Choose an active project')
      await ctx.scheduler.selectProject(projectId)
      changed('projects')
      return ok
    },
    'checkpoints:githubProgress': ({ id }) => {
      const checkpoint = store.getCheckpoint(id)
      return checkpoint ? githubProgress(checkpoint) : []
    },
    'checkpoints:githubUpdates': ({ id }) => {
      const checkpoint = store.getCheckpoint(id)
      return checkpoint ? githubUpdates(checkpoint) : { updates: [], incomplete: false }
    },
    'checkpoints:openEvidence': async ({ id, url }) => {
      const checkpoint = store.getCheckpoint(id)
      const [base, anchor] = url.split('#', 2)
      if (
        !checkpoint ||
        !githubTargets(checkpoint).some((target) => target.url === base) ||
        (url !== base &&
          !/^(?:issuecomment|pullrequestreview|event)-[1-9]\d*$/.test(anchor ?? '')) ||
        (anchor && url !== `${base}#${anchor}`)
      )
        throw new Error('This source is not in the checkpoint')
      const opened = await ctx.exec.run('open', [url])
      if (opened.code !== 0) throw new Error('Could not open this source')
      return ok
    },
    'checkpoints:gitChanges': async ({ id }) => {
      if (store.getSettings().appsCaptureOff.includes('git')) return []
      const refs = store.getCheckpoint(id)?.resources ?? []
      const changes = await Promise.all(
        refs.flatMap((before) =>
          before.kind === 'gitState'
            ? [
                ctx.engine.git
                  .state(before.repoPath)
                  .then((now) =>
                    now &&
                    (before.branch !== now.branch ||
                      (before.head && now.head && before.head !== now.head) ||
                      before.dirtyFiles !== now.dirtyFiles ||
                      before.ahead !== now.ahead ||
                      before.behind !== now.behind)
                      ? { repoPath: before.repoPath, before, now }
                      : null,
                  ),
              ]
            : [],
        ),
      )
      return changes.filter((change) => change !== null)
    },
    'app:currentContext': () => {
      // While tracking is paused nothing is being watched, so there's no current context to show.
      if (!store.getSettings().captureEnabled)
        return {
          projectId: ctx.scheduler.manualProject,
          projectName: ctx.scheduler.manualProject
            ? (store.getProject(ctx.scheduler.manualProject)?.name ?? null)
            : null,
          frontApp: null,
          confidence: 0,
          manual: !!ctx.scheduler.manualProject,
        }
      const c = ctx.scheduler.lastContext
      const project = c.projectId ? store.getProject(c.projectId) : null
      return {
        ...c,
        projectId: project && !project.archived ? project.id : null,
        manual: !!ctx.scheduler.manualProject,
        projectName: project && !project.archived ? project.name : null,
      }
    },
  }
}
