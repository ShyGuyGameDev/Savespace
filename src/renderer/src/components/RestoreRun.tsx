import { AnimatePresence, motion } from 'framer-motion'
import { Check, CircleSlash, Loader2, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RestorePlan, RestoreReport, RestoreStatus } from '@shared/schemas'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/misc'
import { api } from '@/lib/bridge'
import { appName, refLabel, STATUS_META } from '@/lib/refs'
import { ResourceIcon } from './ResourceIcon'

const STATUS_ICON: Record<RestoreStatus, React.ReactNode> = {
  opened: <Check className="size-3.5" aria-hidden />,
  'already-open': <RotateCcw className="size-3.5" aria-hidden />,
  skipped: <CircleSlash className="size-3.5" aria-hidden />,
  failed: <X className="size-3.5" aria-hidden />,
  cancelled: <CircleSlash className="size-3.5" aria-hidden />,
}

/** Live per-item restore results: opened / already open / skipped / failed, each with a reason. */
export function RestoreRun({
  runId,
  plan,
  onClose,
  compact = false,
}: {
  runId: string
  plan: RestorePlan
  onClose?: () => void
  compact?: boolean
}) {
  const [report, setReport] = useState<RestoreReport | null>(null)
  useEffect(() => {
    const off = window.waypoint.on('restore:progress', (r) => {
      if (r.runId === runId) setReport(r)
    })
    void api('restore:report', { runId }).then((r) => r && setReport(r))
    return off
  }, [runId])

  const done = !!report?.finishedAt
  const results = report?.results ?? []
  const counts = results.reduce<Record<string, number>>(
    (a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }),
    {},
  )
  const pending = plan.items.slice(results.length)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-1 pb-3" aria-live="polite">
        {!done ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <Check className="size-4 text-success" aria-hidden />
        )}
        <p className="text-[13px] font-medium">
          {!done
            ? `Restoring… ${results.length} of ${plan.items.length}`
            : report?.cancelled
              ? 'Restore cancelled'
              : 'Restore finished'}
        </p>
        <div className="ml-auto flex gap-1">
          {(['opened', 'already-open', 'skipped', 'failed'] as const).map((s) =>
            counts[s] ? (
              <Badge key={s} tone={STATUS_META[s].tone}>
                {counts[s]} {STATUS_META[s].label.toLowerCase()}
              </Badge>
            ) : null,
          )}
        </div>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label="Restore results">
        <AnimatePresence initial={false}>
          {results.map((r, i) => {
            const l = refLabel(r.ref)
            return (
              <motion.li
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.12 }}
                className="flex items-start gap-2.5 rounded-md px-2 py-1.5"
              >
                <ResourceIcon kind={r.ref.kind} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]">
                    {l.primary}{' '}
                    <span className="text-muted-foreground">· {appName(r.ref.app)}</span>
                  </p>
                  {!compact && r.reason && (
                    <p className="text-[12px] text-muted-foreground">{r.reason}</p>
                  )}
                </div>
                <Badge tone={STATUS_META[r.status].tone} className="shrink-0">
                  {STATUS_ICON[r.status]} {STATUS_META[r.status].label}
                </Badge>
              </motion.li>
            )
          })}
        </AnimatePresence>
        {!done &&
          pending.map((p, i) => (
            <li key={`p${i}`} className="flex items-center gap-2.5 px-2 py-1.5 opacity-50">
              <ResourceIcon kind={p.ref.kind} />
              <p className="flex-1 truncate text-[13px]">{refLabel(p.ref).primary}</p>
              <span className="text-[11px] text-muted-foreground">waiting</span>
            </li>
          ))}
      </ul>
      <div className="flex justify-end gap-2 pt-3">
        {!done ? (
          <Button variant="secondary" onClick={() => void api('restore:cancel', { runId })}>
            Cancel
          </Button>
        ) : (
          onClose && (
            <Button onClick={onClose} autoFocus>
              Done
            </Button>
          )
        )}
      </div>
    </div>
  )
}
