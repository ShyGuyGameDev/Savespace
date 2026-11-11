/** Minimal Electron stand-in for Vitest (main-process modules under test import 'electron'). */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = process.env['WAYPOINT_TEST_USERDATA'] ?? join(tmpdir(), 'waypoint-test-userdata')

export const app = {
  getPath: (_name: string) => userData,
  getVersion: () => '0.0.0-test',
  getName: () => 'Waypoint',
  isPackaged: false,
  on: () => app,
}
export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from('enc:' + Buffer.from(s, 'utf8').toString('base64')),
  decryptString: (b: Buffer) =>
    Buffer.from(b.toString().replace(/^enc:/, ''), 'base64').toString('utf8'),
}
export const systemPreferences = { isTrustedAccessibilityClient: () => false }
export const shell = { openExternal: async () => undefined }
export const powerMonitor = { getSystemIdleTime: () => 0, on: () => powerMonitor }
export const BrowserWindow = { getAllWindows: () => [] }
export const ipcMain = { handle: () => undefined }
export default { app, safeStorage, systemPreferences, shell, powerMonitor, BrowserWindow, ipcMain }
