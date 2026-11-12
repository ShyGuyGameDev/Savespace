import { Power } from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '@/components/ui/misc'
import { api, useIpc } from '@/lib/bridge'
import { cn } from '@/lib/utils'

/** On/off state of tracking (= automatic capture), shared by the dashboard and the menu-bar popover. */
export function useTracking() {
  const settings = useIpc('settings:get')
  const [busy, setBusy] = useState(false)
  const on = settings.data?.captureEnabled ?? true
  const set = async (v: boolean) => {
    setBusy(true)
    try {
      await api('settings:set', { captureEnabled: v })
      await settings.refetch()
    } finally {
      setBusy(false)
    }
  }
  return { on, ready: !!settings.data, busy, toggle: () => set(!on) }
}

/**
 * The power button in the top-right corner of the dashboard. The words to its left always say
 * whether tracking is on or paused; the button pauses or resumes it.
 */
export function TrackingToggle({ className }: { className?: string }) {
  const { on, ready, busy, toggle } = useTracking()
  if (!ready) return null
  return (
    <div className={cn('no-drag flex items-center gap-2', className)}>
      <span
        className={cn(
          'flex items-center gap-1.5 text-[12px] font-medium',
          on ? 'text-foreground' : 'text-warning',
        )}
        aria-live="polite"
        id="tracking-state"
      >
        <span
          className={cn(
            'size-2 rounded-full',
            on ? 'bg-success shadow-[0_0_0_3px] shadow-success/20' : 'bg-warning',
          )}
          aria-hidden
        />
        {on ? 'Tracking on' : 'Tracking paused'}
      </span>
      <Tooltip content={on ? 'Pause tracking' : 'Resume tracking'}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Tracking"
          aria-describedby="tracking-state"
          disabled={busy}
          onClick={() => void toggle()}
          className={cn(
            'flex size-7 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60',
            on
              ? 'border-success/40 bg-success/12 text-success hover:bg-success/20'
              : 'border-warning/50 bg-warning/12 text-warning hover:bg-warning/20',
          )}
        >
          <Power className="size-3.5" strokeWidth={2.5} aria-hidden />
        </button>
      </Tooltip>
    </div>
  )
}
