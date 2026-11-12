import { Bookmark, Inbox, LayoutDashboard, Play, Power } from 'lucide-react'
import { useState } from 'react'
import { APP_NAME } from '@shared/constants'
import { Button } from '@/components/ui/button'
import { Badge, Kbd } from '@/components/ui/misc'
import { useCheckpointNow } from '@/lib/checkpoint'
import { api, useIpc } from '@/lib/bridge'
import { formatHotkey } from '@/lib/hotkeys'
import { relativeTime } from '@/lib/utils'

/** Menu-bar popover: current context, Checkpoint now, recent projects with Resume. */
export function TrayPopover() {
  const ctx = useIpc('app:currentContext', undefined, { refetchInterval: 10_000, staleTime: 0 })
  const projects = useIpc('projects:list', undefined, { staleTime: 0 })
  const suggestions = useIpc('suggestions:list')
  const settings = useIpc('settings:get')
  const [msg, setMsg] = useState<string | null>(null)
  const { saving, save } = useCheckpointNow()
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
        <p className="text-[14px] font-medium" aria-live="polite">
          {ctx.data?.projectName
            ? `You’re working on ${ctx.data.projectName}`
            : settings.data?.captureEnabled
              ? 'Not sure which project this is yet'
              : 'Automatic capture is paused'}
        </p>
        {ctx.data?.frontApp && (
          <p className="text-[12px] text-muted-foreground">In {ctx.data.frontApp}</p>
        )}
      </header>

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
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Pause or resume automatic capture`}
          onClick={() =>
            void api('settings:set', { captureEnabled: !settings.data?.captureEnabled }).then(() =>
              settings.refetch(),
            )
          }
        >
          <Power aria-hidden />
        </Button>
      </footer>
    </div>
  )
}
