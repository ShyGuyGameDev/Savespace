/**
 * Where the Download Now button points.
 * Default: the GitHub Release tagged `macOS` on ShyGuyGameDev/Savespace (asset `Savespace-arm64.dmg`).
 * To ship a new version, replace the .dmg on that release (same file name) and this link keeps working.
 * Override at build time with VITE_DOWNLOAD_URL=https://… npm run build
 */
export const DOWNLOAD_URL: string =
  import.meta.env.VITE_DOWNLOAD_URL ??
  'https://github.com/ShyGuyGameDev/Savespace/releases/download/macOS/Savespace-arm64.dmg'
