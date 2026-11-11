/** Rename the product here and only here. */
export const APP_NAME = 'Waypoint'
export const APP_ID = 'app.waypoint.desktop'

export const DEFAULT_HOTKEYS = {
  palette: 'Alt+Command+Space',
  checkpointNow: 'Alt+Command+S',
} as const

/** Default Ollama model chosen by installed RAM (GB). Tags verified on ollama.com/library 2026-11-10. */
export const OLLAMA_MODEL_BY_RAM: { maxGb: number; model: string; sizeGb: number }[] = [
  { maxGb: 8, model: 'llama3.2:3b', sizeGb: 2.0 },
  { maxGb: 16, model: 'gemma4:e2b', sizeGb: 4.6 },
  { maxGb: 32, model: 'gemma4:e4b', sizeGb: 6.6 },
  { maxGb: Infinity, model: 'gemma4:12b', sizeGb: 9.5 },
]

export const SUGGESTED_MODELS = [
  'llama3.2:3b',
  'gemma4:e2b',
  'gemma4:e4b',
  'gemma4:12b',
  'qwen3:4b',
  'qwen3:8b',
]

/** Never captured, never restored, regardless of user settings. */
export const HARD_EXCLUDED_BUNDLE_IDS = [
  'com.apple.keychainaccess',
  'com.apple.Passwords',
  'com.apple.systempreferences',
  'com.apple.SecurityAgent',
  'com.apple.loginwindow',
  'com.1password.1password',
  'com.agilebits.onepassword7',
  'com.agilebits.onepassword-osx',
  'com.bitwarden.desktop',
  'com.lastpass.LastPass',
  'com.dashlane.dashlane',
  'com.dashlane.Dashlane',
  'org.keepassxc.keepassxc',
  'com.keepersecurity.passwordmanager',
  'in.sinew.Enpass-Desktop',
  'com.nordpass.macos.NordPass',
  'me.proton.pass.electron',
] as const

export const HARD_EXCLUDED_URL_HOSTS = [
  '1password.com',
  'my.1password.com',
  'vault.bitwarden.com',
  'lastpass.com',
  'passwords.google.com',
  'account.proton.me',
  'pass.proton.me',
  'app.dashlane.com',
  'keepersecurity.com',
] as const

/** Title fragments that indicate a private/incognito browsing window. */
export const PRIVATE_WINDOW_TITLE_MARKERS = [
  'Private Browsing',
  'Incognito',
  '— Private',
  '(Private)',
  'InPrivate',
]

export const DEFAULT_SETTINGS = {
  onboardingComplete: false,
  captureEnabled: true,
  captureIntervalSec: 60,
  idleThresholdMin: 10,
  endOfDayHour: 18,
  activityRetentionDays: 14,
  arrangeWindows: false,
  captureSafariTabs: false,
  launchAtLogin: false,
  ollamaModel: '' as string,
  aiEnabled: true,
  hotkeyPalette: DEFAULT_HOTKEYS.palette as string,
  hotkeyCheckpoint: DEFAULT_HOTKEYS.checkpointNow as string,
  connectorsEnabled: { gmail: false, drive: false, calendar: false } as Record<string, boolean>,
}
export type Settings = typeof DEFAULT_SETTINGS

export const RESTORE_ITEM_TIMEOUT_MS = 8000
export const SCRIPT_TIMEOUT_MS = 6000
