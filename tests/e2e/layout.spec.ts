import { expect, test } from '@playwright/test'
import { launchApp, windowByRoute } from './helpers'

test('the window itself never scrolls: only its panels do', async () => {
  const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
  const page = await windowByRoute(app, '/')
  for (const section of ['Settings', 'Privacy', 'Apps', 'Suggestions']) {
    await page.getByRole('button', { name: section, exact: section !== 'Suggestions' }).click()
    // Scroll with the mouse over the sidebar, as a user would.
    await page.mouse.move(100, 500)
    await page.mouse.wheel(0, 3000)
    await page.waitForTimeout(150)
    const doc = await page.evaluate(
      '({ scrollY: window.scrollY, extra: document.documentElement.scrollHeight - document.documentElement.clientHeight })',
    )
    expect(doc, section).toEqual({ scrollY: 0, extra: 0 })
  }
  // …but the Settings panel itself still scrolls.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.mouse.move(900, 500)
  await page.mouse.wheel(0, 2000)
  await page.waitForTimeout(200)
  const panelTop = await page.evaluate(
    "Math.max(...[...document.querySelectorAll('main .overflow-y-auto')].map((e) => e.scrollTop))",
  )
  expect(panelTop).toBeGreaterThan(100)
  await expect(page.getByText('Show the welcome & permissions guide again')).toBeInViewport()
  await app.close()
})

test('the top of the main area drags the window like the sidebar; its controls stay clickable', async () => {
  const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
  const page = await windowByRoute(app, '/')
  await expect(page.getByRole('switch', { name: 'Tracking' })).toBeVisible()
  // What a click at (x, y) would do: walk up to the nearest element that sets a drag region.
  const regionAt = (where: string) =>
    page.evaluate(`(() => {
      const main = document.querySelector('main')
      const nav = document.querySelector('nav')
      const power = document.querySelector('[role="switch"][aria-label="Tracking"]')
      const pick = { bar: () => { const r = main.getBoundingClientRect(); return [r.left + r.width / 2, r.top + 24] },
        sidebar: () => { const r = nav.getBoundingClientRect(); return [r.left + r.width / 2, r.top + 12] },
        power: () => { const r = power.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] } }
      const [x, y] = pick[${JSON.stringify(where)}]()
      let el = document.elementFromPoint(x, y)
      while (el) {
        const v = getComputedStyle(el).getPropertyValue('-webkit-app-region')
        if (v === 'drag' || v === 'no-drag') return v
        el = el.parentElement
      }
      return 'none'
    })()`)
  expect(await regionAt('sidebar')).toBe('drag')
  expect(await regionAt('bar')).toBe('drag')
  expect(await regionAt('power')).toBe('no-drag')
  await app.close()
})
