import { describe, expect, it } from 'vitest'
import { APP_NAME } from '@shared/constants'
import { CHANNELS } from '@shared/channels'
import { IPC_CHANNELS } from '@shared/ipc'

describe('scaffold', () => {
  it('has a single product name constant', () => expect(APP_NAME).toBe('Waypoint'))
  it('preload channel list matches the Zod IPC contract', () => {
    expect([...CHANNELS].sort()).toEqual([...IPC_CHANNELS].sort())
  })
})
