import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export async function launchApp(
  extraEnv: Record<string, string> = {},
): Promise<{ app: ElectronApplication; dataDir: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), 'waypoint-e2e-'))
  const env = {
    ...process.env,
    WAYPOINT_USER_DATA: dataDir,
    WAYPOINT_E2E: '1',
    ...extraEnv,
  } as Record<string, string>
  delete env['ELECTRON_RUN_AS_NODE']
  const app = await electron.launch({ args: [resolve(__dirname, '../..')], env })
  return { app, dataDir }
}

export async function windowByRoute(app: ElectronApplication, prefix: string): Promise<Page> {
  for (let i = 0; i < 50; i++) {
    for (const w of app.windows()) {
      const hash = new URL(w.url()).hash.replace(/^#/, '')
      if (
        (prefix === '/' && (hash === '/' || hash === '' || hash.startsWith('/onboarding'))) ||
        (prefix !== '/' && hash.startsWith(prefix))
      )
        return w
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`window ${prefix} not found`)
}
