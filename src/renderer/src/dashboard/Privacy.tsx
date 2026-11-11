import * as Dialog from '@radix-ui/react-dialog'
import { Check, Download, EyeOff, Lock, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { ExclusionRule } from '@shared/schemas'
import { Button } from '@/components/ui/button'
import { Badge, Card, Input, SectionTitle } from '@/components/ui/misc'
import { api, useIpc } from '@/lib/bridge'
import { relativeTime } from '@/lib/utils'
import { toast } from './toast'

const RULE_LABEL: Record<ExclusionRule['type'], string> = {
  bundleId: 'App (bundle id)',
  urlHost: 'Website',
  pathPrefix: 'Folder',
  titleContains: 'Window title contains',
}

export function Privacy() {
  const perms = useIpc('permissions:status', undefined, { refetchInterval: 4000 })
  const stats = useIpc('privacy:stats')
  const rules = useIpc('exclusions:list')
  const audit = useIpc('privacy:audit', { limit: 200 })
  const [type, setType] = useState<ExclusionRule['type']>('urlHost')
  const [value, setValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const granted = perms.data?.accessibility === 'granted'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="drag flex h-12 shrink-0 items-center gap-3 border-b border-border px-6">
        <h1 className="text-[14px] font-semibold">Privacy</h1>
        <Badge tone="success">
          <Lock className="size-3" aria-hidden /> Encrypted, on this Mac only
        </Badge>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <div className="mx-auto max-w-3xl">
          <SectionTitle>Permissions</SectionTitle>
          <Card className="divide-y divide-border">
            <div className="flex items-center gap-3 p-3">
              <div className="flex-1">
                <p className="text-[13px] font-medium">Accessibility</p>
                <p className="text-[12px] text-muted-foreground">
                  Reads window titles and positions (and moves windows only if Arrange windows is
                  on). Never Screen Recording.
                </p>
              </div>
              {granted ? (
                <Badge tone="success">
                  <Check className="size-3" aria-hidden /> Allowed
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => api('permissions:promptAccessibility')}
                >
                  Allow…
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3 p-3">
              <div className="flex-1">
                <p className="text-[13px] font-medium">Automation</p>
                <p className="text-[12px] text-muted-foreground">
                  Per-app, read-only questions such as “which tabs are open?”.{' '}
                  {Object.entries(perms.data?.automation ?? {})
                    .filter(([, v]) => v !== 'not-determined')
                    .map(([k, v]) => `${k.split('.').pop()}: ${v}`)
                    .join(' · ') || 'No apps asked yet.'}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => api('permissions:openSettings', { pane: 'automation' })}
              >
                Open Settings
              </Button>
            </div>
          </Card>

          <SectionTitle>What Waypoint keeps</SectionTitle>
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <Card className="p-3">
              <p className="mb-1 font-medium text-[13px]">Captured (metadata)</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                <li>App names, window titles and positions</li>
                <li>File/folder paths; editor line numbers</li>
                <li>Tab URLs and titles (secrets stripped)</li>
                <li>Git branch and changed-file count</li>
                <li>Email subjects and Message-IDs</li>
                <li>Note titles, calendar event titles</li>
              </ul>
            </Card>
            <Card className="p-3">
              <p className="mb-1 flex items-center gap-1 font-medium text-[13px]">
                <EyeOff className="size-3.5" aria-hidden /> Never captured
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                <li>Screenshots or screen recordings</li>
                <li>Document, email, note or message text</li>
                <li>Keystrokes or clipboard</li>
                <li>Private / incognito windows</li>
                <li>Password managers and Keychain</li>
                <li>Anything matching your exclusions</li>
              </ul>
            </Card>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            {stats.data && (
              <>
                {stats.data.projects} projects · {stats.data.checkpoints} checkpoints ·{' '}
                {stats.data.events} activity samples
                {stats.data.oldestEventAt
                  ? ` (oldest ${relativeTime(stats.data.oldestEventAt)})`
                  : ''}{' '}
                · stored in <span className="selectable font-mono">{stats.data.dataDir}</span>
              </>
            )}
          </p>

          <SectionTitle>Exclusions</SectionTitle>
          <Card className="p-3">
            <form
              className="mb-3 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!value.trim()) return
                await api('exclusions:add', { type, value: value.trim() })
                setValue('')
                void rules.refetch()
              }}
            >
              <label className="sr-only" htmlFor="rule-type">
                Exclusion type
              </label>
              <select
                id="rule-type"
                value={type}
                onChange={(e) => setType(e.target.value as ExclusionRule['type'])}
                className="h-8 rounded-md border border-border bg-background px-2 text-[13px]"
              >
                {Object.entries(RULE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="rule-value">
                Value
              </label>
              <Input
                id="rule-value"
                placeholder={
                  type === 'urlHost'
                    ? 'bank.example.com'
                    : type === 'pathPrefix'
                      ? '/Users/you/Private'
                      : type === 'bundleId'
                        ? 'com.example.App'
                        : 'Salary'
                }
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <Button type="submit" variant="secondary">
                Add
              </Button>
            </form>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {rules.data
                ?.slice()
                .sort((a, b) => Number(a.builtIn) - Number(b.builtIn))
                .map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded px-1 py-1 text-[12px]">
                    <span className="w-36 shrink-0 text-muted-foreground">
                      {RULE_LABEL[r.type]}
                    </span>
                    <span className="selectable min-w-0 flex-1 truncate font-mono">{r.value}</span>
                    {r.builtIn ? (
                      <Badge>Always</Badge>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove exclusion ${r.value}`}
                        onClick={async () => {
                          await api('exclusions:remove', { id: r.id })
                          void rules.refetch()
                        }}
                      >
                        <X aria-hidden />
                      </Button>
                    )}
                  </li>
                ))}
            </ul>
          </Card>

          <SectionTitle>Activity log</SectionTitle>
          <Card className="max-h-80 overflow-y-auto p-1">
            {audit.data?.length === 0 && (
              <p className="p-3 text-[12px] text-muted-foreground">Nothing yet.</p>
            )}
            <ul>
              {audit.data?.map((a) => (
                <li key={a.id} className="flex gap-3 rounded px-2 py-1.5 text-[12px]">
                  <span className="w-20 shrink-0 text-muted-foreground">{relativeTime(a.at)}</span>
                  <Badge className="w-20 justify-center">{a.action}</Badge>
                  <span className="selectable min-w-0 flex-1">{a.detail}</span>
                </li>
              ))}
            </ul>
          </Card>

          <SectionTitle>Your data</SectionTitle>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={async () =>
                toast(`Exported to ${(await api('privacy:export')).path.split('/').pop()}`)
              }
            >
              <Download aria-hidden /> Export everything (JSON)
            </Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden /> Delete all data…
            </Button>
          </div>
        </div>
      </div>
      <DeleteAllDialog open={confirmDelete} onOpenChange={setConfirmDelete} />
    </div>
  )
}

function DeleteAllDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [text, setText] = useState('')
  return (
    <Dialog.Root open={open} onOpenChange={(o) => (setText(''), onOpenChange(o))}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed left-1/2 top-1/3 z-50 w-[420px] -translate-x-1/2 rounded-xl border border-border bg-background p-5 shadow-2xl">
          <Dialog.Title className="text-[15px] font-semibold">
            Delete all Waypoint data?
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[13px] text-muted-foreground">
            This permanently removes every project, checkpoint, suggestion, activity sample, setting
            and log entry. Your files and other apps are not touched. Type <strong>DELETE</strong>{' '}
            to confirm.
          </Dialog.Description>
          <Input
            className="mt-3"
            aria-label="Type DELETE to confirm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button
              variant="danger"
              disabled={text !== 'DELETE'}
              onClick={async () => {
                await api('privacy:deleteAll', { confirm: 'DELETE' })
                onOpenChange(false)
                toast('All data deleted')
              }}
            >
              Delete everything
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
