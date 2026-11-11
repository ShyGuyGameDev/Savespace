import {
  app,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  Tray,
} from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '@shared/constants'
import { createContext, type AppContext } from './app-context'
import { createHandlers } from './ipc/handlers'
import { registerIpc } from './ipc/register'
import {
  broadcast,
  ensurePalette,
  ensurePopover,
  showDashboard,
  togglePalette,
  togglePopover,
} from './windows'
import { applySecurityBaseline } from './windows/security'
import { seedDemo } from './demo-seed'

const devUrl = process.env['ELECTRON_RENDERER_URL']
let tray: Tray | null = null
let ctx: AppContext | null = null

// Everything Savespace creates (DB, WAL/SHM, exports, tokens) is owner-only.
process.umask(0o077)
// Tests (and power users) can isolate all data in another directory.
if (process.env['SAVESPACE_USER_DATA']) app.setPath('userData', process.env['SAVESPACE_USER_DATA'])
if (!app.requestSingleInstanceLock()) app.quit()
app.setName(APP_NAME)

function resourcePath(file: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, file)
    : join(app.getAppPath(), 'resources', file)
}

function createTray(): void {
  const icon = nativeImage.createFromPath(resourcePath('trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip(APP_NAME)
  tray.on('click', (_e, bounds) => togglePopover(bounds))
  tray.on('right-click', () => {
    tray?.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: `Open ${APP_NAME}`, click: () => showDashboard('/') },
        { type: 'separator' },
        { label: `Quit ${APP_NAME}`, role: 'quit' },
      ]),
    )
  })
}

app.on('second-instance', () => showDashboard('/'))

app.whenReady().then(async () => {
  applySecurityBaseline(!app.isPackaged, devUrl)
  try {
    ctx = await createContext({
      onCheckpoint: (cp) => {
        const name = cp.projectId ? (ctx?.store.getProject(cp.projectId)?.name ?? null) : null
        broadcast('checkpoint:created', { id: cp.id, projectName: name })
        broadcast('data:changed', { scope: 'checkpoints' })
      },
      onSuggestionsDue: () => broadcast('data:changed', { scope: 'suggestions' }),
      onRestoreProgress: (r) => broadcast('restore:progress', r),
      onAiProgress: (d) => broadcast('ai:progress', d),
    })
  } catch (e) {
    dialog.showErrorBox(`${APP_NAME} could not open its database`, (e as Error).message)
    app.quit()
    return
  }
  if (process.env['SAVESPACE_E2E_SEED'] === '1') seedDemo(ctx)
  registerIpc(
    createHandlers(ctx, {
      onSettingsChanged: (keys) => {
        if (keys.some((k) => k.startsWith('hotkey'))) registerHotkeys()
        if (keys.includes('captureIntervalSec') && !process.env['SAVESPACE_E2E'])
          ctx?.scheduler.start()
        const aiKeys =
          keys.includes('aiEnabled') || keys.includes('ollamaModel') || keys.includes('aiProvider')
        if (aiKeys && (!process.env['SAVESPACE_E2E'] || process.env['SAVESPACE_E2E_AI']))
          void ctx?.ai.sync()
        if (keys.includes('launchAtLogin'))
          app.setLoginItemSettings({ openAtLogin: !!ctx?.store.getSettings().launchAtLogin })
      },
    }),
    devUrl,
  )
  createTray()
  ensurePalette()
  ensurePopover()
  const settings = ctx.store.getSettings()
  registerHotkeys()
  wirePowerEvents()
  if (!process.env['SAVESPACE_E2E']) ctx.scheduler.start()
  // Local AI is part of the app: start the bundled engine and fetch the model automatically.
  if (!process.env['SAVESPACE_E2E'] || process.env['SAVESPACE_E2E_AI']) void ctx.ai.sync()
  showDashboard(settings.onboardingComplete ? '/' : '/onboarding')
  if (process.platform === 'darwin') app.dock?.show()
})

export function registerHotkeys(): void {
  if (!ctx) return
  globalShortcut.unregisterAll()
  const s = ctx.store.getSettings()
  const okPalette = globalShortcut.register(s.hotkeyPalette, () => togglePalette())
  const okCheckpoint = globalShortcut.register(s.hotkeyCheckpoint, () => void checkpointNow())
  if (!okPalette || !okCheckpoint)
    console.warn('[hotkeys] could not register one or more shortcuts (in use by another app?)')
}

async function checkpointNow(): Promise<void> {
  if (!ctx) return
  try {
    const cp = await ctx.checkpoints.create('manual')
    const name = cp?.projectId ? ctx.store.getProject(cp.projectId)?.name : null
    new Notification({
      title: 'Checkpoint saved',
      body: name ? `Saved for ${name}. Click to review.` : 'Saved. Click to choose its project.',
      silent: true,
    })
      .on('click', () => showDashboard(cp ? `/checkpoint/${cp.id}` : '/'))
      .show()
  } catch (e) {
    new Notification({
      title: 'Could not save checkpoint',
      body: (e as Error).message,
      silent: true,
    }).show()
  }
}

function wirePowerEvents(): void {
  powerMonitor.on('suspend', () => void ctx?.scheduler.onPowerEvent('sleep'))
  powerMonitor.on('lock-screen', () => void ctx?.scheduler.onPowerEvent('lock'))
}

let quitting = false
app.on('before-quit', (e) => {
  if (quitting || !ctx || process.env['SAVESPACE_E2E']) return
  quitting = true
  e.preventDefault()
  const done = () => app.quit()
  const t = setTimeout(done, 4000)
  void ctx.scheduler.onPowerEvent('quit').finally(() => {
    clearTimeout(t)
    done()
  })
})
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  ctx?.ai.stop()
})

// A menu-bar app keeps running with no windows open.
app.on('window-all-closed', () => {})
app.on('activate', () => showDashboard('/'))
app.on('will-quit', () => ctx?.opened.close())
