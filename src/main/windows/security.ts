import { app, session, type WebContents } from 'electron'

/** Hosts the main process may contact over the network. The renderer may contact none. */
export const ALLOWED_NETWORK_HOSTS = new Set([
  // Savespace's bundled AI engine is allowed separately, on its own random loopback port (net.ts).
  // Opt-in Google connectors only (read-only scopes):
  'oauth2.googleapis.com',
  'accounts.google.com',
  'gmail.googleapis.com',
  'www.googleapis.com',
  // Public checkpoint evidence, requested explicitly by the user.
  'api.github.com',
])

export { PROD_CSP } from './csp'
import { PROD_CSP } from './csp'

/** Applies process-wide hardening. Call once after app ready. */
export function applySecurityBaseline(isDev: boolean, devServerUrl?: string): void {
  const ses = session.defaultSession

  // Deny every web permission request (camera, mic, notifications from web, geolocation, etc.).
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)

  // Block every renderer network request that isn't our own bundle (or the dev server in dev).
  ses.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url
    if (url.startsWith('file://') || url.startsWith('devtools://') || url.startsWith('data:'))
      return cb({})
    if (
      isDev &&
      devServerUrl &&
      (url.startsWith(devServerUrl) || url.startsWith(devServerUrl.replace('http', 'ws')))
    ) {
      return cb({})
    }
    cb({ cancel: true })
  })

  if (isDev) {
    ses.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            PROD_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace(
              "connect-src 'self'",
              "connect-src 'self' ws://localhost:* http://localhost:*",
            ),
          ],
        },
      })
    })
  }

  app.on('web-contents-created', (_e, contents) => hardenWebContents(contents, isDev, devServerUrl))
}

export function hardenWebContents(
  contents: WebContents,
  isDev: boolean,
  devServerUrl?: string,
): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    const allowed =
      url.startsWith('file://') || (isDev && devServerUrl && url.startsWith(devServerUrl))
    if (!allowed) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

export const secureWebPreferences = (preloadPath: string): Electron.WebPreferences => ({
  preload: preloadPath,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  spellcheck: false,
  devTools: !app.isPackaged,
})
