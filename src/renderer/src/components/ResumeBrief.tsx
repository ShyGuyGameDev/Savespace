import type { ReactNode } from 'react'
import { handoffFields, readHandoff } from './HandoffFields'
import type { Checkpoint } from '@shared/schemas'
import { useIpc } from '@/lib/bridge'
import { refLabel } from '@/lib/refs'
import { Button } from '@/components/ui/button'

export function ResumeBrief({
  checkpoint,
  earlierHandoff,
  recap,
  onOpen,
}: {
  checkpoint: Checkpoint
  earlierHandoff?: Checkpoint
  recap: ReactNode
  onOpen: (index: number) => void
}) {
  const plan = useIpc('restore:preview', { checkpointId: checkpoint.id })
  const answers = readHandoff(checkpoint.handoff)
  const earlier = checkpoint.handoff ? {} : readHandoff(earlierHandoff?.handoff)
  const focused = checkpoint.resources.find(
    (ref) =>
      ref.focused &&
      [
        'file',
        'url',
        'doc',
        'terminalCwd',
        'workspace',
        'draft',
        'message',
        'note',
        'deepLink',
        'folder',
      ].includes(ref.kind),
  )
  const git = checkpoint.resources.find((ref) => ref.kind === 'gitState')
  const workItem = checkpoint.resources.find(
    (ref) =>
      (ref.kind === 'url' || ref.kind === 'doc') &&
      /^https:\/\/(?:github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+(?:[/?#]|$)|linear\.app\/[^/]+\/issue\/[^/?#]+)/i.test(
        ref.url,
      ),
  )
  const actionable = (plan.data?.items ?? []).flatMap((item, index) =>
    item.action === 'open' || item.action === 'focus-existing' || item.action === 'focus'
      ? [{ item, index }]
      : [],
  )
  const first =
    actionable.find(({ item }) => item.ref.focused) ??
    actionable.find(
      ({ item }) =>
        workItem && 'url' in item.ref && 'url' in workItem && item.ref.url === workItem.url,
    ) ??
    actionable[0]
  const label = focused && refLabel(focused)
  return (
    <section
      aria-label="Resume brief"
      className="mb-4 rounded-xl border border-border bg-muted/30 p-4"
    >
      <h2 className="mb-3 text-sm font-semibold">Resume brief</h2>
      {recap}
      <dl className="space-y-3 text-sm">
        {(answers.goal || workItem) && (
          <div>
            <dt className="font-semibold">{answers.goal ? 'Your goal' : 'Saved work item'}</dt>
            <dd>{answers.goal ?? (workItem && refLabel(workItem).primary)}</dd>
          </div>
        )}
        {(answers.finding || git) && (
          <div>
            <dt className="font-semibold">{answers.finding ? 'Your finding' : 'Git when saved'}</dt>
            <dd>
              {answers.finding ??
                (git &&
                  `${git.branch}${git.head ? ` at ${git.head.slice(0, 7)}` : ''} · ${git.dirtyFiles} changed file${git.dirtyFiles === 1 ? '' : 's'}`)}
            </dd>
          </div>
        )}
        {(answers.stopped || label) && (
          <div>
            <dt className="font-semibold">
              {answers.stopped ? 'Where you stopped' : 'In focus when saved'}
            </dt>
            <dd>
              {answers.stopped ??
                (label && [label.primary, label.secondary].filter(Boolean).join(' · '))}
            </dd>
          </div>
        )}
        <div>
          <dt className="font-semibold">What should I open first?</dt>
          {answers.next && <dd className="mb-1">{answers.next}</dd>}
          <dd>
            {first ? (
              <Button
                variant="secondary"
                className="max-w-full"
                onClick={() => onOpen(first.index)}
              >
                <span className="truncate">Open {refLabel(first.item.ref).primary} first</span>
              </Button>
            ) : plan.isPending ? (
              'Checking saved resources…'
            ) : (
              'No reopenable resource identified.'
            )}
          </dd>
        </div>
      </dl>
      {earlierHandoff && Object.keys(earlier).length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Earlier handoff · {new Date(earlierHandoff.createdAt).toLocaleString()}
          </summary>
          <dl className="mt-2 space-y-1">
            {handoffFields.map(([key, label]) =>
              earlier[key] ? (
                <div key={key}>
                  <dt className="font-semibold">{label}</dt>
                  <dd>{earlier[key]}</dd>
                </div>
              ) : null,
            )}
          </dl>
        </details>
      )}
    </section>
  )
}
