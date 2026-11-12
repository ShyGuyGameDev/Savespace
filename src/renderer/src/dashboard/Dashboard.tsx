import { Toaster, toast } from './toast'
import { useEffect, useRef } from 'react'
import { Sidebar } from './Sidebar'
import { ProjectView } from './ProjectView'
import { Suggestions } from './Suggestions'
import { AppsView } from './AppsView'
import { Privacy } from './Privacy'
import { SettingsView } from './SettingsView'
import { ShortcutsSheet, useShortcutsSheet } from './ShortcutsSheet'
import { checkpointNow } from '@/lib/checkpoint'

export type Navigate = (r: string) => void

export function Dashboard({ route, navigate }: { route: string; navigate: Navigate }) {
  const sheet = useShortcutsSheet()
  const pendingG = useRef(false)

  useEffect(() => {
    const off = window.savespace.on('checkpoint:created', ({ projectName }) =>
      toast(projectName ? `Checkpoint saved for ${projectName}` : 'Checkpoint saved'),
    )
    return off
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return
      if (e.key === '?') return sheet.setOpen(true)
      if (e.metaKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void checkpointNow().catch((err: Error) => toast(err.message))
        return
      }
      if (e.metaKey && e.key === ',') {
        e.preventDefault()
        return navigate('/settings')
      }
      if (pendingG.current) {
        pendingG.current = false
        const map: Record<string, string> = {
          s: '/suggestions',
          p: '/privacy',
          a: '/apps',
          h: '/',
          ',': '/settings',
        }
        if (map[e.key]) navigate(map[e.key]!)
        return
      }
      if (e.key === 'g' && !e.metaKey) {
        pendingG.current = true
        setTimeout(() => (pendingG.current = false), 900)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, sheet])

  const view = route.startsWith('/suggestions') ? (
    <Suggestions />
  ) : route.startsWith('/apps') ? (
    <AppsView />
  ) : route.startsWith('/privacy') ? (
    <Privacy />
  ) : route.startsWith('/settings') ? (
    <SettingsView />
  ) : (
    <ProjectView route={route} navigate={navigate} />
  )

  return (
    <div className="flex h-full">
      <Sidebar route={route} navigate={navigate} />
      <main className="flex min-w-0 flex-1 flex-col bg-background">{view}</main>
      <ShortcutsSheet open={sheet.open} onOpenChange={sheet.setOpen} />
      <Toaster />
    </div>
  )
}
