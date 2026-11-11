import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GoogleConnectors } from '../../src/main/connectors/google'
import { authorize, pkcePair } from '../../src/main/connectors/oauth'

const keys = {
  isAvailable: async () => true,
  encrypt: async (s: string) => Buffer.from('enc:' + s),
  decrypt: async (b: Buffer) => ({ result: b.toString().slice(4), shouldReEncrypt: false }),
}

afterEach(() => vi.unstubAllGlobals())

describe('OAuth PKCE (loopback)', () => {
  it('uses an S256 challenge of a high-entropy verifier', () => {
    const { verifier, challenge } = pkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })

  it('runs the full loopback flow with read-only scope and exchanges the code with the verifier', async () => {
    let tokenBody: URLSearchParams | null = null
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        tokenBody = new URLSearchParams(String(init?.body))
        return new Response(
          JSON.stringify({
            access_token: 'at',
            expires_in: 3600,
            refresh_token: 'rt',
            scope: 'gmail.readonly',
            token_type: 'Bearer',
          }),
        )
      }
      return realFetch(url, init)
    })
    const token = await authorize(
      { clientId: 'cid.apps.googleusercontent.com' },
      'https://www.googleapis.com/auth/gmail.readonly',
      async (authUrl) => {
        const u = new URL(authUrl)
        expect(u.origin).toBe('https://accounts.google.com')
        expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly')
        expect(u.searchParams.get('code_challenge_method')).toBe('S256')
        const redirect = u.searchParams.get('redirect_uri')!
        expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/)
        // Simulate Google redirecting the browser back.
        await realFetch(`${redirect}?code=the-code&state=${u.searchParams.get('state')}`)
      },
    )
    expect(token).toMatchObject({ accessToken: 'at', refreshToken: 'rt' })
    expect(tokenBody!.get('code')).toBe('the-code')
    expect(tokenBody!.get('code_verifier')).toBeTruthy()
    expect(tokenBody!.get('grant_type')).toBe('authorization_code')
  })

  it('rejects a callback with the wrong state', async () => {
    const realFetch = globalThis.fetch
    await expect(
      authorize({ clientId: 'cid' }, 'scope', async (authUrl) => {
        const u = new URL(authUrl)
        await realFetch(`${u.searchParams.get('redirect_uri')}?code=x&state=forged`)
      }),
    ).rejects.toThrow()
  })
})

describe('Google connectors', () => {
  it('reports "needs credentials" and works with zero connectors', async () => {
    const g = new GoogleConnectors(
      mkdtempSync(join(tmpdir(), 'wp-conn-')),
      keys,
      () => null,
      async () => {},
      () => false,
    )
    const st = await g.status()
    expect(st.map((s) => [s.id, s.configured, s.connected])).toEqual([
      ['gmail', false, false],
      ['drive', false, false],
      ['calendar', false, false],
    ])
    expect(st[0]!.missing).toMatch(/WAYPOINT_GOOGLE_CLIENT_ID/)
    await expect(g.connect('gmail')).rejects.toThrow(/MISSING_CREDENTIALS/)
    expect(await g.gmailDrafts()).toEqual([])
  })

  it('turns recent Gmail drafts and calendar events into reopenable links (validated responses)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-conn-'))
    const g = new GoogleConnectors(
      dir,
      keys,
      () => ({ clientId: 'cid' }),
      async () => {},
      () => true,
    )
    // Seed stored tokens as if connected.
    const save = (g as unknown as { save: (id: string, t: unknown) => Promise<void> }).save.bind(g)
    await save('gmail', {
      accessToken: 't',
      expiresAt: Date.now() + 3600_000,
      scope: 'gmail.readonly',
    })
    await save('calendar', {
      accessToken: 't',
      expiresAt: Date.now() + 3600_000,
      scope: 'calendar.readonly',
    })
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push(String(url))
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer t')
      if (String(url).includes('/drafts?'))
        return new Response(JSON.stringify({ drafts: [{ id: 'r1', message: { id: '18c0ffee' } }] }))
      if (String(url).includes('/drafts/r1'))
        return new Response(
          JSON.stringify({
            id: 'r1',
            message: {
              id: '18c0ffee',
              internalDate: String(Date.now()),
              payload: { headers: [{ name: 'Subject', value: 'Q3 plan' }] },
            },
          }),
        )
      if (String(url).includes('/calendar/v3/'))
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'e',
                summary: 'Design review',
                htmlLink: 'https://www.google.com/calendar/event?eid=abc',
              },
            ],
          }),
        )
      return new Response('{}', { status: 404 })
    })
    expect(await g.gmailDrafts()).toEqual([
      {
        kind: 'url',
        app: 'web',
        url: 'https://mail.google.com/mail/u/0/#drafts?compose=18c0ffee',
        title: 'Draft: Q3 plan',
      },
    ])
    expect(await g.calendarNow()).toEqual([
      {
        kind: 'url',
        app: 'web',
        url: 'https://www.google.com/calendar/event?eid=abc',
        title: 'Event: Design review',
      },
    ])
    expect(
      calls.every(
        (c) =>
          c.startsWith('https://gmail.googleapis.com/') ||
          c.startsWith('https://www.googleapis.com/'),
      ),
    ).toBe(true)
    g.disconnect('gmail')
    expect((await g.status()).find((s) => s.id === 'gmail')?.connected).toBe(false)
  })
})
