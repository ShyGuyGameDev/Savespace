import { readHandoff } from './HandoffFields'
import type { Checkpoint } from '@shared/schemas'
import { useIpc } from '@/lib/bridge'
import { refLabel } from '@/lib/refs'
import { Button } from '@/components/ui/button'

export function ResumeBrief({
  checkpoint,
  projectName,
  earlierHandoff,
  onOpen,
}: {
  checkpoint: Checkpoint
  projectName?: string
  earlierHandoff?: Checkpoint
  onOpen: (index: number) => void
}) {
  const plan = useIpc('restore:preview', { checkpointId: checkpoint.id })
  const note = checkpoint.handoff ?? earlierHandoff?.handoff
  const answers = readHandoff(note)
  const focused = checkpoint.resources.find(
    (ref) => ref.focused && ['file', 'url', 'doc', 'terminalCwd', 'workspace'].includes(ref.kind),
  )
  const git = checkpoint.resources.find((ref) => ref.kind === 'gitState')
  const workItem = checkpoint.resources.find(
    (ref) =>
      (ref.kind === 'url' || ref.kind === 'doc') &&
      /^https:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(ref.url),
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
  const source = checkpoint.handoff ? 'Your handoff' : 'Earlier handoff'
  const label = focused && refLabel(focused)
  return (
    <section
      aria-label="Resume brief"
      className="mb-4 rounded-xl border border-border bg-muted/30 p-4"
    >
      <h2 className="mb-3 text-sm font-semibold">Resume brief</h2>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-semibold">What was I trying to do?</dt>
          <dd>
            {answers.goal ??
              (checkpoint.summarySource !== 'template' && checkpoint.summary
                ? checkpoint.summary
                : undefined) ??
              (workItem ? `Saved work item: ${refLabel(workItem).primary}` : undefined) ??
              (projectName ? `Project: ${projectName}. No specific goal saved.` : 'No goal saved.')}
          </dd>
          {!answers.goal && checkpoint.summarySource !== 'template' && checkpoint.summary && (
            <dd className="text-xs text-muted-foreground">AI recap from saved activity</dd>
          )}
        </div>
        <div>
          <dt className="font-semibold">What had I figured out?</dt>
          <dd>
            {answers.finding ?? 'No confirmed finding saved.'}
            {!answers.finding && git && (
              <span className="block text-xs text-muted-foreground">
                Last recorded Git state · {git.branch}
                {git.head ? ` at ${git.head.slice(0, 7)}` : ''} · {git.dirtyFiles} changed files
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Where did I stop?</dt>
          <dd>
            {answers.stopped ??
              (label
                ? `In focus when saved: ${label.primary}${label.secondary ? ` · ${label.secondary}` : ''}`
                : 'No stopping point saved.')}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">What should I open first?</dt>
          {answers.next && (
            <dd className="mb-1">
              {source} · Next step: {answers.next}
            </dd>
          )}
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
      {Object.keys(answers).length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Notes from {source.toLowerCase()}
          {earlierHandoff && !checkpoint.handoff
            ? ` saved ${new Date(earlierHandoff.createdAt).toLocaleString()}`
            : ''}
          .
        </p>
      )}
    </section>
  )
}
