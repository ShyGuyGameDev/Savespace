import { BrowserWindow, nativeTheme, screen, type Rectangle } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '@shared/constants'
import { secureWebPreferences } from './security'

const preloadPath = join(__dirname, '../preload/index.cjs')
const devUrl = process.env['ELECTRON_RENDERER_URL']

function load(win: BrowserWindow, route: string): void {
  if (devUrl) void win.loadURL(`${devUrl}#${route}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
}

let dashboard: BrowserWindow | null = null
let palette: BrowserWindow | null = null
let popover: BrowserWindow | null = null

export function getDashboard(): BrowserWindow | null {
  return dashboard && !dashboard.isDestroyed() ? dashboard : null
}

export function allWindows(): BrowserWindow[] {
  return [dashboard, palette, popover].filter((w): w is BrowserWindow => !!w && !w.isDestroyed())
}

export function showDashboard(route = '/'): BrowserWindow {
  nativeTheme.themeSource = 'system'
  const existing = getDashboard()
  if (existing) {
    existing.webContents.send('nav:route', { route })
    existing.show()
    existing.focus()
    return existing
  }
  dashboard = new BrowserWindow({
    title: APP_NAME,
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 540,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: secureWebPreferences(preloadPath),
  })
  dashboard.once('ready-to-show', () => dashboard?.show())
  dashboard.on('closed', () => (dashboard = null))
  load(dashboard, route)
  return dashboard
}

/** The palette is pre-created hidden so it appears instantly on hotkey. */
export function ensurePalette(): BrowserWindow {
  if (palette && !palette.isDestroyed()) return palette
  palette = new BrowserWindow({
    width: 680,
    height: 440,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    roundedCorners: true,
    hasShadow: true,
    webPreferences: secureWebPreferences(preloadPath),
  })
  palette.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  palette.on('blur', () => palette?.hide())
  load(palette, '/palette')
  return palette
}

export function togglePalette(): void {
  const win = ensurePalette()
  if (win.isVisible()) return win.hide()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  const [w = 680] = win.getSize()
  win.setPosition(Math.round(x + (width - w) / 2), Math.round(y + height * 0.22))
  win.webContents.send('nav:route', { route: '/palette' })
  win.show()
  win.focus()
}

export function ensurePopover(): BrowserWindow {
  if (popover && !popover.isDestroyed()) return popover
  popover = new BrowserWindow({
    width: 360,
    height: 480,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    hasShadow: true,
    webPreferences: secureWebPreferences(preloadPath),
  })
  popover.on('blur', () => popover?.hide())
  load(popover, '/popover')
  return popover
}

/** Positions the popover centred under the tray icon, clamped to the display's work area. */
export function togglePopover(trayBounds: Rectangle): void {
  const win = ensurePopover()
  if (win.isVisible()) return win.hide()
  const [w = 360] = win.getSize()
  const display = screen.getDisplayMatching(trayBounds)
  const wa = display.workArea
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - w / 2)
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8))
  const y = Math.round(wa.y + 4)
  win.setPosition(x, y)
  win.webContents.send('nav:route', { route: '/popover' })
  win.show()
  win.focus()
}

export function hideTransient(): void {
  palette?.hide()
  popover?.hide()
}

export function broadcast(event: string, payload: unknown): void {
  for (const w of allWindows()) w.webContents.send(event, payload)
}
