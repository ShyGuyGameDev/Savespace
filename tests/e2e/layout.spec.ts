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
