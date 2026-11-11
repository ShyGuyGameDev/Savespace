import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { OAuthClient } from './oauth'

const FileSchema = z.object({ client_id: z.string().min(10), client_secret: z.string().optional() })

/** Minimal .env reader (dev only). Never logs values. */
function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !line.trim().startsWith('#')) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '')
  }
  return out
}

/**
 * Google OAuth "Desktop app" client, from (first match wins):
 *  1. <Savespace data dir>/google-oauth-client.json  {"client_id": "...", "client_secret": "..."}  (packaged app)
 *  2. environment / .env: SAVESPACE_GOOGLE_CLIENT_ID, SAVESPACE_GOOGLE_CLIENT_SECRET              (development)
 */
export function loadGoogleClient(dataDir: string): OAuthClient | null {
  try {
    const f = join(dataDir, 'google-oauth-client.json')
    if (existsSync(f)) {
      const raw = JSON.parse(readFileSync(f, 'utf8'))
      const parsed = FileSchema.safeParse(raw.installed ?? raw)
      if (parsed.success)
        return { clientId: parsed.data.client_id, clientSecret: parsed.data.client_secret }
    }
  } catch {
    /* fall through */
  }
  const env = {
    ...(app.isPackaged ? {} : readDotEnv(join(app.getAppPath(), '.env'))),
    ...process.env,
  }
  const id = env['SAVESPACE_GOOGLE_CLIENT_ID']
  return id
    ? { clientId: id, clientSecret: env['SAVESPACE_GOOGLE_CLIENT_SECRET'] || undefined }
    : null
}
