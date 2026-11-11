import { expect, test } from '@playwright/test'
import { launchApp, windowByRoute } from './helpers'

test('first run shows onboarding, explains permissions, and can be completed', async () => {
  const { app } = await launchApp()
  const page = await windowByRoute(app, '/')
  await expect(page.getByRole('heading', { name: /Welcome to Waypoint/ })).toBeVisible()
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
  await page.screenshot({ path: 'test-results/onboarding-5-ai.png' })
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: /Start using Waypoint/ }).click()
  await expect(page.getByRole('navigation', { name: 'Projects and sections' })).toBeVisible()
  await app.close()
})
