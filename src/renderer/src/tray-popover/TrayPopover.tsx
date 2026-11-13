import { Bookmark, Inbox, LayoutDashboard, Play, Power } from 'lucide-react'
import { useState } from 'react'
import { APP_NAME } from '@shared/constants'
import { Button } from '@/components/ui/button'
import { Badge, Kbd } from '@/components/ui/misc'
import { useCheckpointNow } from '@/lib/checkpoint'
import { api, useIpc } from '@/lib/bridge'
import { formatHotkey } from '@/lib/hotkeys'
import { cn, relativeTime } from '@/lib/utils'
import { CurrentProject } from '@/components/CurrentProject'
import { useTracking } from '@/components/TrackingToggle'

/** Menu-bar popover: current context, Checkpoint now, recent projects with Resume. */
export function TrayPopover() {
  const projects = useIpc('projects:list', undefined, { staleTime: 0 })
  const suggestions = useIpc('suggestions:list')
  const settings = useIpc('settings:get')
  const [msg, setMsg] = useState<string | null>(null)
  const { saving, save } = useCheckpointNow()
  const tracking = useTracking()
  const open = async (route: string) => {
    await api('app:openDashboard', { route })
    void api('app:hideWindow')
  }
  const resume = async (projectId: string) => {
    const [cp] = await api('checkpoints:list', { projectId, limit: 1 })
    if (!cp) return setMsg('No checkpoints yet for that project')
    await open(`/project/${projectId}/checkpoint/${cp.id}`)
  }
  const recent = (projects.data ?? []).slice(0, 4)

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface p-3 text-foreground"
      onKeyDown={(e) => e.key === 'Escape' && void api('app:hideWindow')}
    >
      <header className="mb-3 px-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {APP_NAME}
        </p>
        <CurrentProject />
        {!tracking.on && (
          <p className="mt-1 text-xs text-muted-foreground">Nothing is being tracked</p>
        )}
      </header>

      {/* Tracking on/off: always spelled out, with one button to change it. */}
      <div
        className={cn(
          'mb-3 flex items-center gap-2.5 rounded-lg border px-2.5 py-2',
          tracking.on ? 'border-success/30 bg-success/10' : 'border-warning/40 bg-warning/10',
        )}
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full',
            tracking.on ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning',
          )}
          aria-hidden
        >
          <Power className="size-3.5" strokeWidth={2.5} />
        </span>
        <span className="min-w-0 flex-1" id="popover-tracking">
          <span className="block text-[13px] font-semibold">
            {tracking.on ? 'Tracking is on' : 'Tracking is paused'}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {tracking.on ? 'Checkpoints save automatically' : 'No automatic checkpoints'}
          </span>
        </span>
        <Button
          size="sm"
          variant={tracking.on ? 'secondary' : 'default'}
          disabled={tracking.busy}
          aria-describedby="popover-tracking"
          onClick={() => void tracking.toggle()}
        >
          {tracking.on ? 'Pause tracking' : 'Resume tracking'}
        </Button>
      </div>

      <Button
        className="mb-3 w-full justify-between"
        autoFocus
        disabled={saving}
        aria-busy={saving}
        onClick={async () => {
          setMsg('Saving…')
          try {
            const cp = await save()
            if (cp) setMsg(`Saved ${cp.resources.length} items`)
          } catch (e) {
            setMsg((e as Error).message)
          }
        }}
      >
        <span className="flex items-center gap-1.5">
          <Bookmark aria-hidden /> {saving ? 'Saving…' : 'Checkpoint now'}
        </span>
        <Kbd className="border-white/30 bg-white/15 text-white">
          {formatHotkey(settings.data?.hotkeyCheckpoint ?? 'Alt+Command+S')}
        </Kbd>
      </Button>
      {msg && (
        <p className="-mt-1 mb-2 px-1 text-[12px] text-muted-foreground" role="status">
          {msg}
        </p>
      )}

      <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Recent projects
      </p>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {recent.length === 0 && (
          <li className="px-1 py-2 text-[12px] text-muted-foreground">
            Confirm projects in Suggestions and they’ll appear here.
          </li>
        )}
        {recent.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60"
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: p.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{p.name}</span>
              <span className="block text-[11px] text-muted-foreground">
                {p.lastCheckpointAt ? relativeTime(p.lastCheckpointAt) : 'No checkpoints yet'}
              </span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void resume(p.id)}
              aria-label={`Resume ${p.name}`}
            >
              <Play aria-hidden /> Resume
            </Button>
          </li>
        ))}
      </ul>

      <footer className="mt-2 flex items-center gap-1 border-t border-border pt-2">
        <Button size="sm" variant="ghost" onClick={() => void open('/')}>
          <LayoutDashboard aria-hidden /> Dashboard
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void open('/suggestions')}>
          <Inbox aria-hidden /> Suggestions{' '}
          {suggestions.data?.length ? <Badge tone="accent">{suggestions.data.length}</Badge> : null}
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          <Kbd>{formatHotkey(settings.data?.hotkeyPalette ?? 'Alt+Command+Space')}</Kbd>
        </span>
      </footer>
    </div>
  )
}
