import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppContext } from './app-context'

/** Seeds realistic demo data for end-to-end tests and screenshots (only with SAVESPACE_E2E_SEED=1). */
export function seedDemo(ctx: AppContext): void {
  const { store } = ctx
  if (store.listProjects(true).length) return
  const dir = join(ctx.dataDir, 'demo-files/atlas-api')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/server.ts'), 'export {}\n')
  writeFileSync(join(dir, 'README.md'), '# Atlas\n')
  store.setSettings({ onboardingComplete: true })
  const atlas = store.createProject('Atlas API', [`repo:${dir}`, 'host:acme.atlassian.net'])
  const site = store.createProject('Marketing site', ['host:www.figma.com'])
  const now = Date.now()
  store.createCheckpoint({
    projectId: atlas.id,
    trigger: 'idle',
    createdAt: now - 25 * 60_000,
    summary:
      'You were working on Atlas API, editing server.ts around line 42 with README.md also open. The feature/rate-limits branch of atlas-api had 3 uncommitted changes, and 2 related tabs were open, including Jira ticket ATL-212.',
    summarySource: 'template',
    resources: [
      { kind: 'app', app: 'com.microsoft.VSCode', title: 'Visual Studio Code' },
      { kind: 'workspace', app: 'com.microsoft.VSCode', path: dir, title: 'atlas-api' },
      {
        kind: 'file',
        app: 'com.microsoft.VSCode',
        path: join(dir, 'src/server.ts'),
        line: 42,
        column: 7,
        focused: true,
      },
      { kind: 'file', app: 'com.microsoft.VSCode', path: join(dir, 'README.md') },
      {
        kind: 'gitState',
        app: 'git',
        repoPath: dir,
        branch: 'feature/rate-limits',
        dirtyFiles: 3,
        ahead: 1,
      },
      {
        kind: 'url',
        app: 'com.google.Chrome',
        url: 'https://acme.atlassian.net/browse/ATL-212',
        title: 'ATL-212 Rate limit the public API',
      },
      {
        kind: 'url',
        app: 'com.google.Chrome',
        url: 'https://github.com/acme/atlas-api/pull/88',
        title: 'Add token bucket limiter #88',
      },
      {
        kind: 'draft',
        app: 'com.apple.mail',
        messageId: 'demo-1@example.com',
        subject: 'Re: API limits for partners',
      },
      { kind: 'terminalCwd', app: 'com.apple.Terminal', path: dir },
      {
        kind: 'windowFrame',
        app: 'com.microsoft.VSCode',
        windowTitle: 'server.ts — atlas-api',
        frame: { x: 0, y: 25, w: 1280, h: 800 },
      },
    ],
  })
  store.createCheckpoint({
    projectId: site.id,
    trigger: 'end-of-day',
    createdAt: now - 26 * 3600_000,
    summary:
      'You were working on Marketing site in the browser, mainly on the Homepage v3 Figma file and the launch checklist doc.',
    summarySource: 'template',
    resources: [
      {
        kind: 'url',
        app: 'com.google.Chrome',
        url: 'https://www.figma.com/design/abc123/Homepage-v3?node-id=12-4',
        title: 'Homepage v3',
        focused: true,
      },
      {
        kind: 'url',
        app: 'com.google.Chrome',
        url: 'https://docs.google.com/document/d/xyz/edit',
        title: 'Launch checklist',
      },
      { kind: 'app', app: 'com.tinyspeck.slackmacgap', title: 'Slack' },
    ],
  })
  store.upsertSuggestion({
    kind: 'new-project',
    name: 'Tax Return 2026',
    signals: ['path:/Users/demo/Documents/Taxes/2026', 'host:irs.gov'],
    evidence: [
      'Seen in 14 samples over 5 sessions',
      'Used together with host irs.gov',
      'Window: 1099-NEC.pdf',
    ],
    score: 6,
    targetProjectIds: [],
    fingerprint: 'demo-tax',
  })
}
