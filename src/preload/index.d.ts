import type { SavespaceBridge } from '../shared/ipc'

declare global {
  interface Window {
    savespace: SavespaceBridge
  }
}
export {}
