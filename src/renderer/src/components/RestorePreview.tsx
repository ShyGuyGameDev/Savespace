import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import type { RestorePlan } from '@shared/schemas'
import { Button } from '@/components/ui/button'
import { Badge, Kbd, Spinner } from '@/components/ui/misc'
import { api } from '@/lib/bridge'
import { appName, groupByApp, refLabel } from '@/lib/refs'
import { ResourceIcon } from './ResourceIcon'
import { RestoreRun } from './RestoreRun'

const ACTION_TEXT: Record<string, string> = {
  launch: 'Open app',
  focus: 'Focus',
  open: 'Open',
  'focus-existing': 'Focus',
  arrange: 'Arrange',
  skip: 'Skip',
  info: 'Context',
}

/** "Preview restore": lists exactly what will open, lets you uncheck items, then shows live results. */
export function RestorePreviewDialog({
  checkpointId,
  open,
  onOpenChange,
  autoStart = false,
}: {
  checkpointId: string | null
  open: boolean
  onOpenChange: (o: boolean) => void
  autoStart?: boolean
}) {
  const [plan, setPlan] = useState<RestorePlan | null>(null)
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set())
  const [runId, setRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !checkpointId) return
    setPlan(null)
    setRunId(null)
    setUnchecked(new Set())
    setError(null)
    api('restore:preview', { checkpointId })
      .then((p) => {
        setPlan(p)
        if (autoStart) void start(p, new Set())
      })
      .catch((e: Error) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, checkpointId])

  const start = async (p: RestorePlan, skip: Set<number>) => {
    const r = await api('restore:run', { checkpointId: p.checkpointId, skip: [...skip] })
    setRunId(r.runId)
  }

  const actionable =
    plan?.items.filter((it, i) => it.action !== 'skip' && it.action !== 'info' && !unchecked.has(i))
      .length ?? 0

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[82vh] w-[620px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-background p-5 shadow-2xl"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || !runId) && plan && !runId) {
              e.preventDefault()
              void start(plan, unchecked)
            }
          }}
        >
          <Dialog.Title className="text-[15px] font-semibold">
            {runId ? 'Restoring' : 'Preview restore'}
          </Dialog.Title>
          <Dialog.Description className="mb-3 text-[13px] text-muted-foreground">
            {runId
              ? 'Each item shows what happened and why.'
              : 'This is exactly what will open. Nothing is ever closed, edited or sent. Already-open items are focused, not duplicated.'}
          </Dialog.Description>
          {error && <p className="text-danger">{error}</p>}
          {!plan && !error && <Spinner />}
          {plan && runId && (
            <RestoreRun
              runId={runId}
              plan={{ ...plan, items: plan.items }}
              onClose={() => onOpenChange(false)}
            />
          )}
          {plan && !runId && (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {plan.items.length === 0 && (
                  <p className="py-6 text-center text-muted-foreground">
                    This checkpoint has nothing to open.
                  </p>
                )}
                {groupByApp(plan.items.map((it, i) => ({ ...it, i }))).map(([app, items]) => (
                  <section key={app} className="mb-3">
                    <h4 className="mb-1 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {app === '__frames' ? 'Window positions' : appName(app)}
                      {app !== '__frames' && <Badge>{items[0]!.tier}</Badge>}
                    </h4>
                    <ul>
                      {items.map((it) => {
                        const disabled = it.action === 'skip' || it.action === 'info'
                        const checked = !disabled && !unchecked.has(it.i)
                        const l = refLabel(it.ref)
                        return (
                          <li key={it.i}>
                            <label className="flex cursor-default items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60">
                              <input
                                type="checkbox"
                                className="mt-0.5 accent-[var(--primary)]"
                                checked={checked}
                                disabled={disabled}
                                onChange={() =>
                                  setUnchecked((s) => {
                                    const n = new Set(s)
                                    if (n.has(it.i)) n.delete(it.i)
                                    else n.add(it.i)
                                    return n
                                  })
                                }
                                aria-describedby={`plan-${it.i}`}
                              />
                              <ResourceIcon kind={it.ref.kind} className="mt-0.5" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px]">
                                  {it.description || l.primary}
                                </span>
                                <span
                                  id={`plan-${it.i}`}
                                  className="block truncate text-[12px] text-muted-foreground"
                                >
                                  {it.reason ?? l.secondary}
                                </span>
                              </span>
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {ACTION_TEXT[it.action]}
                              </span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                <p className="text-[12px] text-muted-foreground">
                  {plan.arrangeWindows
                    ? 'Arrange windows is on.'
                    : 'Window positions are not changed (Arrange windows is off).'}
                </p>
                <div className="flex gap-2">
                  <Dialog.Close asChild>
                    <Button variant="ghost">Cancel</Button>
                  </Dialog.Close>
                  <Button
                    onClick={() => void start(plan, unchecked)}
                    disabled={actionable === 0}
                    autoFocus
                  >
                    Restore {actionable} item{actionable === 1 ? '' : 's'}{' '}
                    <Kbd className="border-white/30 bg-white/15 text-white">↵</Kbd>
                  </Button>
                </div>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
