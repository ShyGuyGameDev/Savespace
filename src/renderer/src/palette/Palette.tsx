import Fuse from 'fuse.js'
import {
  Bookmark,
  CornerDownLeft,
  Inbox,
  LayoutDashboard,
  Play,
  Search,
  Shield,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RestorePlan } from '@shared/schemas'
import { RestoreRun } from '@/components/RestoreRun'
import { Kbd } from '@/components/ui/misc'
import { checkpointNow } from '@/lib/checkpoint'
import { api, useIpc } from '@/lib/bridge'
import { cn, relativeTime } from '@/lib/utils'

interface Row {
  id: string
  title: string
  subtitle?: string
  icon: React.ReactNode
  color?: string
  keywords?: string
  run: () => void | Promise<void>
  alt?: () => void | Promise<void>
}

const hide = () => void api('app:hideWindow')

/** Raycast-style palette: instant in-memory fuzzy search, keyboard only, Esc to close. */
export function Palette() {
  const projects = useIpc('projects:list', undefined, { staleTime: 0 })
  const ctx = useIpc('app:currentContext', undefined, { staleTime: 0 })
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [run, setRun] = useState<{ runId: string; plan: RestorePlan } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  // Reset every time the window is shown.
  useEffect(() => {
    const reset = () => {
      setQ('')
      setSel(0)
      setStatus(null)
      setRun(null)
      void projects.refetch()
      void ctx.refetch()
      setTimeout(() => input.current?.focus(), 0)
    }
    const off = window.savespace.on('nav:route', reset)
    window.addEventListener('focus', reset)
    return () => {
      off()
      window.removeEventListener('focus', reset)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resume = async (projectId: string, name: string) => {
    const [latest] = await api('checkpoints:list', { projectId, limit: 1 })
    if (!latest) return setStatus(`${name} has no checkpoints yet`)
    const plan = await api('restore:preview', { checkpointId: latest.id })
    const { runId } = await api('restore:run', { checkpointId: latest.id })
    setRun({ runId, plan })
  }

  const rows: Row[] = useMemo(() => {
    const ps = projects.data ?? []
    const out: Row[] = [
      {
        id: 'checkpoint',
        title: 'Checkpoint now',
        subtitle: ctx.data?.projectName
          ? `Save what’s open for ${ctx.data.projectName}`
          : 'Save what’s open right now',
        icon: <Bookmark aria-hidden />,
        keywords: 'save snapshot checkpoint',
        run: async () => {
          setStatus('Saving…')
          try {
            const cp = await checkpointNow()
            if (!cp) return // already saving
            setStatus(`Saved ${cp.resources.length} items`)
            setTimeout(hide, 900)
          } catch (e) {
            setStatus((e as Error).message)
          }
        },
      },
      ...ps.map<Row>((p) => ({
        id: `p:${p.id}`,
        title: `Resume ${p.name}`,
        subtitle: p.lastCheckpointAt
          ? `Last checkpoint ${relativeTime(p.lastCheckpointAt)}`
          : 'No checkpoints yet',
        icon: <Play aria-hidden />,
        color: p.color,
        keywords: `${p.name} ${p.signals.join(' ')}`,
        run: () => resume(p.id, p.name),
        alt: async () => {
          await api('app:openDashboard', { route: `/project/${p.id}` })
          hide()
        },
      })),
      {
        id: 'suggestions',
        title: 'Review suggestions',
        icon: <Inbox aria-hidden />,
        keywords: 'inbox projects',
        run: async () => (await api('app:openDashboard', { route: '/suggestions' }), hide()),
      },
      {
        id: 'dashboard',
        title: 'Open dashboard',
        icon: <LayoutDashboard aria-hidden />,
        keywords: 'timeline home',
        run: async () => (await api('app:openDashboard', { route: '/' }), hide()),
      },
      {
        id: 'privacy',
        title: 'Privacy center',
        icon: <Shield aria-hidden />,
        keywords: 'permissions export delete',
        run: async () => (await api('app:openDashboard', { route: '/privacy' }), hide()),
      },
    ]
    // Put the project you're in first after "Checkpoint now".
    const cur = ctx.data?.projectId ? out.findIndex((r) => r.id === `p:${ctx.data!.projectId}`) : -1
    if (cur > 1) out.splice(1, 0, ...out.splice(cur, 1))
    return out
  }, [projects.data, ctx.data])

  const fuse = useMemo(
    () => new Fuse(rows, { keys: ['title', 'keywords'], threshold: 0.35, ignoreLocation: true }),
    [rows],
  )
  const results = q.trim() ? fuse.search(q.trim()).map((r) => r.item) : rows

  useEffect(() => setSel(0), [q])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (run) setRun(null)
      else hide()
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault()
      setSel((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault()
      setSel((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = results[sel]
      if (!r) return
      void (e.metaKey && r.alt ? r.alt() : r.run())
    } else if (e.metaKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      void rows[0]!.run()
    }
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface text-foreground"
      onKeyDown={onKey}
    >
      <div className="flex items-center gap-2 border-b border-border px-4">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <input
          ref={input}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Resume a project or run a command…"
          className="h-12 flex-1 bg-transparent text-[15px] outline-none focus-visible:outline-none placeholder:text-muted-foreground"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[sel] ? `row-${results[sel]!.id}` : undefined}
          aria-label="Command palette"
        />
      </div>
      {run ? (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <RestoreRun runId={run.runId} plan={run.plan} compact onClose={hide} />
        </div>
      ) : (
        <ul id="palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">
              No matches. Projects appear here once you confirm them in Suggestions.
            </li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`row-${r.id}`}
              role="option"
              aria-selected={i === sel}
              onMouseMove={() => setSel(i)}
              onClick={() => void r.run()}
              className={cn(
                'flex cursor-default items-center gap-3 rounded-lg px-3 py-2',
                i === sel ? 'bg-selected' : '',
              )}
            >
              <span
                className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5"
                aria-hidden
              >
                {r.color ? (
                  <span className="size-2.5 rounded-full" style={{ background: r.color }} />
                ) : (
                  r.icon
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{r.title}</span>
                {r.subtitle && (
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {r.subtitle}
                  </span>
                )}
              </span>
              {i === sel && (
                <CornerDownLeft className="size-3.5 text-muted-foreground" aria-hidden />
              )}
            </li>
          ))}
        </ul>
      )}
      <footer
        className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-muted-foreground"
        aria-live="polite"
      >
        <span className="min-w-0 flex-1 truncate">
          {status ??
            (ctx.data?.projectName ? `You seem to be in ${ctx.data.projectName}` : 'Savespace')}
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> {results[sel]?.alt ? 'Resume' : 'Run'}
        </span>
        <span className="flex items-center gap-1">
          <Kbd>⌘↵</Kbd> Preview
        </span>
        <span className="flex items-center gap-1">
          <Kbd>⌘K</Kbd> Checkpoint
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd>
        </span>
      </footer>
    </div>
  )
}
