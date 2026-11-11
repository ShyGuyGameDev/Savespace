import {
  Bookmark,
  ChevronDown,
  Clock,
  Cpu,
  MoreHorizontal,
  Pencil,
  Play,
  Sparkles,
  Trash2,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useEffect, useMemo, useState } from 'react'
import type { Checkpoint, Project } from '@shared/schemas'
import { ResourceIcon } from '@/components/ResourceIcon'
import { PromptDialog } from '@/components/PromptDialog'
import { RestorePreviewDialog } from '@/components/RestorePreview'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState, Kbd, Tooltip } from '@/components/ui/misc'
import { api, useIpc } from '@/lib/bridge'
import { formatHotkey } from '@/lib/hotkeys'
import { appName, groupByApp, refLabel } from '@/lib/refs'
import { cn, dayBucket, relativeTime } from '@/lib/utils'
import { toast } from './toast'
import { SplitDialog } from './Suggestions'

const TRIGGER_LABEL: Record<Checkpoint['trigger'], string> = {
  manual: 'Saved by you',
  'project-switch': 'Switched away',
  idle: 'Went idle',
  'end-of-day': 'End of day',
  sleep: 'Mac went to sleep',
  lock: 'Screen locked',
  quit: 'Waypoint quit',
}

export function ProjectView({ route, navigate }: { route: string; navigate: (r: string) => void }) {
  const projectId = /^\/project\/([^/]+)/.exec(route)?.[1] ?? null
  const routeCheckpoint = /\/checkpoint\/([^/]+)/.exec(route)?.[1] ?? null
  const projects = useIpc('projects:list')
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const list = useIpc('checkpoints:list', projectId ? { projectId, limit: 200 } : { limit: 200 })
  const [selected, setSelected] = useState<string | null>(routeCheckpoint)
  const [preview, setPreview] = useState<{ id: string; auto: boolean } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const settings = useIpc('settings:get')

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
        className="flex w-80 shrink-0 flex-col border-r border-border"
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
          {project && (
            <ProjectMenu project={project} onRename={() => setRenaming(true)} navigate={navigate} />
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
                  Waypoint saves one when you switch projects, step away, or at the end of the day.
                  Or press{' '}
                  <Kbd>{formatHotkey(settings.data?.hotkeyCheckpoint ?? 'Alt+Command+S')}</Kbd>{' '}
                  anywhere.
                </>
              }
              action={
                <Button
                  variant="secondary"
                  onClick={() =>
                    api('checkpoints:create', { projectId }).catch((e: Error) => toast(e.message))
                  }
                >
                  <Bookmark aria-hidden /> Save one now
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
      {project && (
        <PromptDialog
          open={renaming}
          onOpenChange={setRenaming}
          title="Rename project"
          label="Project name"
          initial={project.name}
          onSubmit={(name) => void api('projects:rename', { id: project.id, name })}
        />
      )}
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
  const frames = cp.resources.filter((r) => r.kind === 'windowFrame').length
  const project = projects.find((p) => p.id === cp.projectId)
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
          </div>
        </div>

        <section
          aria-labelledby="wywd"
          className="mb-6 rounded-xl border border-border bg-muted/40 p-4"
        >
          <h2
            id="wywd"
            className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            What you were doing
            <Badge tone={cp.summarySource === 'ollama' ? 'accent' : 'neutral'}>
              {cp.summarySource === 'ollama' ? (
                <>
                  <Cpu className="size-3" aria-hidden /> Local AI
                </>
              ) : (
                'Simple summary'
              )}
            </Badge>
          </h2>
          <p className="selectable text-[14px] leading-relaxed">{cp.summary}</p>
          {cp.summarySource === 'template' && ai.data?.installed && !ai.data.modelAvailable && (
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
                  return (
                    <li
                      key={i}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-2',
                        i > 0 && 'border-t border-border',
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
                      {ref.focused && <Badge tone="accent">in focus</Badge>}
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
            onClick={() => api('checkpoints:delete', { id: cp.id })}
          >
            <Trash2 aria-hidden /> Delete checkpoint
          </Button>
        </div>
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
  onRename,
  navigate,
}: {
  project: Project
  onRename: () => void
  navigate: (r: string) => void
}) {
  const projects = useIpc('projects:list')
  const [splitting, setSplitting] = useState(false)
  return (
    <>
      <SplitDialog project={project} open={splitting} onOpenChange={setSplitting} />
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
            <DropdownMenu.Item
              onSelect={onRename}
              className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-selected"
            >
              <Pencil className="size-3.5" aria-hidden /> Rename
            </DropdownMenu.Item>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="cursor-default rounded px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-selected">
                Merge into…
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent className="z-50 min-w-48 rounded-lg border border-border bg-background p-1 shadow-xl">
                  {projects.data
                    ?.filter((p) => p.id !== project.id)
                    .map((p) => (
                      <DropdownMenu.Item
                        key={p.id}
                        onSelect={async () => {
                          await api('projects:merge', { sourceId: project.id, targetId: p.id })
                          navigate(`/project/${p.id}`)
                        }}
                        className="cursor-default rounded px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-selected"
                      >
                        {p.name}
                      </DropdownMenu.Item>
                    ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Item
              onSelect={() => setSplitting(true)}
              className="cursor-default rounded px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-selected"
            >
              Split…
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={async () => {
                await api('projects:archive', { id: project.id, archived: true })
                navigate('/')
              }}
              className="cursor-default rounded px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-selected"
            >
              Archive
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Label className="px-2 py-1 text-[11px] text-muted-foreground">
              Signals: {project.signals.length ? project.signals.join(', ') : 'none yet'}
            </DropdownMenu.Label>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  )
}
