import type { Settings } from '@shared/constants'
import type { ResourceRef } from '@shared/schemas'
import { ResourceRefSchema } from '@shared/schemas'
import type { AdapterRegistry } from '../adapters/registry'
import type { AppWindowInfo, CaptureContext } from '../adapters/types'
import type { SafeExec } from '../safe-exec'
import { GitInspector } from './git'
import { filterRefs, isExcludedApp, isExcludedTitle, type PrivacyRules } from './privacy-filter'
import { signalsForRef, titleTokens } from './signals'
import { axDocumentPath, readSystem, type SystemSnapshot } from './system'

export interface EngineDeps {
  exec: SafeExec
  registry: AdapterRegistry
  getSettings: () => Settings
  getRules: () => PrivacyRules
  accessibility: () => boolean
  noteAutomation: (bundleId: string, state: 'granted' | 'denied') => void
  tempDir: string
  homeDir: string
  git?: GitInspector
  /** Optional metadata enrichment (e.g. Drive file names) applied to full snapshots. */
  enrich?: (refs: ResourceRef[]) => Promise<ResourceRef[]>
  /** Overridable for tests. */
  readSystem?: (
    exec: SafeExec,
    accessibility: boolean,
  ) => Promise<SystemSnapshot & { automationDenied: boolean }>
}

export interface ActivitySample {
  at: number
  bundleId: string
  appName: string
  windowTitle: string | null
  refs: ResourceRef[]
  signals: string[]
}

export interface Snapshot {
  at: number
  refs: ResourceRef[]
  system: SystemSnapshot
}

const SELF_BUNDLE_IDS = new Set(['app.savespace.desktop', 'com.github.Electron'])

/** Builds metadata-only snapshots. Never reads document contents, never takes screenshots. */
export class CaptureEngine {
  readonly git: GitInspector

  constructor(private readonly d: EngineDeps) {
    this.git = d.git ?? new GitInspector(d.exec)
  }

  private async context(): Promise<{
    ctx: CaptureContext
    system: SystemSnapshot
    rules: PrivacyRules
  }> {
    const accessibility = this.d.accessibility()
    const sys = await (this.d.readSystem ?? readSystem)(this.d.exec, accessibility)
    if (sys.processesReadable) this.d.noteAutomation('com.apple.systemevents', 'granted')
    else if (sys.automationDenied) this.d.noteAutomation('com.apple.systemevents', 'denied')
    const rules = this.d.getRules()
    const off = this.captureOffBundles()
    const apps = sys.apps
      .filter(
        (a) =>
          a.bundleId &&
          !SELF_BUNDLE_IDS.has(a.bundleId) &&
          !isExcludedApp(a.bundleId, rules) &&
          !off.has(a.bundleId), // turned off on the Apps page: not read at all
      )
      .map((a) => ({ ...a, windows: a.windows.filter((w) => !isExcludedTitle(w.title, rules)) }))
    const running = new Set(apps.map((a) => a.bundleId!))
    const ctx: CaptureContext = {
      exec: this.d.exec,
      settings: this.d.getSettings(),
      apps,
      accessibility: sys.windowsReadable,
      isRunning: (b) => running.has(b),
      noteAutomation: this.d.noteAutomation,
      tempDir: this.d.tempDir,
      homeDir: this.d.homeDir,
    }
    return { ctx, system: { ...sys, apps }, rules }
  }

  /** Window-level refs every app gets for free: the app itself, window frames, and AXDocument files. */
  private coreRefs(apps: AppWindowInfo[]): ResourceRef[] {
    const out: ResourceRef[] = []
    for (const a of apps) {
      if (!a.bundleId) continue
      if (a.windows.length === 0 && !a.frontmost) continue
      out.push({ kind: 'app', app: a.bundleId, title: a.name, focused: a.frontmost || undefined })
      a.windows.forEach((w, i) => {
        const focused = a.frontmost && i === 0 ? true : undefined
        if (w.title && w.position && w.size && w.size[0] > 0 && w.size[1] > 0) {
          out.push({
            kind: 'windowFrame',
            app: a.bundleId!,
            windowTitle: w.title.slice(0, 500),
            frame: {
              x: Math.round(w.position[0]),
              y: Math.round(w.position[1]),
              w: Math.round(w.size[0]),
              h: Math.round(w.size[1]),
            },
            focused,
          })
        }
        const path = axDocumentPath(w.document)
        if (path)
          out.push({ kind: 'file', app: a.bundleId!, path, title: w.title ?? undefined, focused })
      })
    }
    return out
  }

  /** Bundle ids of apps whose reading is turned off on the Apps page. */
  private captureOffBundles(): Set<string> {
    const off = new Set(this.d.getSettings().appsCaptureOff)
    return new Set(
      this.d.registry.adapters.filter((a) => off.has(a.id)).flatMap((a) => a.bundleIds),
    )
  }

