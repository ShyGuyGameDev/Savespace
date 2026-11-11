import { Check, Inbox, RefreshCw, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Suggestion } from '@shared/schemas'
import { PromptDialog } from '@/components/PromptDialog'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState, Kbd } from '@/components/ui/misc'
import { api, useIpc } from '@/lib/bridge'
import { cn } from '@/lib/utils'
import { toast } from './toast'

const pretty = (s: string) =>
  s
    .replace(/^repo:|^path:/, '📁 ')
    .replace(/^host:/, '🌐 ')
    .replace(/^cal:/, '📅 ')
    .replace(/^token:/, '# ')
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/📁 \/Users\/[^/]+/, '📁 ~')

export function Suggestions() {
  const q = useIpc('suggestions:list')
  const [sel, setSel] = useState(0)
  const [renaming, setRenaming] = useState<Suggestion | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const items = q.data ?? []
  const current = items[sel]

  const accept = async (s: Suggestion, name?: string) => {
    await api('suggestions:accept', { id: s.id, name })
    toast(`Created “${name ?? s.name}”`)
  }
  const dismiss = async (s: Suggestion) => {
    await api('suggestions:dismiss', { id: s.id })
  }
  useEffect(() => {
    if (sel >= items.length) setSel(Math.max(0, items.length - 1))
  }, [items.length, sel])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest('input, textarea, [role="dialog"], [role="menu"]') ||
        e.metaKey
      )
        return
      if (!current) return
      if (e.key === 'j' || e.key === 'ArrowDown') setSel((i) => Math.min(i + 1, items.length - 1))
      else if (e.key === 'k' || e.key === 'ArrowUp') setSel((i) => Math.max(i - 1, 0))
      else if (e.key === 'c' || e.key === 'Enter') void accept(current)
      else if (e.key === 'e') setRenaming(current)
      else if (e.key === 'x' || e.key === 'Backspace') void dismiss(current)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="drag flex h-12 shrink-0 items-center gap-3 border-b border-border px-6">
        <h1 className="text-[14px] font-semibold">Suggestions</h1>
        <p className="text-[12px] text-muted-foreground">
          Nothing becomes a project until you confirm it.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="no-drag ml-auto"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            await api('suggestions:refresh').finally(() => setRefreshing(false))
          }}
        >
          <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden /> Look again
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState
            icon={<Inbox />}
            title="All caught up"
            body="Savespace looks for folders, repos, sites and meetings you keep coming back to, and suggests them here as projects. Keep working; new ideas show up within a day or two."
          />
        ) : (
          <ul
            className="mx-auto max-w-2xl space-y-2 px-6 py-5"
            role="listbox"
            aria-label="Project suggestions"
          >
            {items.map((s, i) => (
              <li
                key={s.id}
                role="option"
                aria-selected={i === sel}
                onClick={() => setSel(i)}
                className={cn(
                  'rounded-xl border p-4 transition-colors',
                  i === sel ? 'border-primary/50 bg-selected/40' : 'border-border',
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone="accent">
                    <Sparkles className="size-3" aria-hidden /> New project
                  </Badge>
                  <h2 className="text-[14px] font-semibold">{s.name}</h2>
                </div>
                <ul className="mb-2 flex flex-wrap gap-1">
                  {s.signals.map((g) => (
                    <li
                      key={g}
                      className="selectable rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {pretty(g)}
                    </li>
                  ))}
                </ul>
                <ul className="mb-3 space-y-0.5 text-[12px] text-muted-foreground">
                  {s.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void accept(s)}>
                    <Check aria-hidden /> Confirm{' '}
                    <Kbd className="border-white/30 bg-white/15 text-white">C</Kbd>
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setRenaming(s)}>
                    Rename & confirm <Kbd>E</Kbd>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void dismiss(s)}>
                    <X aria-hidden /> Dismiss <Kbd>X</Kbd>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <PromptDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="Name this project"
        label="Project name"
        initial={renaming?.name ?? ''}
        confirm="Confirm"
        onSubmit={(name) => renaming && void accept(renaming, name)}
      />
    </div>
  )
}
