import { expect, it, vi } from 'vitest'
import type { Checkpoint } from '../../src/shared/schemas'
import { guardedFetch } from '../../src/main/net'
import { githubProgress, githubUpdates } from '../../src/main/connectors/github-progress'

vi.mock('../../src/main/net', () => ({ guardedFetch: vi.fn() }))

it('loads only canonical saved GitHub items and reports a draft with its evidence link', async () => {
  const checkpoint: Checkpoint = {
    id: 'checkpoint',
    projectId: null,
    createdAt: 1,
    trigger: 'manual',
    summary: '',
    summarySource: 'template',
    resources: [
      'https://github.com/example/project/pull/17/files?ignored=true',
      'https://github.com/example/project/pull/17#discussion',
      'https://github.com.example.net/example/project/issues/2',
      'https://github.com/../project/issues/2',
    ].map((url) => ({ kind: 'url', app: 'browser', url })),
  }
  const request = vi
    .mocked(guardedFetch)
    .mockClear()
    .mockResolvedValue(
      Response.json({
        title: 'Handle duplicate retries',
        state: 'open',
        draft: true,
        updated_at: '2026-11-12T00:00:00Z',
        head: { sha: 'a'.repeat(40) },
      }),
    )
  expect(await githubProgress(checkpoint)).toEqual([
    {
      url: 'https://github.com/example/project/pull/17',
      title: 'Handle duplicate retries',
      state: 'Draft',
      updatedAt: '2026-11-12T00:00:00Z',
      commit: 'a'.repeat(40),
    },
  ])
  expect(request).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledWith(
    'https://api.github.com/repos/example/project/pulls/17',
    expect.anything(),
  )
})

it('filters out earlier activity and prioritizes assignment changes over comments', async () => {
  vi.mocked(guardedFetch).mockResolvedValue(
    Response.json(
      [
        { event: 'commented', id: 1, created_at: '2026-11-10T00:00:00Z', body: 'Old' },
        {
          event: 'assigned',
          id: 2,
          created_at: '2026-11-12T01:00:00Z',
          assignee: { login: 'sam' },
        },
        {
          event: 'commented',
          id: 3,
          created_at: '2026-11-12T02:00:00Z',
          body: 'The retry was fixed.',
        },
      ],
      { headers: { Link: '<https://api.github.com/example?page=2>; rel="next"' } },
    ),
  )
  const result = await githubUpdates({
    id: 'checkpoint',
    projectId: null,
    createdAt: Date.parse('2026-11-12T00:00:00Z'),
    trigger: 'manual',
    summary: '',
    summarySource: 'template',
    resources: [
      { kind: 'url', app: 'browser', url: 'https://github.com/example/project/issues/17' },
    ],
  })
  expect(result.incomplete).toBe(true)
  expect(result.updates.map(({ description }) => description)).toEqual([
    'Assigned to sam',
    'A collaborator commented',
  ])
  expect(result.updates[1]).toMatchObject({
    url: 'https://github.com/example/project/issues/17#issuecomment-3',
    excerpt: 'The retry was fixed.',
  })
})