  private async adapterRefs(ctx: CaptureContext, onlyBundle?: string): Promise<ResourceRef[]> {
    const seen = new Set<string>()
    const jobs: Promise<ResourceRef[]>[] = []
    const off = new Set(this.d.getSettings().appsCaptureOff)
    for (const a of this.d.registry.adapters) {
      if (seen.has(a.id) || off.has(a.id)) continue
      const relevant = onlyBundle
        ? a.bundleIds.includes(onlyBundle)
        : a.bundleIds.some((b) => ctx.isRunning(b)) || a.bundleIds.includes('*')
      if (!relevant) continue
      seen.add(a.id)
      jobs.push(a.capture(ctx).catch(() => []))
    }
    return (await Promise.all(jobs)).flat()
  }

  private async gitRefs(refs: ResourceRef[]): Promise<ResourceRef[]> {
    const roots = new Set<string>()
    for (const r of refs) {
      const p =
        r.kind === 'file' ||
        r.kind === 'folder' ||
        r.kind === 'workspace' ||
        r.kind === 'terminalCwd'
          ? r.path
          : null
      if (!p) continue
      const root = this.git.repoRootOf(p)
      if (root) roots.add(root)
    }
    const states = await Promise.all([...roots].slice(0, 8).map((r) => this.git.state(r)))
    return states.filter((s): s is NonNullable<typeof s> => !!s)
  }

  /** Full capture used when saving a checkpoint. */
  async snapshot({ enrich = true } = {}): Promise<Snapshot> {
    const { ctx, system, rules } = await this.context()
    const raw = [...this.coreRefs(ctx.apps), ...(await this.adapterRefs(ctx))]
    const gitOff = this.d.getSettings().appsCaptureOff.includes('git')
    const withGit = gitOff ? raw : [...raw, ...(await this.gitRefs(raw))]
    const off = this.captureOffBundles()
    let refs = dedupe(filterRefs(validOnly(withGit), rules)).filter((r) => !off.has(r.app))
    if (enrich && this.d.enrich) refs = filterRefs(validOnly(await this.d.enrich(refs)), rules)
    return { at: Date.now(), refs, system }
  }

  /** Lightweight sample for the activity buffer: front app, its focused items, and their signals. */
  async sample(): Promise<ActivitySample | null> {
    const { ctx, system, rules } = await this.context()
    const front =
      ctx.apps.find((a) => a.frontmost) ??
      (system.front.bundleId
        ? {
            bundleId: system.front.bundleId,
            name: system.front.name ?? system.front.bundleId,
            windows: [],
            frontmost: true,
            pid: null,
          }
        : null)
    if (
      !front?.bundleId ||
      isExcludedApp(front.bundleId, rules) ||
      SELF_BUNDLE_IDS.has(front.bundleId) ||
      this.captureOffBundles().has(front.bundleId)
    )
      return null
    const title = front.windows[0]?.title ?? null
    const refs = filterRefs(
      validOnly([...this.coreRefs([front]), ...(await this.adapterRefs(ctx, front.bundleId))]),
      rules,
    )
    const focused = refs.filter((r) => r.focused && r.kind !== 'windowFrame' && r.kind !== 'app')
    const sigRefs = focused.length
      ? focused
      : refs.filter((r) => r.kind !== 'windowFrame' && r.kind !== 'app').slice(0, 5)
    const signals = new Set<string>()
    for (const r of sigRefs) for (const s of signalsForRef(r, this.git.repoRootOf)) signals.add(s)
    for (const t of titleTokens(title)) signals.add(`token:${t}`)
    signals.add(`app:${front.bundleId}`) // lets projects defined by their apps be recognised
    return {
      at: Date.now(),
      bundleId: front.bundleId,
      appName: front.name,
      windowTitle: title,
      refs: sigRefs,
      signals: [...signals],
    }
  }
}

function validOnly(refs: ResourceRef[]): ResourceRef[] {
  return refs.flatMap((r) => {
    const p = ResourceRefSchema.safeParse(r)
    return p.success ? [p.data] : []
  })
}

export function refKey(r: ResourceRef): string {
  switch (r.kind) {
    case 'file':
      return `file:${r.path}`
    case 'folder':
    case 'workspace':
    case 'terminalCwd':
      return `${r.kind}:${r.app}:${r.path}`
    case 'url':
    case 'doc':
    case 'deepLink':
      return `${r.kind}:${r.app}:${r.url}`
    case 'draft':
    case 'message':
      return `${r.kind}:${r.messageId}`
    case 'note':
      return `note:${r.noteId}`
    case 'calendarEvent':
      return `cal:${r.uid}`
    case 'gitState':
      return `git:${r.repoPath}`
    case 'windowFrame':
      return `frame:${r.app}:${r.windowTitle}`
    case 'app':
      return `app:${r.app}`
  }
}

/** Removes duplicates; a deep adapter's version of a file (with line/col) wins over the AXDocument one. */
export function dedupe(refs: ResourceRef[]): ResourceRef[] {
  const map = new Map<string, ResourceRef>()
  for (const r of refs) {
    const k = refKey(r)
    const prev = map.get(k)
    if (!prev) map.set(k, r)
    else {
      const richer =
        r.kind === 'file' && prev.kind === 'file' && (r.line ?? 0) > (prev.line ?? 0) ? r : prev
      map.set(k, { ...richer, focused: prev.focused || r.focused || undefined } as ResourceRef)
    }
  }
  return [...map.values()]
}
