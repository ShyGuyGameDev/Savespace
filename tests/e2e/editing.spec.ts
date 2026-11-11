import { expect, test } from '@playwright/test'
import { launchApp, windowByRoute } from './helpers'

test('edit a checkpoint: change the summary and remove a saved item', async () => {
  const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
  const page = await windowByRoute(app, '/')
  await page.getByRole('button', { name: /Atlas API/ }).click()
  await page.getByRole('button', { name: 'Edit checkpoint' }).click()
  const text = page.getByRole('textbox', { name: 'What you were doing' })
  await text.fill('You were adding rate limits to the public API.')
  await page.getByRole('button', { name: /Remove Add token bucket limiter #88/ }).click()
  await page.screenshot({ path: 'test-results/checkpoint-edit.png' })
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('You were adding rate limits to the public API.').first()).toBeVisible()
  await expect(page.getByText('Add token bucket limiter #88')).toHaveCount(0)
  await app.close()
})

test('edit a project (name, colour, what belongs) and delete it; merge/split are gone', async () => {
  const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
  const page = await windowByRoute(app, '/')
  await page.getByRole('button', { name: /Marketing site/ }).click()
  await page.getByRole('button', { name: 'Marketing site options' }).click()
  await expect(page.getByRole('menuitem', { name: /Merge|Split/ })).toHaveCount(0)
  await page.getByRole('menuitem', { name: /Edit project/ }).click()
  await page.getByLabel('Name').fill('Website relaunch')
  await page.getByRole('radio', { name: 'Colour #a35ce8' }).click()
  await page.getByLabel('Add a folder or website').fill('https://www.webflow.com/dashboard')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('list', { name: 'What belongs to this project' }).getByText('webflow.com')).toBeVisible()
  await page.screenshot({ path: 'test-results/project-edit.png' })
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'Website relaunch' })).toBeVisible()

  await page.getByRole('button', { name: 'Website relaunch options' }).click()
  await page.getByRole('menuitem', { name: /Delete project/ }).click()
  await page.getByRole('button', { name: 'Delete project' }).click()
  await expect(page.getByRole('button', { name: /Website relaunch/ })).toHaveCount(0)
  // Its checkpoint is kept, unassigned.
  await expect(page.getByText('Unassigned').first()).toBeVisible()

  await page.getByRole('button', { name: /Suggestions/ }).click()
  await expect(page.getByRole('button', { name: /Add to existing/ })).toHaveCount(0)
  await app.close()
})
