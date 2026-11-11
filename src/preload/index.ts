import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, EVENTS } from '../shared/channels'

const allowedChannels = new Set<string>(CHANNELS)
const allowedEvents = new Set<string>(EVENTS)

/**
 * Minimal typed bridge. The renderer can only call named channels (validated again with Zod
 * in the main process) and subscribe to named events. No Node, no ipcRenderer, no raw send.
 */
const bridge = {
  invoke(channel: string, input?: unknown): Promise<unknown> {
    if (!allowedChannels.has(channel))
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    return ipcRenderer.invoke(channel, input)
  },
  on(event: string, cb: (payload: unknown) => void): () => void {
    if (!allowedEvents.has(event)) throw new Error(`Blocked IPC event: ${event}`)
    const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  },
}

contextBridge.exposeInMainWorld('waypoint', Object.freeze(bridge))
