import type { Project } from '@shared/schemas'
import { signalMatches, signalWeight } from '../capture/signals'

export interface ProjectMatch {
  projectId: string | null
  score: number
  /** 0..1, share of the observed signal weight explained by the winning project. */
  confidence: number
}

/** Scores confirmed projects against observed signals (weighted, prefix-aware). */
export function matchProject(projects: Project[], observed: string[]): ProjectMatch {
  const total = observed.reduce((s, x) => s + signalWeight(x), 0)
  let best: ProjectMatch = { projectId: null, score: 0, confidence: 0 }
  if (!total) return best
  for (const p of projects) {
    if (p.archived || !p.signals.length) continue
    let score = 0
    for (const o of observed)
      if (p.signals.some((ps) => signalMatches(ps, o))) score += signalWeight(o)
    if (score > best.score)
      best = { projectId: p.id, score, confidence: Math.min(1, score / total) }
  }
  return best
}
