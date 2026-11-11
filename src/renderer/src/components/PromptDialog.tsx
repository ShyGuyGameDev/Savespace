import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/misc'

/** Accessible replacement for window.prompt (which Electron doesn't support). */
export function PromptDialog({
  open,
  onOpenChange,
  title,
  label,
  initial = '',
  confirm = 'Save',
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  label: string
  initial?: string
  confirm?: string
  onSubmit: (v: string) => void
}) {
  const [v, setV] = useState(initial)
  useEffect(() => {
    if (open) setV(initial)
  }, [open, initial])
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content className="fixed left-1/2 top-1/3 z-50 w-[380px] -translate-x-1/2 rounded-xl border border-border bg-background p-4 shadow-2xl">
          <Dialog.Title className="mb-3 text-[14px] font-semibold">{title}</Dialog.Title>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (v.trim()) {
                onSubmit(v.trim())
                onOpenChange(false)
              }
            }}
          >
            <label className="mb-1 block text-[12px] text-muted-foreground" htmlFor="prompt-input">
              {label}
            </label>
            <Input
              id="prompt-input"
              autoFocus
              value={v}
              onChange={(e) => setV(e.target.value)}
              maxLength={120}
            />
            <div className="mt-3 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost" type="button">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={!v.trim()}>
                {confirm}
              </Button>
            </div>
          </form>
          <Dialog.Description className="sr-only">{label}</Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
