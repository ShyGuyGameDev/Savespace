import {
  Archive,
  Bookmark,
  ChevronDown,
  Clock,
  Cpu,
  MoreHorizontal,
  Pencil,
  Play,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useEffect, useMemo, useState } from 'react'
import type { Checkpoint, Project } from '@shared/schemas'
import { ProgressRecap } from '@/components/ProgressRecap'
import { ResourceIcon } from '@/components/ResourceIcon'
import { RestorePreviewDialog } from '@/components/RestorePreview'
import { DeleteCheckpointDialog } from '@/components/DeleteCheckpointDialog'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState, Kbd, Spinner, Tooltip } from '@/components/ui/misc'
import { checkpointNow, useCheckpointNow } from '@/lib/checkpoint'
import { api, useIpc } from '@/lib/bridge'
import { formatHotkey } from '@/lib/hotkeys'
import { appName, groupByApp, refLabel } from '@/lib/refs'
import { cn, dayBucket, relativeTime } from '@/lib/utils'
import { toast } from './toast'
import { DeleteProjectDialog, EditProjectDialog } from './EditProject'

const TRIGGER_LABEL: Record<Checkpoint['trigger'], string> = {
  manual: 'Saved by you',
  'project-switch': 'Switched away',
  idle: 'Went idle',
  'end-of-day': 'End of day',
  sleep: 'Mac went to sleep',
  lock: 'Screen locked',
  quit: 'Savespace quit',
}

