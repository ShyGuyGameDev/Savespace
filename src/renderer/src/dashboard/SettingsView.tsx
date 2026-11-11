import { Cpu, Link2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { SUGGESTED_MODELS, type Settings } from '@shared/constants'
import { Button } from '@/components/ui/button'
import { Badge, Card, Input, Kbd, SectionTitle, Switch } from '@/components/ui/misc'
import { api, useIpc, useIpcMutation } from '@/lib/bridge'
import { formatHotkey } from '@/lib/hotkeys'
import { toast } from './toast'
import { AiDownloadBar, useAiStatus } from '@/components/AiDownload'

function Row({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
  htmlFor?: string
}) {
  return (
    <div className="flex items-center gap-4 p-3">
      <div className="flex-1">
        <label htmlFor={htmlFor} className="text-[13px] font-medium">
          {label}
        </label>
        {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

export function SettingsView() {
  const s = useIpc('settings:get')
  const set = useIpcMutation('settings:set', ['settings:get'])
  const ai = useAiStatus()
  const connectors = useIpc('connectors:status')
  const [testing, setTesting] = useState(false)
  if (!s.data) return null
  const v = s.data
  const patch = (p: Partial<Settings>) => set.mutate(p)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="drag flex h-12 shrink-0 items-center border-b border-border px-6">
        <h1 className="text-[14px] font-semibold">Settings</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <div className="mx-auto max-w-3xl">
          <SectionTitle>Capture</SectionTitle>
          <Card className="divide-y divide-border">
            <Row
              label="Save checkpoints automatically"
              hint="On project switches, when you go idle, at the end of the day, and when your Mac sleeps or locks."
            >
              <Switch
                label="Save checkpoints automatically"
                checked={v.captureEnabled}
                onCheckedChange={(c) => patch({ captureEnabled: c })}
              />
            </Row>
            <Row label="Idle after" hint="Minutes without keyboard or mouse input." htmlFor="idle">
              <Input
                id="idle"
                type="number"
                min={1}
                max={240}
                className="w-20"
                value={v.idleThresholdMin}
                onChange={(e) =>
                  patch({ idleThresholdMin: Math.max(1, Number(e.target.value) || 10) })
                }
              />
            </Row>
            <Row label="End of day" hint="Hour (0–23) for the daily checkpoint." htmlFor="eod">
              <Input
                id="eod"
                type="number"
                min={0}
                max={23}
                className="w-20"
                value={v.endOfDayHour}
                onChange={(e) =>
                  patch({ endOfDayHour: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })
                }
              />
            </Row>
            <Row
              label="Keep activity for"
              hint="Days of raw activity samples used to suggest projects. Checkpoints are kept until you delete them."
              htmlFor="ret"
            >
              <Input
                id="ret"
                type="number"
                min={1}
                max={365}
                className="w-20"
                value={v.activityRetentionDays}
                onChange={(e) =>
                  patch({ activityRetentionDays: Math.max(1, Number(e.target.value) || 14) })
                }
              />
            </Row>
            <Row
              label="Capture Safari tabs"
              hint="Off by default: Safari can’t tell Waypoint which windows are private. Waypoint skips windows whose titles look private, but can’t guarantee it."
            >
              <Switch
                label="Capture Safari tabs"
                checked={v.captureSafariTabs}
                onCheckedChange={(c) => patch({ captureSafariTabs: c })}
              />
            </Row>
          </Card>

          <SectionTitle>Restore</SectionTitle>
          <Card className="divide-y divide-border">
            <Row
              label="Arrange windows"
              hint="Also move and resize windows back to where they were (uses Accessibility). Off: Waypoint never moves windows."
            >
              <Switch
                label="Arrange windows"
                checked={v.arrangeWindows}
                onCheckedChange={(c) => patch({ arrangeWindows: c })}
              />
            </Row>
          </Card>

          <SectionTitle>Keyboard</SectionTitle>
          <Card className="divide-y divide-border">
            <Row
              label="Command palette"
              hint={
                <>
                  Electron accelerator, e.g. <span className="font-mono">Alt+Command+Space</span>
                </>
              }
              htmlFor="hk-p"
            >
              <Kbd>{formatHotkey(v.hotkeyPalette)}</Kbd>
              <Input
                id="hk-p"
                className="w-48"
                defaultValue={v.hotkeyPalette}
                onBlur={(e) =>
                  e.target.value.trim() &&
                  e.target.value !== v.hotkeyPalette &&
                  patch({ hotkeyPalette: e.target.value.trim() })
                }
              />
            </Row>
            <Row label="Checkpoint now" htmlFor="hk-c">
              <Kbd>{formatHotkey(v.hotkeyCheckpoint)}</Kbd>
              <Input
                id="hk-c"
                className="w-48"
                defaultValue={v.hotkeyCheckpoint}
                onBlur={(e) =>
                  e.target.value.trim() &&
                  e.target.value !== v.hotkeyCheckpoint &&
                  patch({ hotkeyCheckpoint: e.target.value.trim() })
                }
              />
            </Row>
          </Card>

          <SectionTitle>Local AI</SectionTitle>
          <Card className="divide-y divide-border">
            <Row
              label="Use local AI for summaries"
              hint="Built into Waypoint and runs only on this Mac. Turning it off stops the AI engine; you’ll get simple summaries."
            >
              <Switch
                label="Use local AI for summaries"
                checked={v.aiEnabled}
                onCheckedChange={(c) => patch({ aiEnabled: c })}
              />
            </Row>
            <div className="p-3">
              <div className="mb-2 flex items-center gap-2">
                <Cpu className="size-4 text-muted-foreground" aria-hidden />
                <p className="text-[13px] font-medium">AI engine</p>
                {!ai.status?.installed ? (
                  <Badge>Not included in this build</Badge>
                ) : !v.aiEnabled ? (
                  <Badge>Off</Badge>
                ) : ai.status.running ? (
                  <Badge tone="success">Running</Badge>
                ) : (
                  <Badge tone="warning">Starting…</Badge>
                )}
                {ai.status?.modelAvailable && v.aiEnabled && (
                  <Badge tone="success">Model ready</Badge>
                )}
                <span className="ml-auto text-[12px] text-muted-foreground">
                  Recommended for {ai.status?.ramGb} GB: {ai.status?.recommendedModel}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="model" className="text-[12px] text-muted-foreground">
                  Model
                </label>
                <select
                  id="model"
                  className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-[13px]"
                  value={v.ollamaModel || ai.status?.recommendedModel || ''}
                  onChange={(e) => patch({ ollamaModel: e.target.value })}
                >
                  {[...new Set([...(ai.status?.models ?? []), ...SUGGESTED_MODELS])].map((m) => (
                    <option key={m} value={m}>
                      {m}
                      {ai.status?.models.includes(m) ? ' (downloaded)' : ''}
                      {m === ai.status?.recommendedModel ? ' (recommended)' : ''}
                    </option>
                  ))}
                </select>
                {v.aiEnabled &&
                  ai.status?.installed &&
                  !ai.status.modelAvailable &&
                  !ai.download?.active && (
                    <Button variant="secondary" onClick={() => void api('ai:download')}>
                      Download
                    </Button>
                  )}
                <Button
                  variant="secondary"
                  disabled={testing || !ai.status?.modelAvailable}
                  onClick={async () => {
                    setTesting(true)
                    const r = await api('ai:test').finally(() => setTesting(false))
                    toast(
                      r.ok ? 'Local AI is working' : 'Used the simple summary (AI not ready yet)',
                    )
                  }}
                >
                  <RefreshCw className={testing ? 'animate-spin' : ''} aria-hidden /> Test
                </Button>
              </div>
              {ai.download && ai.download.status !== 'success' && (
                <div className="mt-3">
                  <AiDownloadBar d={ai.download} />
                </div>
              )}
              <p className="mt-2 text-[12px] text-muted-foreground">
                Choosing a different model downloads it automatically into Waypoint’s own folder.
                Models are stored in{' '}
                <span className="font-mono">~/Library/Application Support/Waypoint/ai</span>.
              </p>
            </div>
          </Card>

          <SectionTitle>Connectors (optional)</SectionTitle>
          <Card className="divide-y divide-border">
            {(connectors.data ?? []).length === 0 && (
              <p className="p-3 text-[12px] text-muted-foreground">
                Waypoint works fully without any connectors.
              </p>
            )}
            {connectors.data?.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-3">
                <Link2 className="size-4 text-muted-foreground" aria-hidden />
                <div className="flex-1">
                  <p className="text-[13px] font-medium">{c.displayName}</p>
                  <p className="text-[12px] text-muted-foreground">
                    Read-only scope: <span className="font-mono">{c.scope}</span>
                    {c.missing ? ` · ${c.missing}` : ''}
                  </p>
                </div>
                {c.connected ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      api('connectors:disconnect', { id: c.id }).then(() => connectors.refetch())
                    }
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!c.configured}
                    onClick={() =>
                      api('connectors:connect', { id: c.id })
                        .then(() => connectors.refetch())
                        .catch((e: Error) => toast(e.message))
                    }
                  >
                    Connect {c.displayName.split(' ')[0]}
                  </Button>
                )}
              </div>
            ))}
          </Card>

          <SectionTitle>Setup</SectionTitle>
          <Button variant="ghost" onClick={() => (window.location.hash = '/onboarding')}>
            Show the welcome & permissions guide again
          </Button>
        </div>
      </div>
    </div>
  )
}
