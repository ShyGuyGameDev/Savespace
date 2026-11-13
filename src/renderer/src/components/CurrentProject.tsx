import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '@/components/ui/button'
import { api, useIpc } from '@/lib/bridge'

export function CurrentProject({ requestHandoff }: { requestHandoff?: () => void }) {
  const context = useIpc('app:currentContext', undefined, { refetchInterval: 3000 })
  const projects = useIpc('projects:list')
  const settings = useIpc('settings:get')
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const active = projects.data?.filter((project) => !project.archived) ?? []
  const current = context.data
  useEffect(() => {
    if (!requestHandoff || !current) return
    setProjectId(current.projectId ?? '')
    setNote('')
    setError('')
    setOpen(true)
    requestHandoff()
  }, [requestHandoff, current])

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 items-center gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground">Current project</span>
          <select
            aria-label="Current project"
            className="min-w-0 max-w-48 rounded-md border border-border bg-background px-2 py-1"
            value={current?.manual ? (current.projectId ?? '') : ''}
            disabled={busy || !context.data}
            onChange={async (event) => {
              setBusy(true)
              setMessage('')
              try {
                await api('app:selectProject', { projectId: event.target.value || null })
                await context.refetch()
              } catch (err) {
                setMessage(String(err))
              } finally {
                setBusy(false)
              }
            }}
          >
            <option value="">
              {current?.projectName && !current.manual
                ? `Auto · ${current.projectName}`
                : settings.data?.captureEnabled === false
                  ? 'Auto · Tracking paused'
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
            setNote('')
            setError('')
            setOpen(true)
          }}
        >
          Leave handoff
        </Button>
      </div>
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
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
              Save a checkpoint with a note about where you stopped or what to do next.
            </Dialog.Description>
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                if (busy || !note.trim()) return
                setBusy(true)
                setError('')
                try {
                  await api('checkpoints:create', {
                    projectId: projectId || null,
                    handoff: note.trim(),
                  })
                  setOpen(false)
                  setMessage('Handoff saved')
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
              <label className="grid gap-1 text-xs">
                Handoff note
                <textarea
                  autoFocus
                  rows={3}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="rounded-md border border-border bg-background p-2 text-sm"
                />
              </label>
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
                <Button type="submit" disabled={busy || !note.trim()}>
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
