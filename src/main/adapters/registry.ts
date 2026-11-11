import type { ResourceRef } from '@shared/schemas'
import { createGenericAdapter } from './generic'
import type { AppAdapter } from './types'

/**
 * Central registry. Adding a deep adapter = one file + one line in `adapters/index.ts`.
 * Anything without a dedicated adapter falls back to the GenericAppAdapter (launch/focus).
 */
export class AdapterRegistry {
  private byBundle = new Map<string, AppAdapter>()
  private generics = new Map<string, AppAdapter>()

  constructor(public readonly adapters: AppAdapter[]) {
    for (const a of adapters)
      for (const b of a.bundleIds) if (!this.byBundle.has(b)) this.byBundle.set(b, a)
  }

  forBundle(bundleId: string, displayName?: string): AppAdapter {
    const a = this.byBundle.get(bundleId)
    if (a) return a
    return this.genericFor(bundleId, displayName)
  }

  private genericFor(bundleId: string, displayName?: string): AppAdapter {
    let g = this.generics.get(bundleId)
    if (!g) {
      g = createGenericAdapter(bundleId, displayName ?? bundleId)
      this.generics.set(bundleId, g)
    }
    return g
  }

  forRef(ref: ResourceRef): AppAdapter {
    for (const a of this.adapters) if (a.handles?.(ref)) return a
    // Plain "launch or focus the app" entries always use the generic launcher, even for apps with a deep adapter.
    if (ref.kind === 'app')
      return this.genericFor(ref.app, this.byBundle.get(ref.app)?.displayName ?? ref.title)
    return this.forBundle(ref.app)
  }

  hasDedicated(bundleId: string): boolean {
    return this.byBundle.has(bundleId)
  }
}
