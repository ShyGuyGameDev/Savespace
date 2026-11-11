import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d} d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function dayBucket(
  ts: number,
  now = new Date(),
): 'Today' | 'Yesterday' | 'This week' | 'Earlier' {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= start) return 'Today'
  if (ts >= start - 86_400_000) return 'Yesterday'
  if (ts >= start - 6 * 86_400_000) return 'This week'
  return 'Earlier'
}
