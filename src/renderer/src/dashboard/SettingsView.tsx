import { Cpu, Link2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { SUGGESTED_MODELS, type Settings } from '@shared/constants'
import { Button } from '@/components/ui/button'
import { Badge, Card, Input, Kbd, SectionTitle, Switch } from '@/components/ui/misc'
import { api, useIpc, useIpcMutation } from '@/lib/bridge'
import { formatHotkey } from '@/lib/hotkeys'
import { toast } from './toast'

const APPLE_REASONS: Record<string, string> = {
  deviceNotEligible: 'This Mac doesn’t support Apple Intelligence.',
  appleIntelligenceNotEnabled:
    'Apple Intelligence is off. Turn it on in System Settings → Apple Intelligence & Siri.',
  modelNotReady:
    'macOS is still downloading Apple’s model. It will be used automatically when ready.',
  osTooOld: 'Needs macOS 26 or later.',
  notBundled: 'Not included in this build.',
}
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
              hint="Off by default: Safari can’t tell Savespace which windows are private. Savespace skips windows whose titles look private, but can’t guarantee it."
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
              hint="Also move and resize windows back to where they were (uses Accessibility). Off: Savespace never moves windows."
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
              hint="Runs only on this Mac. Turn off to get simple summaries."
            >
              <Switch
                label="Use local AI for summaries"
                checked={v.aiEnabled}
                onCheckedChange={(c) => patch({ aiEnabled: c })}
              />
            </Row>
            <Row
              label="AI source"
              hint="Automatic uses Apple’s on-device AI when this Mac has it, otherwise a small downloaded model."
              htmlFor="ai-source"
            >
              <select
                id="ai-source"
                className="h-8 rounded-md border border-border bg-background px-2 text-[13px]"
                value={v.aiProvider}
                disabled={!v.aiEnabled}
                onChange={(e) => patch({ aiProvider: e.target.value as Settings['aiProvider'] })}
              >
                <option value="auto">Automatic (recommended)</option>
                <option value="apple">Apple on-device AI only</option>
                <option value="downloaded">Downloaded model only</option>
              </select>
            </Row>
            <div className="space-y-3 p-3 text-[13px]">
              <p className="flex items-center gap-2">
                <Cpu className="size-4 text-muted-foreground" aria-hidden />
                <span className="font-medium">Now using:</span>
                <Badge tone={ai.status?.activeSource === 'template' ? 'neutral' : 'success'}>
                  {ai.status?.activeSource === 'apple'
                    ? 'Apple on-device AI'
                    : ai.status?.activeSource === 'ollama'
                      ? `Downloaded model (${ai.status.selectedModel})`
                      : 'Simple summaries'}
                </Badge>
              </p>
              <div>
                <p className="font-medium">Apple on-device AI</p>
                <p className="text-[12px] text-muted-foreground">
                  {ai.status?.apple.available
                    ? 'Available on this Mac. Nothing to download.'
                    : (APPLE_REASONS[ai.status?.apple.reason ?? ''] ??
                      'Not available on this Mac.')}
                </p>
              </div>
              {v.aiProvider !== 'apple' && (
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">Downloaded model</p>
                    {ai.status?.modelAvailable ? (
                      <Badge tone="success">Downloaded</Badge>
                    ) : ai.status?.apple.available && v.aiProvider === 'auto' ? (
                      <Badge>Not needed</Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <label htmlFor="model" className="sr-only">
                      Model
                    </label>
                    <select
                      id="model"
                      className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-[13px]"
                      value={v.ollamaModel || ai.status?.recommendedModel || ''}
                      disabled={!v.aiEnabled}
                      onChange={(e) => patch({ ollamaModel: e.target.value })}
                    >
                      {[...new Set([...(ai.status?.models ?? []), ...SUGGESTED_MODELS])].map(
                        (m) => (
                          <option key={m} value={m}>
                            {m}
                            {ai.status?.models.includes(m) ? ' (downloaded)' : ''}
                            {m === ai.status?.recommendedModel ? ' (default, ~2 GB)' : ' (larger)'}
                          </option>
                        ),
                      )}
                    </select>
                    {v.aiEnabled &&
                      ai.status?.installed &&
                      !ai.status.modelAvailable &&
                      !ai.download?.active &&
                      !(ai.status.apple.available && v.aiProvider === 'auto') && (
                        <Button variant="secondary" onClick={() => void api('ai:download')}>
                          Download
                        </Button>
                      )}
                  </div>
                  {ai.download && ai.download.status !== 'success' && (
                    <div className="mt-2">
                      <AiDownloadBar d={ai.download} />
                    </div>
                  )}
                </div>
              )}
              <Button
                variant="secondary"
                disabled={testing || !v.aiEnabled}
                onClick={async () => {
                  setTesting(true)
                  const r = await api('ai:test').finally(() => setTesting(false))
                  toast(
                    r.source === 'apple'
                      ? 'Apple on-device AI is working'
                      : r.source === 'ollama'
                        ? 'Downloaded model is working'
                        : 'Used a simple summary (AI not ready yet)',
                  )
                }}
              >
                <RefreshCw className={testing ? 'animate-spin' : ''} aria-hidden /> Test
              </Button>
            </div>
          </Card>

          <SectionTitle>Connectors (optional)</SectionTitle>
          <Card className="divide-y divide-border">
            {(connectors.data ?? []).length === 0 && (
              <p className="p-3 text-[12px] text-muted-foreground">
                Savespace works fully without any connectors.
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
