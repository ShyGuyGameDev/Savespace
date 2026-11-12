import { create } from 'zustand'
import type { Checkpoint } from '@shared/schemas'
import { api } from './bridge'

/**
 * "Checkpoint now" with a shared busy state for this window: every Checkpoint button (and ⌘N)
 * greys out until the checkpoint is saved, and extra clicks while saving do nothing.
 * The main process also de-duplicates, so the global hotkey can't double-save either.
 */
const useSaving = create<{ saving: boolean; set: (v: boolean) => void }>((set) => ({
  saving: false,
  set: (saving) => set({ saving }),
}))

export async function checkpointNow(projectId?: string | null): Promise<Checkpoint | null> {
  const s = useSaving.getState()
  if (s.saving) return null
  s.set(true)
  try {
    return await api('checkpoints:create', projectId === undefined ? {} : { projectId })
  } finally {
    useSaving.getState().set(false)
  }
}

export function useCheckpointNow() {
  const saving = useSaving((s) => s.saving)
  return { saving, save: checkpointNow }
}