export function ProjectView({ route, navigate }: { route: string; navigate: (r: string) => void }) {
  const projectId = /^\/project\/([^/]+)/.exec(route)?.[1] ?? null
  const routeCheckpoint = /\/checkpoint\/([^/]+)/.exec(route)?.[1] ?? null
  const projects = useIpc('projects:list')
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const list = useIpc('checkpoints:list', projectId ? { projectId, limit: 200 } : { limit: 200 })
  const [selected, setSelected] = useState<string | null>(routeCheckpoint)
  const [preview, setPreview] = useState<{ id: string; auto: boolean } | null>(null)
  const [editing, setEditing] = useState(false)
  const settings = useIpc('settings:get')
  const { saving } = useCheckpointNow()

  const items = useMemo(() => list.data ?? [], [list.data])
  useEffect(() => {
    if (routeCheckpoint) setSelected(routeCheckpoint)
  }, [routeCheckpoint])
  useEffect(() => {
    if (!items.length) return setSelected(null)
    if (!selected || !items.some((c) => c.id === selected)) setSelected(items[0]!.id)
  }, [items, selected])

  const current = items.find((c) => c.id === selected) ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest('input, textarea, select, [role="dialog"], [role="menu"]')
      )
        return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const idx = items.findIndex((c) => c.id === selected)
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        if (items[idx + 1]) setSelected(items[idx + 1]!.id)
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (idx > 0) setSelected(items[idx - 1]!.id)
      } else if (e.key === 't' && items[0]) setSelected(items[0].id)
      else if (e.key === 'r' && current) setPreview({ id: current.id, auto: false })
      else if (e.key === 'Enter' && current) setPreview({ id: current.id, auto: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, selected, current])

  const grouped = useMemo(() => {
    const g = new Map<string, Checkpoint[]>()
    for (const c of items)
      g.set(dayBucket(c.createdAt), [...(g.get(dayBucket(c.createdAt)) ?? []), c])
    return [...g.entries()]
  }, [items])

  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="Checkpoint timeline"
        className="flex w-[340px] shrink-0 flex-col border-r border-border"
      >
        <header className="drag flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          {project && (
            <span
              className="size-2.5 rounded-full"
              style={{ background: project.color }}
              aria-hidden
            />
          )}
          <h1 className="min-w-0 flex-1 truncate text-[14px] font-semibold">
            {project?.name ?? 'All checkpoints'}
          </h1>
          <Tooltip
            content={
              <>
                {project ? `Save a checkpoint for ${project.name}` : 'Save a checkpoint now'}{' '}
                <Kbd>⌘N</Kbd>
              </>
            }
          >
            <Button
              size="sm"
              variant="secondary"
              className="no-drag shrink-0 px-2 text-[12px] [&_svg]:size-3.5"
              disabled={saving}
              aria-busy={saving}
              onClick={() =>
                void checkpointNow(projectId ?? undefined).catch((e: Error) => toast(e.message))
              }
            >
              {saving ? (
                <Spinner className="size-4" label="Saving checkpoint" />
              ) : (
                <Bookmark aria-hidden />
              )}
              {saving ? 'Saving…' : 'Checkpoint now'}
            </Button>
          </Tooltip>
          {project && (
            <ProjectMenu project={project} onEdit={() => setEditing(true)} navigate={navigate} />
          )}
        </header>
        <div
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
          role="listbox"
          aria-label="Checkpoints"
          aria-activedescendant={selected ? `cp-${selected}` : undefined}
          tabIndex={0}
        >
          {items.length === 0 && !list.isLoading && (
            <EmptyState
              icon={<Clock />}
              title="No checkpoints yet"
              body={
                <>
                  Savespace saves one when you switch projects, step away, or at the end of the day.
                  Or press{' '}
                  <Kbd>{formatHotkey(settings.data?.hotkeyCheckpoint ?? 'Alt+Command+S')}</Kbd>{' '}
                  anywhere.
                </>
              }
              action={
                <Button
                  variant="secondary"
                  disabled={saving}
                  aria-busy={saving}
                  onClick={() =>
                    void checkpointNow(projectId).catch((e: Error) => toast(e.message))
                  }
                >
                  <Bookmark aria-hidden /> {saving ? 'Saving…' : 'Save one now'}
                </Button>
              }
            />
          )}
          {grouped.map(([day, cps]) => (
            <div key={day}>
              <p className="sticky top-0 z-10 bg-background/95 px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                {day}
              </p>
              {cps.map((c) => (
                <TimelineRow
                  key={c.id}
                  cp={c}
                  active={c.id === selected}
                  projects={projects.data ?? []}
                  showProject={!projectId}
                  onSelect={() => setSelected(c.id)}
                />
              ))}
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Checkpoint detail" className="flex min-w-0 flex-1 flex-col">
        <div className="drag h-12 shrink-0 border-b border-border" />
        {current ? (
          <CheckpointDetail
            key={current.id}
            cp={current}
            projects={projects.data ?? []}
            onPreview={(auto) => setPreview({ id: current.id, auto })}
          />
        ) : (
          <EmptyState
            icon={<Sparkles />}
            title={items.length ? 'Select a checkpoint' : 'Nothing to show yet'}
            body="Pick a checkpoint on the left to see what you were doing and what will reopen."
          />
        )}
      </section>

      <RestorePreviewDialog
        checkpointId={preview?.id ?? null}
        autoStart={preview?.auto ?? false}
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
      />
      {project && <EditProjectDialog project={project} open={editing} onOpenChange={setEditing} />}
    </div>
  )
}

function TimelineRow({
  cp,
  active,
  onSelect,
  projects,
  showProject,
}: {
  cp: Checkpoint
  active: boolean
  onSelect: () => void
  projects: Project[]
  showProject: boolean
}) {
  const p = projects.find((x) => x.id === cp.projectId)
  const apps = [
    ...new Set(
      cp.resources
        .filter((r) => r.kind !== 'windowFrame' && r.kind !== 'gitState')
        .map((r) => appName(r.app)),
    ),
  ].slice(0, 3)
  return (
    <div
      id={`cp-${cp.id}`}
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        'mb-0.5 cursor-default rounded-lg px-3 py-2 transition-colors',
        active ? 'bg-selected' : 'hover:bg-muted/60',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium">
          {new Date(cp.createdAt).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
        <span className="text-[12px] text-muted-foreground">{TRIGGER_LABEL[cp.trigger]}</span>
        {showProject && (
          <span className="ml-auto flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            {p ? (
              <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
            ) : null}
            {p?.name ?? 'Unassigned'}
          </span>
        )}
      </div>
      <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{cp.summary}</p>
      {apps.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground/80">{apps.join(' · ')}</p>
      )}
    </div>
  )
}

