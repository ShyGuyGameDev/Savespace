import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { Kbd } from '@/components/ui/misc'
import { formatHotkey } from '@/lib/hotkeys'
import { useIpc } from '@/lib/bridge'

export function useShortcutsSheet() {
  const [open, setOpen] = useState(false)
  return { open, setOpen }
}

export function ShortcutsSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const s = useIpc('settings:get')
  const rows: [string, string][] = [
    [formatHotkey(s.data?.hotkeyPalette ?? 'Alt+Command+Space'), 'Command palette (anywhere)'],
    [formatHotkey(s.data?.hotkeyCheckpoint ?? 'Alt+Command+S'), 'Checkpoint now (anywhere)'],
    ['⌘N', 'Checkpoint now'],
    ['J / K', 'Next / previous checkpoint'],
    ['T', 'Jump to the newest checkpoint'],
    ['R', 'Preview restore'],
    ['↵', 'Resume (restore) selected checkpoint'],
    ['G then S', 'Go to Suggestions'],
    ['G then A', 'Go to Apps'],
    ['G then P', 'Go to Privacy'],
    ['⌘,', 'Settings'],
    ['?', 'This list'],
  ]
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-5 shadow-2xl">
          <Dialog.Title className="mb-3 text-[15px] font-semibold">Keyboard shortcuts</Dialog.Title>
          <Dialog.Description className="sr-only">
            All keyboard shortcuts in Waypoint
          </Dialog.Description>
          <dl className="space-y-1.5">
            {rows.map(([k, v]) => (
              <div key={v} className="flex items-center justify-between text-[13px]">
                <dt className="text-muted-foreground">{v}</dt>
                <dd>
                  <Kbd>{k}</Kbd>
                </dd>
              </div>
            ))}
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
