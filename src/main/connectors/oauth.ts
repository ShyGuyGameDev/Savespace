import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import { guardedFetch } from '../net'

/**
 * OAuth 2.0 for installed apps: Authorization Code + PKCE (S256) with a loopback redirect on
 * 127.0.0.1 and a random port (Google "Desktop app" client type). The browser is opened by the
 * caller through SafeExec; tokens are returned to the caller to store via safeStorage.
 */
export const TokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string(),
  token_type: z.string(),
})
export type TokenResponse = z.infer<typeof TokenSchema>

export interface StoredToken {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  scope: string
}

const b64url = (b: Buffer) =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

export interface OAuthClient {
  clientId: string
  clientSecret?: string
}

export async function authorize(
  client: OAuthClient,
  scope: string,
  openBrowser: (url: string) => Promise<void>,
  timeoutMs = 180_000,
): Promise<StoredToken> {
  const { verifier, challenge } = pkcePair()
  const state = b64url(randomBytes(16))
  let server: Server | null = null
  try {
    const code = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
      server = createServer((req, res) => {
        const u = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (u.pathname !== '/oauth/callback') {
          res.writeHead(404).end()
          return
        }
        const ok = u.searchParams.get('state') === state && u.searchParams.get('code')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Waypoint</title><body style="font:15px -apple-system;padding:40px">${ok ? 'Connected. You can close this tab and return to Waypoint.' : 'Sign-in was cancelled or failed. You can close this tab.'}</body>`,
        )
        if (ok)
          resolve({
            code: u.searchParams.get('code')!,
            redirect: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/oauth/callback`,
          })
        else reject(new Error(u.searchParams.get('error') ?? 'Sign-in failed'))
      })
      server.listen(0, '127.0.0.1', () => {
        const port = (server!.address() as AddressInfo).port
        const p = new URLSearchParams({
          client_id: client.clientId,
          redirect_uri: `http://127.0.0.1:${port}/oauth/callback`,
          response_type: 'code',
          scope,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
          access_type: 'offline',
          prompt: 'consent',
        })
        openBrowser(`https://accounts.google.com/o/oauth2/v2/auth?${p}`).catch(reject)
      })
      setTimeout(() => reject(new Error('Sign-in timed out')), timeoutMs)
    })
    const body = new URLSearchParams({
      code: code.code,
      client_id: client.clientId,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: code.redirect,
    })
    if (client.clientSecret) body.set('client_secret', client.clientSecret)
    return await exchange(body)
  } finally {
    ;(server as Server | null)?.close()
  }
}

export async function refresh(client: OAuthClient, token: StoredToken): Promise<StoredToken> {
  if (!token.refreshToken) throw new Error('No refresh token; reconnect the service')
  const body = new URLSearchParams({
    client_id: client.clientId,
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
  })
  if (client.clientSecret) body.set('client_secret', client.clientSecret)
  const t = await exchange(body)
  return { ...t, refreshToken: t.refreshToken ?? token.refreshToken }
}

async function exchange(body: URLSearchParams): Promise<StoredToken> {
  const res = await guardedFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`)
  const t = TokenSchema.parse(await res.json())
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + (t.expires_in - 60) * 1000,
    scope: t.scope,
  }
}
