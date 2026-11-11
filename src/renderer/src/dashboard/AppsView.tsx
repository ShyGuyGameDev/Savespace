import { Badge, Card } from '@/components/ui/misc'
import { useIpc } from '@/lib/bridge'

const TIER: Record<string, { tone: 'success' | 'accent' | 'neutral'; text: string }> = {
  deep: { tone: 'success', text: 'Deep' },
  partial: { tone: 'accent', text: 'Partial' },
  'launch-only': { tone: 'neutral', text: 'Launch only' },
}

export function AppsView() {
  const adapters = useIpc('adapters:list')
  const perms = useIpc('permissions:status')
  const list = [...(adapters.data ?? [])].sort(
    (a, b) =>
      Number(b.installed) - Number(a.installed) || a.displayName.localeCompare(b.displayName),
  )
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="drag flex h-12 shrink-0 items-center gap-3 border-b border-border px-6">
        <h1 className="text-[14px] font-semibold">Apps</h1>
        <p className="text-[12px] text-muted-foreground">
          How deeply Waypoint understands each app. Anything not listed is opened or focused (launch
          only).
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto grid max-w-3xl gap-2">
          {list.map((a) => {
            const auto = a.bundleIds.map((b) => perms.data?.automation[b]).find(Boolean)
            return (
              <Card key={a.id} className={a.installed ? 'p-3' : 'p-3 opacity-60'}>
                <div className="mb-1 flex items-center gap-2">
                  <h2 className="text-[13px] font-semibold">{a.displayName}</h2>
                  <Badge tone={TIER[a.tier]!.tone}>{TIER[a.tier]!.text}</Badge>
                  {!a.installed && <Badge>Not installed</Badge>}
                  {a.installed && a.needsAutomation && auto === 'denied' && (
                    <Badge tone="danger">Automation denied</Badge>
                  )}
                  {a.installed && a.needsAutomation && auto === 'granted' && (
                    <Badge tone="success">Automation allowed</Badge>
                  )}
                </div>
                <p className="text-[12px] leading-relaxed text-muted-foreground">{a.notes}</p>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
