import type { GoogleConnectors } from '../connectors/google'
import { createGenericAdapter } from './generic'
import type { AppAdapter } from './types'

/** Captures from the opt-in Google connectors (if connected). Restores via the default browser. */
export function googleConnectorAdapter(g: GoogleConnectors): AppAdapter {
  const generic = createGenericAdapter('web', 'Web browser')
  return {
    ...generic,
    id: 'google-connectors',
    displayName: 'Google (connectors)',
    bundleIds: ['*'],
    tier: 'partial',
    notes:
      'Optional, read-only Google APIs: recent Gmail drafts (subject + id), Calendar events around now, and Drive file names for Docs links. Items reopen in your default browser. Untested end-to-end (needs a Google OAuth client).',
    handles: (ref) => ref.app === 'web',
    async capture() {
      const [drafts, events] = await Promise.all([
        g.gmailDrafts().catch(() => []),
        g.calendarNow().catch(() => []),
      ])
      return [...drafts, ...events]
    },
  }
}
