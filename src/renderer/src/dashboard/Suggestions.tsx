import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, GitMerge, Inbox, RefreshCw, Scissors, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Project, Suggestion } from '@shared/schemas'
import { PromptDialog } from '@/components/PromptDialog'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState, Input, Kbd } from '@/components/ui/misc'
import { api, useIpc } from '@/lib/bridge'
import { cn } from '@/lib/utils'
import { toast } from './toast'

const KIND: Record<Suggestion['kind'], { label: string; icon: React.ReactNode }> = {
  'new-project': { label: 'New project', icon: <Sparkles className="size-3" aria-hidden /> },
  merge: { label: 'Merge', icon: <GitMerge className="size-3" aria-hidden /> },
  split: { label: 'Split', icon: <Scissors className="size-3" aria-hidden /> },
}

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
  const projects = useIpc('projects:list')
  const [sel, setSel] = useState(0)
  const [renaming, setRenaming] = useState<Suggestion | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const items = q.data ?? []
  const current = items[sel]

  const accept = async (s: Suggestion, name?: string) => {
    await api('suggestions:accept', { id: s.id, name })
    toast(
      s.kind === 'new-project'
        ? `Created “${name ?? s.name}”`
        : s.kind === 'merge'
          ? 'Projects merged'
          : 'Project split',
    )
  }
  const dismiss = async (s: Suggestion) => {
    await api('suggestions:dismiss', { id: s.id })
  }
  const mergeInto = async (s: Suggestion, target: Project) => {
    // Confirm as a project, then fold it into the chosen one (signals + checkpoints move).
    const before = new Set((await api('projects:list')).map((p) => p.id))
    await api('suggestions:accept', { id: s.id })
    const created = (await api('projects:list')).find((p) => !before.has(p.id))
    if (created) await api('projects:merge', { sourceId: created.id, targetId: target.id })
    toast(`Added to “${target.name}”`)
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
      else if (e.key === 'e' && current.kind === 'new-project') setRenaming(current)
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
            body="Waypoint looks for folders, repos, sites and meetings you keep coming back to, and suggests them here as projects. Keep working; new ideas show up within a day or two."
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
                    {KIND[s.kind].icon} {KIND[s.kind].label}
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
                    <Check aria-hidden />{' '}
                    {s.kind === 'new-project' ? 'Confirm' : s.kind === 'merge' ? 'Merge' : 'Split'}{' '}
                    <Kbd className="border-white/30 bg-white/15 text-white">C</Kbd>
                  </Button>
                  {s.kind === 'new-project' && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setRenaming(s)}>
                        Rename & confirm <Kbd>E</Kbd>
                      </Button>
                      {(projects.data?.length ?? 0) > 0 && (
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild>
                            <Button size="sm" variant="secondary">
                              <GitMerge aria-hidden /> Add to existing…
                            </Button>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content
                              sideOffset={4}
                              className="z-50 min-w-48 rounded-lg border border-border bg-background p-1 shadow-xl"
                            >
                              {projects.data?.map((p) => (
                                <DropdownMenu.Item
                                  key={p.id}
                                  onSelect={() => void mergeInto(s, p)}
                                  className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-selected"
                                >
                                  <span
                                    className="size-2 rounded-full"
                                    style={{ background: p.color }}
                                    aria-hidden
                                  />{' '}
                                  {p.name}
                                </DropdownMenu.Item>
                              ))}
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      )}
                    </>
                  )}
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

/** Manual split: move some of a project's signals (and matching checkpoints) into a new project. */
export function SplitDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  useEffect(() => {
    if (open) {
      setPicked(new Set())
      setName('')
    }
  }, [open])
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content className="fixed left-1/2 top-1/4 z-50 w-[440px] -translate-x-1/2 rounded-xl border border-border bg-background p-5 shadow-2xl">
          <Dialog.Title className="text-[14px] font-semibold">Split “{project.name}”</Dialog.Title>
          <Dialog.Description className="mb-3 text-[12px] text-muted-foreground">
            Choose what moves to the new project. Checkpoints that match those move with them.
          </Dialog.Description>
          {project.signals.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              This project has no signals to split yet.
            </p>
          ) : (
            <ul className="mb-3 max-h-60 space-y-1 overflow-y-auto">
              {project.signals.map((s) => (
                <li key={s}>
                  <label className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      className="accent-[var(--primary)]"
                      checked={picked.has(s)}
                      onChange={() =>
                        setPicked((p) =>
                          p.has(s) ? new Set([...p].filter((x) => x !== s)) : new Set([...p, s]),
                        )
                      }
                    />
                    <span className="selectable">{pretty(s)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <label htmlFor="split-name" className="mb-1 block text-[12px] text-muted-foreground">
            New project name
          </label>
          <Input id="split-name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button
              disabled={!name.trim() || picked.size === 0}
              onClick={async () => {
                await api('projects:split', {
                  id: project.id,
                  newName: name.trim(),
                  signals: [...picked],
                })
                onOpenChange(false)
              }}
            >
              <Scissors aria-hidden /> Split
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