function CheckpointDetail({
  cp,
  projects,
  onPreview,
}: {
  cp: Checkpoint
  projects: Project[]
  onPreview: (auto: boolean) => void
}) {
  const ai = useIpc('ai:status', undefined, { staleTime: 60_000 })
  const visible = cp.resources.filter((r) => r.kind !== 'windowFrame')
  const groups = groupByApp(visible.map((ref) => ({ ref })))
  const earlier = useIpc(
    'checkpoints:list',
    { projectId: cp.projectId, limit: 30 },
    { enabled: !!cp.projectId && !cp.handoff },
  )
  const earlierHandoff = earlier.data?.find(
    (item) => item.createdAt <= cp.createdAt && item.handoff,
  )
  const focused = visible.filter((ref) => ref.focused && ref.kind !== 'app')
  const frames = cp.resources.filter((r) => r.kind === 'windowFrame').length
  const project = projects.find((p) => p.id === cp.projectId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(cp.summary)
  const [handoff, setHandoff] = useState(cp.handoff ?? '')
  const changes = useIpc(
    'checkpoints:gitChanges',
    { id: cp.id },
    { enabled: cp.resources.some((r) => r.kind === 'gitState') },
  )
  const [removed, setRemoved] = useState<Set<number>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const startEdit = () => {
    setDraft(cp.summary)
    setHandoff(cp.handoff ?? '')
    setRemoved(new Set())
    setEditing(true)
  }
  const save = async () => {
    await api('checkpoints:update', {
      id: cp.id,
      summary: draft.trim() !== cp.summary ? draft.trim() : undefined,
      handoff: handoff.trim() !== (cp.handoff ?? '') ? handoff.trim() : undefined,
      removeItems: removed.size ? [...removed] : undefined,
    })
    setEditing(false)
    toast('Checkpoint updated')
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-6">
        <div className="mb-1 flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>
            {new Date(cp.createdAt).toLocaleString(undefined, {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
          <span>·</span>
          <span>{relativeTime(cp.createdAt)}</span>
          <span>·</span>
          <span>{TRIGGER_LABEL[cp.trigger]}</span>
        </div>
        <div className="mb-5 flex items-center gap-2">
          <ReassignMenu cp={cp} projects={projects} current={project} />
          <div className="ml-auto flex gap-2">
            {editing ? (
              <>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void save()} disabled={!draft.trim()}>
                  Save changes
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={startEdit} aria-label="Edit checkpoint">
                  <Pencil aria-hidden /> Edit
                </Button>
                <Tooltip
                  content={
                    <>
                      See exactly what will open <Kbd>R</Kbd>
                    </>
                  }
                >
                  <Button variant="secondary" onClick={() => onPreview(false)}>
                    Preview restore
                  </Button>
                </Tooltip>
                <Tooltip
                  content={
                    <>
                      Reopen everything <Kbd>↵</Kbd>
                    </>
                  }
                >
                  <Button onClick={() => onPreview(true)}>
                    <Play aria-hidden /> Resume
                  </Button>
                </Tooltip>
              </>
            )}
          </div>
        </div>

        {(cp.handoff || earlierHandoff || editing) && (
          <section className="mb-4 rounded-xl border border-border p-4">
            <h2 className="mb-1 text-[13px] font-semibold">
              {cp.handoff || editing ? 'Your handoff' : 'Earlier handoff'}
            </h2>
            {editing ? (
              <textarea
                aria-label="Your handoff"
                value={handoff}
                maxLength={1000}
                rows={2}
                onChange={(e) => setHandoff(e.target.value)}
                className="w-full rounded-md border border-border bg-background p-2 text-sm"
              />
            ) : (
              <p className="selectable whitespace-pre-wrap break-words text-sm">
                {cp.handoff ?? earlierHandoff?.handoff}
              </p>
            )}
          </section>
        )}
        <ProgressRecap checkpoint={cp} />
        {!!focused.length && (
          <section className="mb-4 rounded-xl border border-border p-4">
            <h2 className="mb-1 text-[13px] font-semibold">In focus when saved</h2>
            <ul className="space-y-1 text-sm">
              {focused.slice(0, 4).map((ref, index) => (
                <li key={index} className="flex min-w-0 items-center gap-2">
                  <ResourceIcon kind={ref.kind} />
                  <span className="truncate" title={refLabel(ref).secondary}>
                    {refLabel(ref).primary}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!!changes.data?.length && (
          <section className="mb-4 rounded-xl border border-border p-4">
            <h2 className="mb-1 text-[13px] font-semibold">
              Local Git changes since this checkpoint
            </h2>
            <ul className="space-y-1 text-sm">
              {changes.data.map(
                ({ repoPath, before, now }) =>
                  before.kind === 'gitState' &&
                  now.kind === 'gitState' && (
                    <li key={repoPath} title={repoPath}>
                      {repoPath.split('/').pop()} · {before.branch} → {now.branch} ·{' '}
                      {before.dirtyFiles ?? 0} → {now.dirtyFiles ?? 0} changed files
                      {before.head &&
                        now.head &&
                        before.head !== now.head &&
                        ` · Commit ${before.head.slice(0, 7)} → ${now.head.slice(0, 7)}`}
                      {(before.ahead !== now.ahead || before.behind !== now.behind) &&
                        ` · Upstream: ${before.ahead ?? '?'} ahead / ${before.behind ?? '?'} behind → ${now.ahead ?? '?'} ahead / ${now.behind ?? '?'} behind`}
                    </li>
                  ),
              )}
            </ul>
          </section>
        )}
        <section
          aria-labelledby="wywd"
          className="mb-6 rounded-xl border border-border bg-muted/40 p-4"
        >
          <h2
            id="wywd"
            className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            What you were doing
            <Badge tone={cp.summarySource === 'template' ? 'neutral' : 'accent'}>
              {cp.summarySource === 'apple' ? (
                <>
                  <Cpu className="size-3" aria-hidden /> Apple on-device AI
                </>
              ) : cp.summarySource === 'ollama' ? (
                <>
                  <Cpu className="size-3" aria-hidden /> Local AI
                </>
              ) : (
                'Simple summary'
              )}
            </Badge>
          </h2>
          {editing ? (
            <textarea
              aria-label="What you were doing"
              value={draft}
              maxLength={2000}
              rows={4}
              onChange={(e) => setDraft(e.target.value)}
              className="selectable w-full resize-y rounded-md border border-border bg-background p-2 text-[14px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          ) : (
            <p className="selectable text-[14px] leading-relaxed">{cp.summary}</p>
          )}
          {cp.summarySource === 'template' &&
            ai.data?.activeSource === 'template' &&
            ai.data.download?.active && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                Richer recaps start once the built-in AI model finishes downloading (
                <a href="#/settings" className="text-primary underline-offset-2 hover:underline">
                  see progress
                </a>
                ).
              </p>
            )}
        </section>

        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Saved items{' '}
          <span className="font-normal normal-case">
            ({visible.length}
            {frames ? `, plus ${frames} window position${frames === 1 ? '' : 's'}` : ''})
          </span>
        </h2>
        {groups.length === 0 && (
          <p className="text-muted-foreground">No items were captured in this checkpoint.</p>
        )}
        <div className="space-y-4">
          {groups.map(([app, rows]) => (
            <section key={app}>
              <h3 className="mb-1 px-1 text-[13px] font-medium">{appName(app)}</h3>
              <ul className="rounded-lg border border-border">
                {rows.map(({ ref }, i) => {
                  const l = refLabel(ref)
                  const idx = cp.resources.indexOf(ref)
                  const gone = removed.has(idx)
                  return (
                    <li
                      key={i}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-2',
                        i > 0 && 'border-t border-border',
                        gone && 'opacity-50 [&_p]:line-through',
                      )}
                    >
                      <ResourceIcon kind={ref.kind} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px]">{l.primary}</p>
                        {l.secondary && (
                          <p className="selectable truncate text-[12px] text-muted-foreground">
                            {l.secondary}
                          </p>
                        )}
                      </div>
                      {ref.focused && !editing && <Badge tone="accent">in focus</Badge>}
                      {editing && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={gone ? `Keep ${l.primary}` : `Remove ${l.primary}`}
                          onClick={() =>
                            setRemoved((r) => {
                              const n = new Set(r)
                              if (n.has(idx)) n.delete(idx)
                              else n.add(idx)
                              return n
                            })
                          }
                        >
                          {gone ? 'Undo' : <X aria-hidden />}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
        <div className="mt-8 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden /> Delete checkpoint
          </Button>
        </div>
        <DeleteCheckpointDialog
          cp={cp}
          project={project}
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          onDeleted={() => toast('Checkpoint deleted')}
        />
      </div>
    </div>
  )
}

function ReassignMenu({
  cp,
  projects,
  current,
}: {
  cp: Checkpoint
  projects: Project[]
  current?: Project
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Change which project this checkpoint belongs to"
        >
          {current ? (
            <span
              className="size-2.5 rounded-full"
              style={{ background: current.color }}
              aria-hidden
            />
          ) : null}
          {current?.name ?? 'Unassigned'} <ChevronDown aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          className="z-50 min-w-48 rounded-lg border border-border bg-background p-1 shadow-xl"
        >
          <DropdownMenu.Label className="px-2 py-1 text-[11px] text-muted-foreground">
            Belongs to project
          </DropdownMenu.Label>
          {projects.map((p) => (
            <DropdownMenu.Item
              key={p.id}
              onSelect={() => void api('checkpoints:reassign', { id: cp.id, projectId: p.id })}
              className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-selected"
            >
              <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
              {p.name}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() => void api('checkpoints:reassign', { id: cp.id, projectId: null })}
            className="cursor-default rounded px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-selected"
          >
            Unassigned
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ProjectMenu({
  project,
  onEdit,
  navigate,
}: {
  project: Project
  onEdit: () => void
  navigate: (r: string) => void
}) {
  const [deleting, setDeleting] = useState(false)
  const item =
    'flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-selected'
  return (
    <>
      <DeleteProjectDialog
        project={project}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => navigate('/')}
      />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="no-drag"
            aria-label={`${project.name} options`}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-52 rounded-lg border border-border bg-background p-1 shadow-xl"
          >
            <DropdownMenu.Item onSelect={onEdit} className={item}>
              <Pencil className="size-3.5" aria-hidden /> Edit project…
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={async () => {
                await api('projects:archive', { id: project.id, archived: true })
                navigate('/')
              }}
              className={item}
            >
              <Archive className="size-3.5" aria-hidden /> Archive
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item onSelect={() => setDeleting(true)} className={`${item} text-danger`}>
              <Trash2 className="size-3.5" aria-hidden /> Delete project…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  )
}
