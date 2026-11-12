/**
 * Where the Download for macOS button points: always the NEWEST release on ShyGuyGameDev/Savespace.
 * For this to work, each release must
 *   1. NOT be marked "Pre-release" (GitHub skips pre-releases and drafts for "latest"), and
 *   2. include a file named exactly `Savespace-arm64.dmg` (what `npm run dist` produces).
 * Override at build time with VITE_DOWNLOAD_URL=https://… npm run build
 */
export const DOWNLOAD_URL: string =
  import.meta.env.VITE_DOWNLOAD_URL ??
  'https://github.com/ShyGuyGameDev/Savespace/releases/latest/download/Savespace-arm64.dmg'
