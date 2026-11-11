import * as Dialog from '@radix-ui/react-dialog'
import { Folder, Globe, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Project } from '@shared/schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/misc'
import { api } from '@/lib/bridge'
import { cn } from '@/lib/utils'

const COLORS = [
  '#4b86ff',
  '#22a06b',
  '#e5793b',
  '#a35ce8',
  '#d9488b',
  '#1aa0b5',
  '#c99a16',
  '#6a7bd8',
]

/** Shows a signal ("repo:/Users/me/code/atlas", "host:acme.dev") in plain words. */
export function describeSignal(s: string): { icon: 'folder' | 'web' | 'other'; text: string } {
  const i = s.indexOf(':')
  const kind = s.slice(0, i)
  const v = s.slice(i + 1).replace(/^\/Users\/[^/]+/, '~')
  if (kind === 'repo') return { icon: 'folder', text: `${v} (code repository)` }
  if (kind === 'path') return { icon: 'folder', text: v }
  if (kind === 'host') return { icon: 'web', text: v }
  if (kind === 'cal') return { icon: 'other', text: `Calendar events named “${v}”` }
  return { icon: 'other', text: `Window titles containing “${v}”` }
}

/** Turns what the user typed into a signal: a folder path or a website. */
export function toSignal(input: string): string | null {
  const v = input.trim()
  if (!v) return null
  if (v.startsWith('/') || v.startsWith('~/')) return `path:${v.replace(/\/$/, '')}`
  try {
    const host = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.replace(
      /^www\./,
      '',
    )
    return host.includes('.') ? `host:${host}` : null
  } catch {
    return null
  }
}

export function EditProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [name, setName] = useState(project.name)
  const [color, setColor] = useState(project.color)
  const [signals, setSignals] = useState<string[]>(project.signals)
  const [adding, setAdding] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(project.name)
    setColor(project.color)
    setSignals(project.signals)
    setAdding('')
    setError(null)
  }, [open, project])

  const add = () => {
    const sig = toSignal(adding)
    if (!sig)
      return setError('Enter a folder (starting with / or ~/) or a website like acme.atlassian.net')
    setSignals((s) => [...new Set([...s, sig])])
    setAdding('')
    setError(null)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content className="fixed left-1/2 top-[12%] z-50 flex max-h-[80vh] w-[480px] max-w-[92vw] -translate-x-1/2 flex-col rounded-xl border border-border bg-background p-5 shadow-2xl">
          <Dialog.Title className="text-[15px] font-semibold">Edit project</Dialog.Title>
          <Dialog.Description className="mb-4 text-[12px] text-muted-foreground">
            Savespace uses “What belongs to this project” to recognise when you’re working on it and
            what to save.
          </Dialog.Description>

          <label htmlFor="proj-name" className="mb-1 text-[12px] font-medium">
            Name
          </label>
          <Input
            id="proj-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />

          <p className="mb-1 mt-4 text-[12px] font-medium" id="proj-color">
            Colour
          </p>
          <div className="flex gap-2" role="radiogroup" aria-labelledby="proj-color">
            {COLORS.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={color === c}
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                className={cn(
                  'size-6 rounded-full ring-offset-2 ring-offset-background',
                  color === c && 'ring-2 ring-ring',
                )}
                style={{ background: c }}
              />
            ))}
          </div>

          <p className="mb-1 mt-4 text-[12px] font-medium">What belongs to this project</p>
          <ul
            className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-lg border border-border p-1"
            aria-label="What belongs to this project"
          >
            {signals.length === 0 && (
              <li className="p-2 text-[12px] text-muted-foreground">
                Nothing yet. Add a folder or website below.
              </li>
            )}
            {signals.map((s) => {
              const d = describeSignal(s)
              return (
                <li
                  key={s}
                  className="flex items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-muted/60"
                >
                  {d.icon === 'folder' ? (
                    <Folder className="size-3.5 text-muted-foreground" aria-hidden />
                  ) : (
                    <Globe className="size-3.5 text-muted-foreground" aria-hidden />
                  )}
                  <span className="selectable min-w-0 flex-1 truncate">{d.text}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${d.text}`}
                    onClick={() => setSignals((x) => x.filter((y) => y !== s))}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              )
            })}
          </ul>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              add()
            }}
          >
            <label htmlFor="proj-add" className="sr-only">
              Add a folder or website
            </label>
            <Input
              id="proj-add"
              placeholder="Add a folder (~/code/atlas) or website (acme.atlassian.net)"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={!adding.trim()}>
              Add
            </Button>
          </form>
          {error && (
            <p className="mt-1 text-[12px] text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button
              disabled={!name.trim()}
              onClick={async () => {
                const home = await api('app:info').then(
                  (i) => i.dataDir.split('/Library/')[0] ?? '',
                )
                const expanded = signals.map((s) => s.replace(/^path:~/, `path:${home}`))
                await api('projects:update', {
                  id: project.id,
                  name: name.trim(),
                  color,
                  signals: expanded,
                })
                onOpenChange(false)
              }}
            >
              Save
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: {
  project: Project
  open: boolean
  onOpenChange: (o: boolean) => void
  onDeleted: () => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/25" />
        <Dialog.Content className="fixed left-1/2 top-1/3 z-50 w-[400px] -translate-x-1/2 rounded-xl border border-border bg-background p-5 shadow-2xl">
          <Dialog.Title className="text-[15px] font-semibold">
            Delete “{project.name}”?
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[13px] text-muted-foreground">
            The project is removed. Its checkpoints are kept and move to “All checkpoints” as
            unassigned. Your files and apps are not touched.
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button
              variant="danger"
              onClick={async () => {
                await api('projects:delete', { id: project.id })
                onOpenChange(false)
                onDeleted()
              }}
            >
              Delete project
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
