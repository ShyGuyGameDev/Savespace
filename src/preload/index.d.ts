import type { WaypointBridge } from '../shared/ipc'

declare global {
  interface Window {
    waypoint: WaypointBridge
  }
}
export {}
