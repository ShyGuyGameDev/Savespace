import { afterEach, describe, expect, it } from 'vitest'
import { CaptureScheduler } from '../../src/main/capture/scheduler'
import type { ActivitySample } from '../../src/main/capture/engine'
import { tempDb } from '../helpers/db'

let ctx: ReturnType<typeof tempDb>
afterEach(() => ctx?.cleanup())

function setup() {
  ctx = tempDb()
  ctx.store.setSettings({ onboardingComplete: true })
  const a = ctx.store.createProject('Alpha', ['repo:/a'])
  const b = ctx.store.createProject('Beta', ['repo:/b'])
  let clock = new Date(2026, 10, 10, 10, 0, 0)
  let idle = 0
  let signals = ['repo:/a']
  const checkpoints: { trigger: string; projectId?: string | null }[] = []
  const sched = new CaptureScheduler({
    store: ctx.store,
    now: () => clock,
    idleSeconds: () => idle,
    sample: async (): Promise<ActivitySample> => ({
      at: clock.getTime(),
      bundleId: 'com.microsoft.VSCode',
      appName: 'Code',
      windowTitle: 'x',
      refs: [],
      signals,
    }),
    checkpoint: async (trigger, projectId) => void checkpoints.push({ trigger, projectId }),
  })
  return {
    a,
    b,
    sched,
    checkpoints,
    advance: (min: number) => (clock = new Date(clock.getTime() + min * 60_000)),
    setIdle: (s: number) => (idle = s),
    setSignals: (s: string[]) => (signals = s),
  }
}

describe('capture scheduler', () => {
  it('records samples in the rolling buffer with the matched project', async () => {
    const t = setup()
    await t.sched.tick()
    const ev = ctx.store.recentActivity(0)
    expect(ev).toHaveLength(1)
    expect(ev[0]?.projectId).toBe(t.a.id)
  })

  it('checkpoints the previous project after a sustained switch (not on a blip)', async () => {
    const t = setup()
    await t.sched.tick()
    t.advance(1)
    await t.sched.tick() // Alpha established
    expect(t.sched.project).toBe(t.a.id)
    t.setSignals(['repo:/b'])
    t.advance(1)
    await t.sched.tick() // one blip
    t.setSignals(['repo:/a'])
    t.advance(1)
    await t.sched.tick()
    expect(t.checkpoints).toEqual([])
    t.setSignals(['repo:/b'])
    t.advance(6)
    await t.sched.tick()
    t.advance(1)
    await t.sched.tick()
    expect(t.checkpoints).toEqual([{ trigger: 'project-switch', projectId: t.a.id }])
    expect(t.sched.project).toBe(t.b.id)
  })

  it('checkpoints once per idle period', async () => {
    const t = setup()
    await t.sched.tick()
    t.advance(1)
    await t.sched.tick()
    t.setIdle(11 * 60)
    await t.sched.tick()
    await t.sched.tick()
    expect(t.checkpoints.filter((c) => c.trigger === 'idle')).toHaveLength(1)
    t.setIdle(0)
    await t.sched.tick()
    t.setIdle(20 * 60)
    await t.sched.tick()
    expect(t.checkpoints.filter((c) => c.trigger === 'idle')).toHaveLength(2)
  })

  it('checkpoints once at end of day when there was activity', async () => {
    const t = setup()
    await t.sched.tick()
    t.advance(8 * 60) // 18:00
    await t.sched.tick()
    t.advance(5)
    await t.sched.tick()
    expect(t.checkpoints.filter((c) => c.trigger === 'end-of-day')).toHaveLength(1)
  })

  it('does nothing when capture is disabled', async () => {
    const t = setup()
    ctx.store.setSettings({ captureEnabled: false })
    await t.sched.tick()
    await t.sched.onPowerEvent('sleep')
    expect(ctx.store.recentActivity(0)).toHaveLength(0)
    expect(t.checkpoints).toHaveLength(0)
  })

  it('checkpoints on sleep and lock', async () => {
    const t = setup()
    await t.sched.onPowerEvent('sleep')
    await t.sched.onPowerEvent('lock')
    expect(t.checkpoints.map((c) => c.trigger)).toEqual(['sleep', 'lock'])
  })

  it('captures nothing (and asks macOS nothing) until the intro is finished', async () => {
    const t = setup()
    ctx.store.setSettings({ onboardingComplete: false })
    let samples = 0
    const sched = new CaptureScheduler({
      store: ctx.store,
      idleSeconds: () => 0,
      sample: async () => {
        samples++
        return null
      },
      checkpoint: async (trigger) => void t.checkpoints.push({ trigger }),
    })
    await sched.tick()
    await sched.onPowerEvent('sleep')
    await sched.onPowerEvent('quit')
    expect(samples).toBe(0)
    expect(t.checkpoints).toHaveLength(0)
    ctx.store.setSettings({ onboardingComplete: true })
    await sched.tick()
    expect(samples).toBe(1)
  })
})
