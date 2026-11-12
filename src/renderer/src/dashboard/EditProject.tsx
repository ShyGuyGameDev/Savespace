import * as Dialog from '@radix-ui/react-dialog'
import Fuse from 'fuse.js'
import { AppWindow, ChevronLeft, File, Folder, Globe, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Project, ProjectApp, ProjectItem } from '@shared/schemas'
import { Button } from '@/components/ui/button'
import { Badge, Input, Spinner, Switch } from '@/components/ui/misc'
import { api, useIpc } from '@/lib/bridge'
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

type View = { name: 'main' } | { name: 'pick' } | { name: 'app'; bundleId: string }
type Kind = 'url' | 'folder' | 'file'

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')
const itemKey = (it: ProjectItem) => (it.kind === 'url' ? `url:${it.url}` : `${it.kind}:${it.path}`)

function ItemLabel({ it }: { it: ProjectItem }) {
  const Icon = it.kind === 'url' ? Globe : it.kind === 'folder' ? Folder : File
  const text = it.kind === 'url' ? (it.title ? `${it.title}` : it.url) : home(it.path)
  const sub = it.kind === 'url' && it.title ? it.url : null
  return (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="selectable block truncate">{text}</span>
        {sub && (
          <span className="selectable block truncate text-[11px] text-muted-foreground">{sub}</span>
        )}
      </span>
    </>
  )
}

