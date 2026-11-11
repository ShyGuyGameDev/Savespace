/** Manual check: real summary from a running engine (port from argv). */
import { OllamaSummarizer } from '../src/main/summarizer/ollama'
const port = process.argv[2] ?? '11555'
const s = new OllamaSummarizer(
  () => 'llama3.2:3b',
  () => true,
  undefined,
  () => `http://127.0.0.1:${port}`,
)
const t0 = Date.now()
s.summarize({
  project: {
    id: 'p',
    name: 'Atlas API',
    color: '',
    signals: [],
    createdAt: 0,
    updatedAt: 0,
    lastCheckpointAt: null,
    archived: false,
  },
  trigger: 'idle',
  at: Date.now(),
  recentTitles: ['server.ts — atlas-api', 'ATL-212 Rate limit the public API'],
  refs: [
    {
      kind: 'file',
      app: 'com.microsoft.VSCode',
      path: '/Users/me/atlas-api/src/server.ts',
      line: 42,
      focused: true,
    },
    { kind: 'file', app: 'com.microsoft.VSCode', path: '/Users/me/atlas-api/src/limiter.ts' },
    {
      kind: 'gitState',
      app: 'git',
      repoPath: '/Users/me/atlas-api',
      branch: 'feature/rate-limits',
      dirtyFiles: 3,
    },
    {
      kind: 'url',
      app: 'com.google.Chrome',
      url: 'https://acme.atlassian.net/browse/ATL-212',
      title: 'ATL-212 Rate limit the public API',
    },
    {
      kind: 'draft',
      app: 'com.apple.mail',
      messageId: 'x@y',
      subject: 'Re: API limits for partners',
    },
  ],
}).then((r) => console.log(`[${r.source}, ${Date.now() - t0} ms]\n${r.text}`))
