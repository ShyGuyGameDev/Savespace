import * as Dialog from '@radix-ui/react-dialog'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Checkpoint, Project } from '@shared/schemas'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/misc'
import { api } from '@/lib/bridge'
import { relativeTime } from '@/lib/utils'

/**
 * Confirmation before a checkpoint is deleted. It shows which checkpoint is going and says plainly
 * that only Savespace's saved snapshot is removed (files, tabs and apps are never touched).
 * Cancel has focus by default, so pressing Return by accident doesn't delete anything.
 */
export function DeleteCheckpointDialog({
  cp,
  project,
  open,
  onOpenChange,
  onDeleted,
}: {
  cp: Checkpoint
  project?: Project
  open: boolean
  onOpenChange: (o: boolean) => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const items = cp.resources.filter((r) => r.kind !== 'windowFrame' && r.kind !== 'gitState').length
  const when = new Date(cp.createdAt).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        setError(null)
        onOpenChange(o)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" />
        <Dialog.Content
          className="dialog-pop fixed left-1/2 top-1/3 z-50 w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-2xl border border-border bg-background p-5 shadow-2xl"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-cancel]')?.focus()
          }}
        >
          <div className="flex gap-3.5">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger/12 text-danger"
              aria-hidden
            >
              <Trash2 className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-semibold leading-6">
                Delete this checkpoint?
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
                You won’t be able to restore it afterwards. Your files, tabs and apps stay exactly
                as they are. Only the saved snapshot is removed.
              </Dialog.Description>
            </div>
          </div>

          <div
            className="mt-4 rounded-xl border border-border bg-muted/40 px-3.5 py-3"
            aria-label="Checkpoint to delete"
          >
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              {project && (
                <>
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: project.color }}
                    aria-hidden
                  />
                  <span className="truncate font-medium text-foreground">{project.name}</span>
                  <span aria-hidden>·</span>
                </>
              )}
              <span className="shrink-0">{when}</span>
              <span aria-hidden>·</span>
              <span className="shrink-0">{relativeTime(cp.createdAt)}</span>
            </div>
            {cp.summary && (
              <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-foreground">
                {cp.summary}
              </p>
            )}
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              {items === 1 ? '1 saved item' : `${items} saved items`}
            </p>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-[12px] text-danger">
              {error}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost" data-cancel disabled={busy}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              variant="danger"
              disabled={busy}
              aria-busy={busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await api('checkpoints:delete', { id: cp.id })
                  setBusy(false)
                  onOpenChange(false)
                  onDeleted()
                } catch (e) {
                  setBusy(false)
                  setError((e as Error).message || 'Couldn’t delete the checkpoint. Try again.')
                }
              }}
            >
              {busy ? (
                <Spinner className="size-4" label="Deleting checkpoint" />
              ) : (
                <Trash2 aria-hidden />
              )}
              {busy ? 'Deleting…' : 'Delete checkpoint'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
