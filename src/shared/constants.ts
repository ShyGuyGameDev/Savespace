/** Rename the product here and only here. */
export const APP_NAME = 'Waypoint'
export const APP_ID = 'app.waypoint.desktop'

export const DEFAULT_HOTKEYS = {
  palette: 'Alt+Command+Space',
  checkpointNow: 'Alt+Command+S',
} as const

/**
 * Fallback model, downloaded quietly in the background ONLY when Apple's on-device model isn't
 * available. Chosen after side-by-side tests on 2026-11-11: the 1B models (gemma3:1b 806 MB,
 * llama3.2:1b 1.3 GB) invented facts; llama3.2:3b (2.0 GB) stayed accurate. Same for every Mac.
 */
export const FALLBACK_MODEL = 'llama3.2:3b'

/** Larger models the user may pick in Settings (tags verified on ollama.com/library). */
export const SUGGESTED_MODELS = ['llama3.2:3b', 'gemma4:e2b', 'gemma4:e4b', 'gemma4:12b']

/** Where summaries come from. "auto" = Apple's on-device model if available, else the downloaded model. */
export const AI_PROVIDERS = ['auto', 'apple', 'downloaded'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

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
  aiProvider: 'auto' as AiProvider,
  hotkeyPalette: DEFAULT_HOTKEYS.palette as string,
  hotkeyCheckpoint: DEFAULT_HOTKEYS.checkpointNow as string,
  connectorsEnabled: { gmail: false, drive: false, calendar: false } as Record<string, boolean>,
}
export type Settings = typeof DEFAULT_SETTINGS

export const RESTORE_ITEM_TIMEOUT_MS = 8000
export const SCRIPT_TIMEOUT_MS = 6000
