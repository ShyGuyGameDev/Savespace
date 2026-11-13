import { useState } from 'react'
import type { Checkpoint } from '@shared/schemas'
import type { IpcOutput } from '@shared/ipc'
import { api } from '@/lib/bridge'
import { Button } from '@/components/ui/button'

export function ProgressRecap({ checkpoint }: { checkpoint: Checkpoint }) {
  const [items, setItems] = useState<IpcOutput<'checkpoints:githubProgress'> | null>(null)
  const [activity, setActivity] = useState<IpcOutput<'checkpoints:githubUpdates'> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const git = checkpoint.resources.filter((ref) => ref.kind === 'gitState')
  const hasGitHub = checkpoint.resources.some(
    (ref) =>
      (ref.kind === 'url' || ref.kind === 'doc') &&
      /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\/[1-9]\d*(?:[/?#]|$)/i.test(ref.url),
  )
  if (!hasGitHub && !git.length) return null

  async function loadGitHub() {
    setLoading(true)
    setError('')
    try {
      const [status, updates] = await Promise.all([
        api('checkpoints:githubProgress', { id: checkpoint.id }),
        api('checkpoints:githubUpdates', { id: checkpoint.id }),
      ])
      setItems(status)
      setActivity(updates)
    } catch {
      setError('Could not load GitHub evidence. Try again.')
    } finally {
      setLoading(false)
    }
  }

  function openSource(url: string) {
    setError('')
    void api('checkpoints:openEvidence', { id: checkpoint.id, url }).catch(() =>
      setError('Could not open this GitHub source.'),
    )
  }

  const first =
    activity?.updates[0]?.url ??
    items?.find((item) => item.updatedAt && Date.parse(item.updatedAt) > checkpoint.createdAt)?.url

  return (
    <section aria-labelledby="progress-recap" className="mb-4 rounded-xl border border-border p-4">
      <h2 id="progress-recap" className="mb-2 text-[13px] font-semibold">
        Progress evidence
      </h2>
      {!!git.length && (
        <>
          <h3 className="text-xs font-medium text-muted-foreground">Local Git at checkpoint</h3>
          <ul className="mb-3 space-y-1 text-sm">
            {git.map((ref) => (
              <li key={ref.repoPath} title={ref.repoPath}>
                {ref.repoPath.split('/').pop()} · {ref.branch}
                {ref.head && ` · Commit ${ref.head.slice(0, 7)}`}
                {ref.dirtyFiles === 0
                  ? ' · Working tree clean'
                  : ` · ${ref.dirtyFiles} changed files`}
              </li>
            ))}
          </ul>
        </>
      )}
      {hasGitHub && (
        <>
          <h3 className="text-sm font-semibold">While you were away</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            Load up to five saved public issues or pull requests. This sends their repository names
            and item numbers to GitHub.
          </p>
          <Button variant="secondary" disabled={loading} onClick={() => void loadGitHub()}>
            {loading ? 'Loading…' : items ? 'Refresh updates' : 'Check GitHub updates'}
          </Button>
          {first && (
            <Button className="ml-2" onClick={() => openSource(first)}>
              Open top update
            </Button>
          )}
          <div aria-live="polite">
            {!!activity?.updates.length && (
              <ol className="mt-3 space-y-2 text-sm">
                {activity.updates.map((update, index) => (
                  <li key={index}>
                    <a
                      href={update.url}
                      className="text-primary underline"
                      onClick={(event) => {
                        event.preventDefault()
                        openSource(update.url)
                      }}
                    >
                      {update.description} · {update.source}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      {new Date(update.at).toLocaleString()}
                    </p>
                    {update.excerpt && <p className="break-words text-xs">{update.excerpt}</p>}
                  </li>
                ))}
              </ol>
            )}
            {activity && !first && !activity.incomplete && (
              <p className="mt-2 text-xs">No GitHub updates found since this checkpoint.</p>
            )}
            {activity?.incomplete && (
              <p className="mt-2 text-xs text-muted-foreground">
                Some timeline activity could not be checked.
              </p>
            )}
            {items?.length === 0 && (
              <p className="mt-2 text-xs">No supported GitHub links found.</p>
            )}
            {!!items?.length && (
              <ul className="mt-3 space-y-2 text-sm">
                {items.map((item) => (
                  <li key={item.url}>
                    <a
                      href={item.url}
                      className="break-words text-primary underline underline-offset-2"
                      onClick={(event) => {
                        event.preventDefault()
                        openSource(item.url)
                      }}
                    >
                      {item.title}
                    </a>
                    <div className="text-xs text-muted-foreground">
                      {item.updatedAt &&
                        Date.parse(item.updatedAt) > checkpoint.createdAt &&
                        'Updated since checkpoint · '}
                      {item.state}
                      {item.commit && ` · Head commit ${item.commit.slice(0, 7)}`}
                      {item.updatedAt && ` · Updated ${new Date(item.updatedAt).toLocaleString()}`}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
