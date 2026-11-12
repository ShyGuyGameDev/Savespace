import { describe, expect, it } from 'vitest'
import type { ResourceRef } from '@shared/schemas'
import { buildRules, filterRefs, sanitizeUrl } from '../../src/main/capture/privacy-filter'
import { signalMatches, signalsForRef, titleTokens } from '../../src/main/capture/signals'
import { scopeRefs } from '../../src/main/checkpoints/scope'
import { matchProject } from '../../src/main/inference/match'
import { dedupe } from '../../src/main/capture/engine'

const rules = buildRules([
  { id: '1', type: 'pathPrefix', value: '/Users/me/Private', builtIn: false },
  { id: '2', type: 'titleContains', value: 'salary', builtIn: false },
  { id: '3', type: 'urlHost', value: 'bank.example.com', builtIn: false },
])

describe('privacy filter', () => {
  it('drops password managers, keychain and private/incognito windows', () => {
    const refs: ResourceRef[] = [
      { kind: 'app', app: 'com.1password.1password' },
      { kind: 'app', app: 'com.apple.keychainaccess' },
      { kind: 'app', app: 'com.bitwarden.desktop' },
      { kind: 'app', app: 'com.example.SomeNewPasswordsApp.keepassx' },
      {
        kind: 'windowFrame',
        app: 'com.apple.Safari',
        windowTitle: 'Example — Private Browsing',
        frame: { x: 0, y: 0, w: 10, h: 10 },
      },
      { kind: 'url', app: 'com.google.Chrome', url: 'https://x.com', title: 'x (Incognito)' },
      { kind: 'app', app: 'com.apple.TextEdit' },
    ]
    expect(filterRefs(refs, rules)).toEqual([{ kind: 'app', app: 'com.apple.TextEdit' }])
  })

  it('applies user path/title/host rules', () => {
    const refs: ResourceRef[] = [
      { kind: 'file', app: 'a.b', path: '/Users/me/Private/diary.md' },
      { kind: 'file', app: 'a.b', path: '/Users/me/PrivateNot/ok.md' },
      { kind: 'file', app: 'a.b', path: '/Users/me/x.xlsx', title: '2026 Salary review' },
      { kind: 'url', app: 'a.b', url: 'https://bank.example.com/acct' },
      { kind: 'url', app: 'a.b', url: 'https://my.1password.com/vault' },
    ]
    expect(
      filterRefs(refs, rules).map((r) => ('path' in r ? r.path : 'url' in r ? r.url : '')),
    ).toEqual(['/Users/me/PrivateNot/ok.md'])
  })

  it('strips credentials and secret query params from URLs', () => {
    expect(sanitizeUrl('https://user:pw@host.com/x', rules)).toBeNull()
    expect(sanitizeUrl('https://app.com/cb?code=abc&state=x&page=2', rules)).toBe(
      'https://app.com/cb?page=2',
    )
    expect(sanitizeUrl('https://app.com/#access_token=abc', rules)).toBe('https://app.com/')
    expect(sanitizeUrl('https://linear.app/team/issue/ENG-12', rules)).toBe(
      'https://linear.app/team/issue/ENG-12',
    )
  })
})

describe('signals and matching', () => {
  const repoRoot = (p: string) =>
    p.startsWith('/Users/me/code/savespace') ? '/Users/me/code/savespace' : null
  it('derives repo, host and token signals', () => {
    expect(
      signalsForRef(
        { kind: 'file', app: 'x', path: '/Users/me/code/savespace/src/a.ts' },
        repoRoot,
      ),
    ).toEqual(['repo:/Users/me/code/savespace'])
    expect(
      signalsForRef({
        kind: 'url',
        app: 'x',
        url: 'https://acme.atlassian.net/browse/WP-1',
        title: 'WP-1 Checkpoint timeline',
      }),
    ).toEqual(
      expect.arrayContaining(['host:acme.atlassian.net', 'token:checkpoint', 'token:timeline']),
    )
    expect(
      signalsForRef({ kind: 'url', app: 'x', url: 'https://github.com/me/savespace/pull/3' }),
    ).toContain('token:savespace')
  })
  it('matches paths by prefix but not by sibling name', () => {
    expect(signalMatches('path:/Users/me/code', 'repo:/Users/me/code/savespace')).toBe(true)
    expect(signalMatches('path:/Users/me/code', 'path:/Users/me/codex')).toBe(false)
    expect(signalMatches('host:atlassian.net', 'host:acme.atlassian.net')).toBe(true)
  })
  it('drops stopwords from title tokens', () => {
    expect(titleTokens('index.ts — savespace — Visual Studio Code')).toEqual(['savespace'])
  })
  it('picks the best project with confidence', () => {
    const base = { color: '', createdAt: 0, updatedAt: 0, lastCheckpointAt: null, archived: false }
    const projects = [
      {
        ...base,
        id: 'a',
        name: 'A',
        signals: ['repo:/Users/me/code/savespace', 'host:acme.atlassian.net'],
      },
      { ...base, id: 'b', name: 'B', signals: ['host:docs.example.com'] },
    ]
    const m = matchProject(projects, ['repo:/Users/me/code/savespace', 'token:foo'])
    expect(m.projectId).toBe('a')
    expect(m.confidence).toBeCloseTo(5 / 6)
    expect(matchProject(projects, ['token:nothing']).projectId).toBeNull()
  })
})

describe('checkpoint scoping', () => {
  const project = {
    id: 'p',
    name: 'P',
    color: '',
    createdAt: 0,
    updatedAt: 0,
    lastCheckpointAt: null,
    archived: false,
    signals: ['repo:/r'],
  }
  it('keeps project items, used-app focused items, and their app/frames only', () => {
    const refs: ResourceRef[] = [
      { kind: 'app', app: 'code' },
      { kind: 'file', app: 'code', path: '/r/a.ts' },
      { kind: 'windowFrame', app: 'code', windowTitle: 'a.ts', frame: { x: 0, y: 0, w: 1, h: 1 } },
      { kind: 'app', app: 'spotify' },
      {
        kind: 'windowFrame',
        app: 'spotify',
        windowTitle: 'Music',
        frame: { x: 0, y: 0, w: 1, h: 1 },
      },
      { kind: 'url', app: 'chrome', url: 'https://unrelated.com', focused: true },
      { kind: 'url', app: 'chrome', url: 'https://other.com' },
    ]
    const kept = scopeRefs(refs, project, new Set(['chrome']), (p) =>
      p.startsWith('/r') ? '/r' : null,
    )
    expect(kept.map((r) => `${r.kind}:${r.app}`)).toEqual([
      'app:code',
      'file:code',
      'windowFrame:code',
      'url:chrome',
    ])
  })
})

describe('dedupe', () => {
  it('prefers the richer file ref and keeps focus', () => {
    const out = dedupe([
      { kind: 'file', app: 'com.microsoft.VSCode', path: '/r/a.ts', focused: true },
      { kind: 'file', app: 'com.microsoft.VSCode', path: '/r/a.ts', line: 10, column: 2 },
    ])
    expect(out).toEqual([
      {
        kind: 'file',
        app: 'com.microsoft.VSCode',
        path: '/r/a.ts',
        line: 10,
        column: 2,
        focused: true,
      },
    ])
  })
})
