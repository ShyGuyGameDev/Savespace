import type { CheckpointTrigger, Project, ResourceRef } from '@shared/schemas'

export interface SummaryInput {
  project: Project | null
  trigger: CheckpointTrigger
  refs: ResourceRef[]
  /** Recent window titles (most recent last), metadata only. */
  recentTitles: string[]
  at: number
}

export interface Summarizer {
  summarize(input: SummaryInput): Promise<{ text: string; source: 'ollama' | 'template' }>
}
