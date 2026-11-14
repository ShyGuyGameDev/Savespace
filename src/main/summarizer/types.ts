import type { CheckpointTrigger, Project, ResourceRef, SummarySource } from '@shared/schemas'

export interface SummaryInput {
  project: Project | null
  trigger: CheckpointTrigger
  refs: ResourceRef[]
  /** Recent window titles (most recent last), metadata only. */
  recentTitles: string[]
  handoff?: string
  previousRefs?: ResourceRef[]
  at: number
}

export interface Summarizer {
  summarize(input: SummaryInput): Promise<{ text: string; source: SummarySource }>
}
