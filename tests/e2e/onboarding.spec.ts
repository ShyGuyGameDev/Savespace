import { expect, test } from '@playwright/test'
import { launchApp, windowByRoute } from './helpers'

test('first run shows onboarding, explains permissions, and can be completed', async () => {
  const { app } = await launchApp({ SAVESPACE_DRY_RUN: '1' })
  const page = await windowByRoute(app, '/')
  await expect(page.getByRole('heading', { name: /Welcome to Savespace/ })).toBeVisible()
  await expect(page.getByText(/only ever opens things/)).toBeVisible()
  await page.screenshot({ path: 'test-results/onboarding-1-welcome.png' })
  await page.getByRole('button', { name: /Continue/ }).click()
  await expect(page.getByRole('heading', { name: /What stays on your Mac/ })).toBeVisible()
  await expect(page.getByText('Screenshots or screen recording')).toBeVisible()
  await page.getByRole('button', { name: /Continue/ }).click()
  await expect(page.getByRole('heading', { name: /window titles/ })).toBeVisible()
  await expect(page.getByText(/does not need Screen Recording/)).toBeVisible()
  await page.screenshot({ path: 'test-results/onboarding-3-accessibility.png' })
  // Every permission step can be skipped (graceful degradation).
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('heading', { name: /Ask your apps/ })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('heading', { name: /Local summaries/ })).toBeVisible()
  // No download without asking: a yes/no question that says it downloads in the background.
  await expect(page.getByText('Download the AI model?')).toBeVisible()
  await expect(page.getByText(/downloads in the background/)).toBeVisible()
  // Says where it downloads to, and from where.
  await expect(
    page.getByText(/Saving to .*\/ai\/models on this Mac, downloaded from Ollama’s model library/),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/onboarding-ai-question.png' })
  await expect(page.getByRole('button', { name: /Yes, download in the background/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'No thanks' })).toBeVisible()
  await page.screenshot({ path: 'test-results/onboarding-5-ai.png' })
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: /Start using Savespace/ }).click()
  // Skipping the AI question counted as "yes".
  expect(
    (await page.evaluate("window.savespace.invoke('settings:get')")) as {
      aiDownloadConsent: string
    },
  ).toMatchObject({ aiDownloadConsent: 'yes' })
  await expect(page.getByRole('navigation', { name: 'Projects and sections' })).toBeVisible()
  await app.close()
})

test('saying No to the AI download is remembered and nothing downloads', async () => {
  const { app } = await launchApp({ SAVESPACE_DRY_RUN: '1' })
  const page = await windowByRoute(app, '/')
  for (let i = 0; i < 4; i++)
    await page
      .getByRole('button', { name: /Continue|Skip for now/ })
      .last()
      .click()
  await expect(page.getByText('Download the AI model?')).toBeVisible()
  await page.getByRole('button', { name: 'No thanks' }).click()
  await expect(page.getByText(/download the AI model any time in Settings/)).toBeVisible()
  await page.getByRole('button', { name: /Continue/ }).click()
  await page.getByRole('button', { name: /Start using Savespace/ }).click()
  expect(
    (await page.evaluate("window.savespace.invoke('settings:get')")) as {
      aiDownloadConsent: string
    },
  ).toMatchObject({ aiDownloadConsent: 'no' })
  await app.close()
})

test('the intro scrolls when a step is taller than the window, and its buttons stay visible', async () => {
  const { app } = await launchApp({ SAVESPACE_DRY_RUN: '1' })
  const page = await windowByRoute(app, '/')
  // Shrink to the smallest window size Savespace allows.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.isVisible()) w.setSize(860, 540)
  })
  await page.waitForTimeout(300)
  for (let i = 0; i < 3; i++)
    await page
      .getByRole('button', { name: /Continue|Skip for now/ })
      .last()
      .click()
  await expect(page.getByRole('heading', { name: /Ask your apps/ })).toBeVisible()
  const scroller = page.getByTestId('intro-scroll')
  const sizes = (await scroller.evaluate((el: { scrollHeight: number; clientHeight: number }) => ({
    scroll: el.scrollHeight,
    client: el.clientHeight,
  }))) as { scroll: number; client: number }
  expect(sizes.scroll).toBeGreaterThan(sizes.client) // content is taller than the window here
  await page.screenshot({ path: 'test-results/intro-small-window.png' })
  await page.mouse.move(430, 300)
  await page.mouse.wheel(0, 2000)
  await expect(page.getByText('Which folders were open.')).toBeInViewport()
  await expect(page.getByRole('button', { name: /Continue/ })).toBeInViewport()
  await page.screenshot({ path: 'test-results/intro-small-window-scrolled.png' })
  await app.close()
})
