import { Check, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AdapterInfo } from '@shared/schemas'
import { Button } from '@/components/ui/button'
import { Badge, Card, Switch } from '@/components/ui/misc'
import { api, useIpc, useIpcMutation } from '@/lib/bridge'
import { cn } from '@/lib/utils'
import { toast } from './toast'

const TIER: Record<string, { tone: 'success' | 'accent' | 'neutral'; text: string }> = {
  deep: { tone: 'success', text: 'Deep' },
  partial: { tone: 'accent', text: 'Partial' },
  'launch-only': { tone: 'neutral', text: 'Launch only' },
}

export function AppsView() {
  const adapters = useIpc('adapters:list')
  const perms = useIpc('permissions:status')
  const settings = useIpc('settings:get')
  const set = useIpcMutation('settings:set', ['settings:get'])
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({})

  const list = useMemo(
    () =>
      [...(adapters.data ?? [])]
        .filter((a) => showAll || a.installed)
        .sort(
          (a, b) =>
            Number(b.installed) - Number(a.installed) || a.displayName.localeCompare(b.displayName),
        ),
    [adapters.data, showAll],
  )
  const hidden =
    (adapters.data?.length ?? 0) - (adapters.data?.filter((a) => a.installed).length ?? 0)
  if (!settings.data) return null
  const captureOff = new Set(settings.data.appsCaptureOff)
  const restoreOff = new Set(settings.data.appsRestoreOff)

  const toggle = (key: 'appsCaptureOff' | 'appsRestoreOff', id: string, on: boolean) => {
    const cur = new Set(settings.data![key])
    if (on) cur.delete(id)
    else cur.add(id)
    set.mutate({ [key]: [...cur] })
  }

  const ask = async (a: AdapterInfo, bundleId: string) => {
    setBusy(a.id)
    try {
      const r = await api('permissions:requestAutomation', { bundleId })
      if (r.lastRequest)
        setNotes((n) => ({
          ...n,
          [a.id]: { ok: r.lastRequest!.outcome === 'granted', text: r.lastRequest!.message },
        }))
      await perms.refetch()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const openAutomationSettings = (text: string, a: AdapterInfo) => {
    setNotes((n) => ({ ...n, [a.id]: { ok: true, text } }))
    void api('permissions:openSettings', { pane: 'automation' })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="drag flex h-12 shrink-0 items-center gap-3 border-b border-border pl-6 pr-44">
        <h1 className="text-[14px] font-semibold">Apps</h1>
        <p className="text-[12px] text-muted-foreground">
          Choose what Savespace reads and reopens for each app.
        </p>
        {hidden > 0 && (
          <label className="no-drag ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
            <Switch
              label="Show apps that aren’t installed"
              checked={showAll}
              onCheckedChange={setShowAll}
            />
            Show apps that aren’t installed ({hidden})
          </label>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto grid max-w-3xl gap-2">
          {list.map((a) => {
            const appBundles = a.bundleIds.filter((b) => b.includes('.'))
            const target = appBundles[0]
            const state = target ? (perms.data?.automation[target] ?? 'not-determined') : null
            const reading = !captureOff.has(a.id)
            const reopening = !restoreOff.has(a.id)
            const note = notes[a.id]
            return (
              <Card
                key={a.id}
                className={cn('p-3', !a.installed && 'opacity-60')}
                aria-label={a.displayName}
              >
                <div className="mb-1 flex items-center gap-2">
                  <h2 className="text-[13px] font-semibold">{a.displayName}</h2>
                  <Badge tone={TIER[a.tier]!.tone}>{TIER[a.tier]!.text}</Badge>
                  {!a.installed && <Badge>Not installed</Badge>}
                </div>
                <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">{a.notes}</p>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-3 text-[13px]">
                  <label className="flex items-center gap-2">
                    <Switch
                      label={`Save what’s open in ${a.displayName}`}
                      checked={reading}
                      onCheckedChange={(v) => toggle('appsCaptureOff', a.id, v)}
                    />
                    Save what’s open
                  </label>
                  {a.canRestore && (
                    <label className="flex items-center gap-2">
                      <Switch
                        label={`Reopen ${a.displayName} when resuming`}
                        checked={reopening}
                        onCheckedChange={(v) => toggle('appsRestoreOff', a.id, v)}
                      />
                      Reopen when resuming
                    </label>
                  )}

                  {a.needsAutomation && target && a.installed && (
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-[12px] text-muted-foreground">macOS permission:</span>
                      {state === 'granted' ? (
                        <>
                          <Badge tone="success">
                            <Check className="size-3" aria-hidden /> Allowed
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              openAutomationSettings(
                                `In System Settings, under Savespace, turn off ${a.displayName}.`,
                                a,
                              )
                            }
                          >
                            Turn off…
                          </Button>
                        </>
                      ) : state === 'denied' ? (
                        <>
                          <Badge tone="danger">
                            <ShieldAlert className="size-3" aria-hidden /> Off
                          </Badge>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              openAutomationSettings(
                                `In System Settings, under Savespace, turn on ${a.displayName}.`,
                                a,
                              )
                            }
                          >
                            Allow in System Settings…
                          </Button>
                        </>
                      ) : (
                        <>
                          <Badge>Not asked yet</Badge>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy === a.id || !reading}
                            onClick={() => void ask(a, target)}
                          >
                            {busy === a.id ? 'Waiting for your answer…' : 'Allow…'}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {note && (
                  <p
                    className={cn(
                      'mt-2 text-[12px]',
                      note.ok ? 'text-muted-foreground' : 'text-warning',
                    )}
                    role="status"
                  >
                    {note.text}
                  </p>
                )}
                {!reading && (
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    Savespace won’t read {a.displayName} or send it any requests.
                    {a.canRestore && reopening ? ' Items saved earlier can still be reopened.' : ''}
                  </p>
                )}
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
