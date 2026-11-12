import { useEffect, useState } from 'react'
import type { AiDownload } from '@shared/schemas'
import { useIpc } from '@/lib/bridge'

const gb = (n: number) => (n / 1024 ** 3).toFixed(n > 10 * 1024 ** 3 ? 0 : 1)

/** Live AI status + model download progress (pushed from main via `ai:progress`). */
export function useAiStatus() {
  const q = useIpc('ai:status', undefined, { refetchInterval: 4000 })
  const [live, setLive] = useState<AiDownload | null>(null)
  useEffect(
    () =>
      window.savespace.on('ai:progress', (d) => {
        setLive(d)
        if (!d.active) void q.refetch()
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const download = live ?? q.data?.download ?? null
  return { status: q.data, download, refetch: q.refetch }
}

/** Where the model is saved, and where it comes from. */
export function DownloadWhere({ dir }: { dir?: string }) {
  if (!dir) return null
  return (
    <p className="text-[12px] text-muted-foreground">
      Saving to <span className="selectable break-all font-mono text-foreground">{dir}</span> on
      this Mac, downloaded from Ollama’s model library (registry.ollama.ai).
    </p>
  )
}

export function AiDownloadBar({ d, dir }: { d: AiDownload; dir?: string }) {
  const pct = d.total > 0 ? Math.min(100, Math.round((d.completed / d.total) * 100)) : 0
  const label =
    d.status === 'success'
      ? 'Ready'
      : d.error
        ? d.error
        : d.total > 0
          ? `${gb(d.completed)} of ${gb(d.total)} GB · ${pct}%`
          : d.status.replace(/^pulling manifest$/, 'Preparing…')
  return (
    <div className="space-y-1" aria-live="polite">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`Downloading ${d.model}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${d.status === 'success' ? 100 : pct}%` }}
        />
      </div>
      <p className="text-[12px] text-muted-foreground">
        {d.model}: {label}
      </p>
      {d.status !== 'success' && <DownloadWhere dir={dir} />}
    </div>
  )
}
