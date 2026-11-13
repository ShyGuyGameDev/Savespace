import { HandoffFields, writeHandoff, type Handoff } from './HandoffFields'
import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Toaster, toast } from '@/dashboard/toast'
import { Button } from '@/components/ui/button'
import { api, useIpc } from '@/lib/bridge'

export function CurrentProject({
  requestHandoff,
  compact = false,
}: {
  requestHandoff?: () => void
  compact?: boolean
}) {
  const context = useIpc('app:currentContext', undefined, { refetchInterval: 3000 })
  const projects = useIpc('projects:list')
  const settings = useIpc('settings:get')
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [note, setNote] = useState<Handoff>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = projects.data?.filter((project) => !project.archived) ?? []
  const current = context.data
  useEffect(() => {
    if (!requestHandoff || !current) return
    setProjectId(current.projectId ?? '')
    setNote({})
    setError('')
    setOpen(true)
    requestHandoff()
  }, [requestHandoff, current])

  return (
    <div className="min-w-0">
      <div className={compact ? 'flex flex-wrap items-center gap-2' : 'flex items-center gap-2'}>
        <label className="flex min-w-0 items-center gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground">Current project</span>
          <select
            aria-label="Current project"
            className="min-w-0 max-w-48 rounded-md border border-border bg-background px-2 py-1"
            value={current?.manual ? (current.projectId ?? '') : ''}
            disabled={busy || !context.data}
            onChange={async (event) => {
              setBusy(true)
              try {
                await api('app:selectProject', { projectId: event.target.value || null })
                await context.refetch()
              } catch (err) {
                toast(String(err))
              } finally {
                setBusy(false)
              }
            }}
          >
            <option value="">
              {current?.projectName && !current.manual
                ? `Auto · ${current.projectName}`
                : settings.data?.captureEnabled === false
                  ? 'Auto · Paused'
                  : 'Auto · No project detected'}
            </option>
            {active.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · Selected
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setProjectId(current?.projectId ?? '')
            setNote({})
            setError('')
            setOpen(true)
          }}
        >
          Leave handoff
        </Button>
      </div>
      {compact && <Toaster />}
      <Dialog.Root
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-4 shadow-xl">
            <Dialog.Title className="text-sm font-semibold">Leave a handoff</Dialog.Title>
            <Dialog.Description className="mb-3 text-xs text-muted-foreground">
              Save a checkpoint with the details you want to see when you return.
            </Dialog.Description>
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                if (busy || !writeHandoff(note)) return
                setBusy(true)
                setError('')
                try {
                  await api('checkpoints:create', {
                    projectId: projectId || null,
                    handoff: writeHandoff(note),
                  })
                  setOpen(false)
                  toast('Handoff saved')
                } catch (err) {
                  setError(String(err))
                } finally {
                  setBusy(false)
                }
              }}
            >
              <label className="mb-3 grid gap-1 text-xs">
                Project
                <select
                  className="rounded-md border border-border bg-background p-2"
                  aria-label="Project"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {active.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <HandoffFields value={note} onChange={setNote} />
              {error && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {error}
                </p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" disabled={busy}>
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button type="submit" disabled={busy || !writeHandoff(note)}>
                  {busy ? 'Saving…' : 'Save handoff'}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
