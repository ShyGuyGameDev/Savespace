import type { Project, ResourceRef } from '@shared/schemas'
import { signalMatches, signalsForRef } from '../capture/signals'

/**
 * Decides which captured items belong to a project's checkpoint:
 *  - items whose signals match the project's signals,
 *  - plus anything from apps the user actually used while working on this project
 *    (per the activity buffer), so an unlabelled browser tab used for the project isn't lost,
 *  - window frames and app entries only for apps that keep at least one item (or were used).
 * With no project, everything visible is kept.
 */
export function scopeRefs(
  refs: ResourceRef[],
  project: Project | null,
  usedApps: Set<string>,
  repoRootOf: (p: string) => string | null,
): ResourceRef[] {
  if (!project || project.signals.length === 0) return refs
  const keep = new Set<ResourceRef>()
  for (const r of refs) {
    if (r.kind === 'app' || r.kind === 'windowFrame') continue
    const sigs = signalsForRef(r, repoRootOf)
    const matches = sigs.some((s) => project.signals.some((ps) => signalMatches(ps, s)))
    if (matches || (usedApps.has(r.app) && r.focused)) keep.add(r)
  }
  const appsWithItems = new Set([...keep].map((r) => r.app))
  for (const r of refs) {
    if (r.kind === 'app' && (appsWithItems.has(r.app) || usedApps.has(r.app))) keep.add(r)
    if (r.kind === 'windowFrame' && (appsWithItems.has(r.app) || usedApps.has(r.app))) keep.add(r)
  }
  return refs.filter((r) => keep.has(r))
}
