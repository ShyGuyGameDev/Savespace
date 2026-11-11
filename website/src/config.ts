/**
 * Where the Download Now button points.
 * Default: the newest GitHub Release of this repo (upload `Waypoint-arm64.dmg` to a release).
 * Override at build time with VITE_DOWNLOAD_URL=https://… npm run build
 */
export const DOWNLOAD_URL: string =
  import.meta.env.VITE_DOWNLOAD_URL ??
  'https://github.com/toff-tofu/Savespace/releases/latest/download/Waypoint-arm64.dmg'
