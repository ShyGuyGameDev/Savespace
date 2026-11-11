import {
  AppWindow,
  Calendar,
  File,
  Folder,
  GitBranch,
  Globe,
  Link,
  Mail,
  MailOpen,
  Maximize2,
  NotebookPen,
  SquareTerminal,
  Code2,
} from 'lucide-react'
import type { ResourceRef } from '@shared/schemas'
import { cn } from '@/lib/utils'

const ICONS = {
  app: AppWindow,
  file: File,
  folder: Folder,
  workspace: Code2,
  url: Globe,
  doc: Globe,
  deepLink: Link,
  draft: MailOpen,
  message: Mail,
  note: NotebookPen,
  calendarEvent: Calendar,
  terminalCwd: SquareTerminal,
  gitState: GitBranch,
  windowFrame: Maximize2,
} as const

export function ResourceIcon({
  kind,
  className,
}: {
  kind: ResourceRef['kind']
  className?: string
}) {
  const Icon = ICONS[kind]
  return <Icon className={cn('size-4 shrink-0 text-muted-foreground', className)} aria-hidden />
}
