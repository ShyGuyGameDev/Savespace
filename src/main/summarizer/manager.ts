import type { Settings } from '@shared/constants'
import type { AiDownload, AiStatus } from '@shared/schemas'
import type { AppleSummarizer } from './apple'
import type { AiEngine } from './engine'
import { recommendModel, type OllamaSummarizer } from './ollama'

/**
 * Makes local AI "just work": starts Savespace's bundled engine and downloads the recommended
 * model into Savespace's own data folder automatically (once), with progress. Users can turn
 * AI off in Settings, which stops the engine and any download.
 */
export class AiManager {
  download: AiDownload | null = null
  private abort: AbortController | null = null
  private lastEmit = 0

  constructor(
    readonly engine: AiEngine,
    private readonly ollama: OllamaSummarizer,
    private readonly getSettings: () => Settings,
    private readonly onProgress: (d: AiDownload) => void = () => {},
    private readonly log: (s: string) => void = () => {},
    private readonly apple: Pick<AppleSummarizer, 'status'> | null = null,
  ) {}

  selectedModel(): string {
    return this.getSettings().ollamaModel || recommendModel()
  }

  async status(): Promise<AiStatus> {
    const s = this.getSettings()
    const base = await this.ollama.status(s.ollamaModel, this.download)
    const apple = this.apple
      ? await this.apple.status()
      : { available: false, reason: 'notBundled' }
    const activeSource: AiStatus['activeSource'] = !s.aiEnabled
      ? 'template'
      : s.aiProvider !== 'downloaded' && apple.available
        ? 'apple'
        : s.aiProvider !== 'apple' && base.running && base.modelAvailable
          ? 'ollama'
          : 'template'
    return { ...base, apple, activeSource }
  }

  /** Called at startup and whenever AI settings change. */
  async sync(): Promise<void> {
    const s = this.getSettings()
    if (!s.aiEnabled) {
      this.abort?.abort()
      this.engine.stop()
      return
    }
    // Apple's on-device model needs no download: if it's usable, don't start the engine at all.
    if (s.aiProvider !== 'downloaded' && this.apple && (await this.apple.status(true)).available) {
      this.abort?.abort()
      this.engine.stop()
      return
    }
    if (s.aiProvider === 'apple') {
      this.engine.stop()
      return
    }
    if (!this.engine.available) return
    try {
      await this.engine.start()
    } catch (e) {
      this.log(`[ai] engine failed to start: ${(e as Error).message}`)
      return
    }
    await this.ensureModel()
  }

  /** Downloads the selected model if it isn't present. Safe to call repeatedly. */
  async ensureModel(model = this.selectedModel()): Promise<void> {
    if (this.download?.active) return
    if (this.engine.state !== 'running') await this.engine.start()
    const models = (await this.ollama.listModels()) ?? []
    if (models.includes(model) || models.includes(`${model}:latest`)) return
    this.abort = new AbortController()
    this.download = { model, status: 'starting', completed: 0, total: 0, active: true }
    this.emit(true)
    try {
      await this.engine.egress.whileDownloading(() =>
        this.ollama.pull(
          model,
          (p) => {
            this.download = {
              model,
              status: p.status,
              completed: p.completed ?? this.download?.completed ?? 0,
              total: p.total ?? this.download?.total ?? 0,
              active: true,
            }
            this.emit()
          },
          this.abort!.signal,
        ),
      )
      this.download = {
        model,
        status: 'success',
        completed: this.download.total,
        total: this.download.total,
        active: false,
      }
    } catch (e) {
      this.download = {
        ...(this.download ?? { model, completed: 0, total: 0 }),
        status: 'error',
        active: false,
        error: this.abort.signal.aborted ? 'Download paused' : (e as Error).message,
      }
    } finally {
      this.abort = null
      this.emit(true)
    }
  }

  cancel(): void {
    this.abort?.abort()
  }

  stop(): void {
    this.abort?.abort()
    this.engine.stop()
  }

  private emit(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < 250) return
    this.lastEmit = now
    if (this.download) this.onProgress({ ...this.download })
  }
}
