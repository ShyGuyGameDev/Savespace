import { Boxes, Inbox, Plus, Settings, Shield } from 'lucide-react'
import { APP_NAME } from '@shared/constants'
import { Badge } from '@/components/ui/misc'
import { api, useIpc } from '@/lib/bridge'
import { cn, relativeTime } from '@/lib/utils'
import { useState } from 'react'
import { PromptDialog } from '@/components/PromptDialog'

function NavItem({
  active,
  onClick,
  icon,
  label,
  right,
  color,
}: {
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  label: string
  right?: React.ReactNode
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'no-drag flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
        active
          ? 'bg-selected font-medium text-foreground'
          : 'text-foreground/85 hover:bg-black/5 dark:hover:bg-white/5',
      )}
    >
      {color ? (
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: color }}
          aria-hidden
        />
      ) : (
        <span className="text-muted-foreground [&_svg]:size-4" aria-hidden>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {right}
    </button>
  )
}

export function Sidebar({ route, navigate }: { route: string; navigate: (r: string) => void }) {
  const projects = useIpc('projects:list')
  const suggestions = useIpc('suggestions:list')
  const ctx = useIpc('app:currentContext', undefined, { refetchInterval: 30_000 })
  const settings = useIpc('settings:get')
  const pending = suggestions.data?.length ?? 0
  const [naming, setNaming] = useState(false)

  return (
    <nav
      aria-label="Projects and sections"
      className="drag flex w-60 shrink-0 flex-col border-r border-border bg-transparent px-2 pb-3 pt-11"
    >
      <div className="no-drag min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Projects
        </p>
        {projects.data?.length === 0 && (
          <p className="px-2 py-1 text-[12px] text-muted-foreground">
            None yet. {APP_NAME} will suggest some as you work.
          </p>
        )}
        {projects.data?.map((p) => (
          <NavItem
            key={p.id}
            active={route === `/project/${p.id}` || route.startsWith(`/project/${p.id}/`)}
            onClick={() => navigate(`/project/${p.id}`)}
            color={p.color}
            label={p.name}
            right={
              <span className="text-[11px] text-muted-foreground">
                {p.lastCheckpointAt ? relativeTime(p.lastCheckpointAt) : ''}
              </span>
            }
          />
        ))}
        <NavItem
          active={route === '/' || route === '/unassigned'}
          onClick={() => navigate('/')}
          icon={<Boxes />}
          label="All checkpoints"
        />
        <NavItem
          active={route.startsWith('/project/new')}
          onClick={() => setNaming(true)}
          icon={<Plus />}
          label="New project"
        />

        <p className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Savespace
        </p>
        <NavItem
          active={route.startsWith('/suggestions')}
          onClick={() => navigate('/suggestions')}
          icon={<Inbox />}
          label="Suggestions"
          right={pending ? <Badge tone="accent">{pending}</Badge> : undefined}
        />
        <NavItem
          active={route.startsWith('/apps')}
          onClick={() => navigate('/apps')}
          icon={<Boxes />}
          label="Apps"
        />
        <NavItem
          active={route.startsWith('/privacy')}
          onClick={() => navigate('/privacy')}
          icon={<Shield />}
          label="Privacy"
        />
        <NavItem
          active={route.startsWith('/settings')}
          onClick={() => navigate('/settings')}
          icon={<Settings />}
          label="Settings"
        />
      </div>

      {settings.data?.captureEnabled && ctx.data?.projectName && (
        <p
          className="no-drag mt-2 truncate px-2 py-2 text-[12px] text-muted-foreground"
          aria-live="polite"
        >
          Now: {ctx.data.projectName}
        </p>
      )}
      <PromptDialog
        open={naming}
        onOpenChange={setNaming}
        title="New project"
        label="Project name"
        confirm="Create"
        onSubmit={async (name) => {
          const p = await api('projects:create', { name })
          navigate(`/project/${p.id}`)
        }}
      />
    </nav>
  )
}