function summary(a: ProjectApp, kinds: Kind[]): string {
  if (!a.items.length) return kinds.length ? 'Whole app (nothing specific pinned)' : 'Opens the app'
  const n = (k: Kind) => a.items.filter((i) => i.kind === k).length
  const parts = [
    n('url') && `${n('url')} tab${n('url') === 1 ? '' : 's'}`,
    n('folder') && `${n('folder')} folder${n('folder') === 1 ? '' : 's'}`,
    n('file') && `${n('file')} file${n('file') === 1 ? '' : 's'}`,
  ].filter(Boolean)
  return parts.join(', ')
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
  const [apps, setApps] = useState<ProjectApp[]>(project.apps)
  const [onlyApps, setOnlyApps] = useState(project.onlyApps)
  const [view, setView] = useState<View>({ name: 'main' })
  const adapters = useIpc('adapters:list', undefined, { enabled: open })

  useEffect(() => {
    if (!open) return
    setName(project.name)
    setColor(project.color)
    setApps(project.apps)
    setOnlyApps(project.onlyApps)
    setView({ name: 'main' })
  }, [open, project])

  const kindsFor = (bundleId: string): Kind[] =>
    adapters.data?.find((a) => a.bundleIds.includes(bundleId))?.itemKinds ?? []
  const updateApp = (bundleId: string, fn: (a: ProjectApp) => ProjectApp) =>
    setApps((xs) => xs.map((a) => (a.bundleId === bundleId ? fn(a) : a)))

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content className="fixed left-1/2 top-[8%] z-50 flex max-h-[84vh] w-[520px] max-w-[92vw] -translate-x-1/2 flex-col rounded-xl border border-border bg-background p-5 shadow-2xl">
          {view.name === 'main' && (
            <>
              <Dialog.Title className="text-[15px] font-semibold">Edit project</Dialog.Title>
              <Dialog.Description className="mb-4 text-[12px] text-muted-foreground">
                Choose the apps that make up this project. In each app you can pin specific tabs,
                folders or files.
              </Dialog.Description>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <label htmlFor="proj-name" className="mb-1 block text-[12px] font-medium">
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

                <div className="mb-1 mt-4 flex items-center justify-between">
                  <p className="text-[12px] font-medium">Apps</p>
                  <Button size="sm" variant="secondary" onClick={() => setView({ name: 'pick' })}>
                    <Plus aria-hidden /> Add app
                  </Button>
                </div>
                <ul
                  className="space-y-1 rounded-lg border border-border p-1"
                  aria-label="Apps in this project"
                >
                  {apps.length === 0 && (
                    <li className="p-2 text-[12px] text-muted-foreground">
                      No apps yet. Savespace decides what belongs to this project on its own until
                      you add some.
                    </li>
                  )}
                  {apps.map((a) => (
                    <li
                      key={a.bundleId}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-muted/60"
                    >
                      <AppWindow className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setView({ name: 'app', bundleId: a.bundleId })}
                      >
                        <span className="block truncate font-medium">{a.name}</span>
                        <span className="block truncate text-[12px] text-muted-foreground">
                          {summary(a, kindsFor(a.bundleId))}
                        </span>
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setView({ name: 'app', bundleId: a.bundleId })}
                        aria-label={`Edit ${a.name}`}
                      >
                        Edit
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${a.name}`}
                        onClick={() => setApps((xs) => xs.filter((x) => x.bundleId !== a.bundleId))}
                      >
                        <X aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
                {apps.length > 0 && (
                  <div className="mt-3 flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <label htmlFor="only-apps" className="block text-[13px] font-medium">
                        Only restore these apps
                      </label>
                      <p className="mt-0.5 text-[12px] leading-[1.45] text-muted-foreground">
                        {onlyApps
                          ? 'Checkpoints for this project save only the apps above. In an app with pinned items, only those items are saved.'
                          : 'The apps and pinned items above are always saved, along with anything else you were using for this project.'}
                      </p>
                    </div>
                    <Switch
                      id="only-apps"
                      label="Only restore these apps"
                      checked={onlyApps}
                      onCheckedChange={setOnlyApps}
                    />
                  </div>
                )}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button variant="ghost">Cancel</Button>
                </Dialog.Close>
                <Button
                  disabled={!name.trim()}
                  onClick={async () => {
                    await api('projects:update', {
                      id: project.id,
                      name: name.trim(),
                      color,
                      apps,
                      onlyApps,
                    })
                    onOpenChange(false)
                  }}
                >
                  Save
                </Button>
              </div>
            </>
          )}

          {view.name === 'pick' && (
            <AppPicker
              exclude={new Set(apps.map((a) => a.bundleId))}
              supported={
                new Set(
                  adapters.data?.filter((a) => a.itemKinds.length).flatMap((a) => a.bundleIds) ??
                    [],
                )
              }
              onBack={() => setView({ name: 'main' })}
              onPick={(app) => {
                setApps((xs) => [...xs, { bundleId: app.bundleId, name: app.name, items: [] }])
                setView(
                  kindsFor(app.bundleId).length
                    ? { name: 'app', bundleId: app.bundleId }
                    : { name: 'main' },
                )
              }}
            />
          )}

          {view.name === 'app' &&
            (() => {
              const a = apps.find((x) => x.bundleId === view.bundleId)
              if (!a) return null
              return (
                <AppEditor
                  app={a}
                  kinds={kindsFor(a.bundleId)}
                  onBack={() => setView({ name: 'main' })}
                  onChange={(items) => updateApp(a.bundleId, (x) => ({ ...x, items }))}
                />
              )
            })()}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function AppPicker({
  exclude,
  supported,
  onBack,
  onPick,
}: {
  exclude: Set<string>
  supported: Set<string>
  onBack: () => void
  onPick: (a: { bundleId: string; name: string }) => void
}) {
  const installed = useIpc('apps:installed', undefined, { staleTime: 5 * 60_000 })
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const all = (installed.data ?? []).filter((a) => !exclude.has(a.bundleId))
    if (q.trim())
      return new Fuse(all, { keys: ['name'], threshold: 0.35 }).search(q.trim()).map((r) => r.item)
    return [...all].sort(
      (a, b) =>
        Number(supported.has(b.bundleId)) - Number(supported.has(a.bundleId)) ||
        a.name.localeCompare(b.name),
    )
  }, [installed.data, q, exclude, supported])
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Button size="icon" variant="ghost" aria-label="Back" onClick={onBack}>
          <ChevronLeft aria-hidden />
        </Button>
        <Dialog.Title className="text-[15px] font-semibold">Add an app</Dialog.Title>
      </div>
      <Dialog.Description className="sr-only">
        Choose an app to add to this project
      </Dialog.Description>
      <Input
        placeholder="Search your apps"
        aria-label="Search your apps"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <ul
        className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border p-1"
        aria-label="Installed apps"
      >
        {installed.isLoading && (
          <li className="flex items-center gap-2 p-3 text-[12px] text-muted-foreground">
            <Spinner /> Finding your apps…
          </li>
        )}
        {!installed.isLoading && list.length === 0 && (
          <li className="p-3 text-[12px] text-muted-foreground">No matching apps.</li>
        )}
        {list.map((a) => (
          <li key={a.bundleId}>
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted/60 focus-visible:bg-muted/60"
              onClick={() => onPick(a)}
            >
              <AppWindow className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              {supported.has(a.bundleId) && <Badge tone="accent">Can pin items</Badge>}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function AppEditor({
  app,
  kinds,
  onBack,
  onChange,
}: {
  app: ProjectApp
  kinds: Kind[]
  onBack: () => void
  onChange: (items: ProjectItem[]) => void
}) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<ProjectItem[] | null>(null)
  const [loadingOpen, setLoadingOpen] = useState(false)
  const has = new Set(app.items.map(itemKey))
  const add = (items: ProjectItem[]) =>
    onChange([...app.items, ...items.filter((i) => !has.has(itemKey(i)))])

  const addUrl = () => {
    const v = url.trim()
    try {
      const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
      if (!u.hostname.includes('.')) throw new Error('bad host')
      add([{ kind: 'url', url: u.toString() }])
      setUrl('')
      setError(null)
    } catch {
      setError('Enter a web address, like acme.atlassian.net/browse/ATL-212')
    }
  }
  const pick = async (kind: 'folder' | 'file') => {
    const r = await api('dialog:pick', { kind })
    if (r.path) add([{ kind, path: r.path }])
  }
  const loadOpen = async () => {
    setLoadingOpen(true)
    try {
      setOpen(await api('apps:openItems', { bundleId: app.bundleId }))
    } finally {
      setLoadingOpen(false)
    }
  }
  const pinLabel = kinds.includes('url')
    ? 'tabs'
    : kinds.map((k) => (k === 'folder' ? 'folders' : 'files')).join(' and ')

  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <Button size="icon" variant="ghost" aria-label="Back" onClick={onBack}>
          <ChevronLeft aria-hidden />
        </Button>
        <Dialog.Title className="text-[15px] font-semibold">{app.name}</Dialog.Title>
      </div>
      <Dialog.Description className="mb-3 text-[12px] text-muted-foreground">
        {kinds.length
          ? `Pin specific ${pinLabel} to this project. They’re always saved with it and reopen when you resume. Leave empty to include everything you use in ${app.name}.`
          : `${app.name} is part of this project: Savespace opens it when you resume. There’s nothing more specific to pin for this app.`}
      </Dialog.Description>

      {kinds.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <ul
            className="space-y-1 rounded-lg border border-border p-1"
            aria-label={`Pinned in ${app.name}`}
          >
            {app.items.length === 0 && (
              <li className="p-2 text-[12px] text-muted-foreground">Nothing pinned yet.</li>
            )}
            {app.items.map((it) => (
              <li
                key={itemKey(it)}
                className="flex items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-muted/60"
              >
                <ItemLabel it={it} />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove"
                  onClick={() => onChange(app.items.filter((x) => itemKey(x) !== itemKey(it)))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void loadOpen()}
              disabled={loadingOpen}
            >
              {loadingOpen ? <Spinner className="size-3.5" /> : null} Add from what’s open now
            </Button>
            {kinds.includes('folder') && (
              <Button size="sm" variant="secondary" onClick={() => void pick('folder')}>
                <Folder aria-hidden /> Choose folder…
              </Button>
            )}
            {kinds.includes('file') && (
              <Button size="sm" variant="secondary" onClick={() => void pick('file')}>
                <File aria-hidden /> Choose file…
              </Button>
            )}
          </div>

          {kinds.includes('url') && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                addUrl()
              }}
            >
              <label htmlFor="pin-url" className="sr-only">
                Web address
              </label>
              <Input
                id="pin-url"
                placeholder="Paste a web address (tab)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Button type="submit" variant="secondary" disabled={!url.trim()}>
                Add
              </Button>
            </form>
          )}
          {error && (
            <p className="mt-1 text-[12px] text-danger" role="alert">
              {error}
            </p>
          )}

          {open && (
            <div
              className="mt-3 rounded-lg border border-border p-2"
              role="group"
              aria-label={`Open in ${app.name} now`}
            >
              <p className="mb-1 px-1 text-[12px] font-medium">Open in {app.name} now</p>
              {open.length === 0 && (
                <p className="px-1 text-[12px] text-muted-foreground">
                  Nothing open that can be pinned. Open what you need in {app.name} and try again.
                </p>
              )}
              <ul className="space-y-0.5">
                {open.map((it) => {
                  const pinned = has.has(itemKey(it))
                  return (
                    <li key={itemKey(it)}>
                      <label className="flex items-center gap-2 rounded px-1 py-1 text-[13px] hover:bg-muted/60">
                        <input
                          type="checkbox"
                          className="accent-[var(--primary)]"
                          checked={pinned}
                          onChange={() =>
                            pinned
                              ? onChange(app.items.filter((x) => itemKey(x) !== itemKey(it)))
                              : add([it])
                          }
                        />
                        <ItemLabel it={it} />
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <Button onClick={onBack}>Done</Button>
      </div>
    </>
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
