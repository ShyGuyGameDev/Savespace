import { expect, test } from '@playwright/test'
import { launchApp, windowByRoute } from './helpers'

test.describe('dashboard', () => {
  test('timeline, detail, preview restore and per-item results', async () => {
    const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
    const page = await windowByRoute(app, '/')
    await expect(page.getByRole('navigation', { name: 'Projects and sections' })).toBeVisible()
    await page.getByRole('button', { name: /Atlas API/ }).click()
    await expect(page.getByRole('heading', { name: 'Atlas API' })).toBeVisible()
    await expect(page.getByText('What you were doing')).toBeVisible()
    await expect(page.getByText(/editing server\.ts around line 42/).first()).toBeVisible()
    await page.screenshot({ path: 'test-results/dashboard-detail.png' })

    // Preview restore lists exactly what will open, grouped by app.
    await page.keyboard.press('r')
    const dialog = page.getByRole('dialog', { name: 'Preview restore' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Open server\.ts at line 42:7/)).toBeVisible()
    await expect(dialog.getByText(/Jira ticket ATL-212/)).toBeVisible()
    await expect(dialog.getByText(/Arrange windows is off/).first()).toBeVisible()
    await page.screenshot({ path: 'test-results/restore-preview.png' })

    // Uncheck one item, then restore (dry-run: nothing actually opens).
    await dialog.getByRole('checkbox').nth(1).uncheck()
    await dialog.getByRole('button', { name: /^Restore \d+ items?/ }).click()
    await expect(
      page.getByRole('dialog', { name: 'Restoring' }).getByText('Restore finished'),
    ).toBeVisible({ timeout: 20_000 })
    const results = page.getByRole('list', { name: 'Restore results' })
    await expect(results.getByText('Opened').first()).toBeVisible()
    await expect(results.getByText('Skipped').first()).toBeVisible()
    await expect(results.getByText('You unchecked this item')).toBeVisible()
    await expect(results.getByText(/For context only/)).toBeVisible()
    await page.screenshot({ path: 'test-results/restore-results.png' })
    await page.getByRole('button', { name: 'Done' }).click()
    await app.close()
  })

  test('suggestions inbox: confirm with a new name creates the project', async () => {
    const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
    const page = await windowByRoute(app, '/')
    await page.getByRole('button', { name: /Suggestions/ }).click()
    await expect(page.getByRole('heading', { name: 'Tax Return 2026' })).toBeVisible()
    await page.screenshot({ path: 'test-results/suggestions.png' })
    await page.keyboard.press('e')
    await page.getByLabel('Project name').fill('Taxes 2026')
    await page.getByRole('button', { name: 'Confirm' }).last().click()
    await expect(page.getByText('All caught up')).toBeVisible()
    await expect(page.getByRole('button', { name: /Taxes 2026/ })).toBeVisible()
    await app.close()
  })

  test('privacy center shows permissions, exclusions and audit log; delete-all requires typing DELETE', async () => {
    const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
    const page = await windowByRoute(app, '/')
    await page.getByRole('button', { name: 'Privacy' }).click()
    await expect(page.getByText('Accessibility', { exact: true })).toBeVisible()
    await expect(page.getByText('com.1password.1password')).toBeVisible()
    await expect(page.getByText(/Checkpoint saved/).first()).toBeVisible()
    await page.screenshot({ path: 'test-results/privacy.png', fullPage: true })
    await page.getByRole('button', { name: /Delete all data/ }).click()
    const del = page.getByRole('button', { name: 'Delete everything' })
    await expect(del).toBeDisabled()
    await page.getByLabel('Type DELETE to confirm').fill('DELETE')
    await del.click()
    // Settings are wiped too, so Savespace starts fresh at the welcome screen.
    await expect(page.getByRole('heading', { name: /Welcome to Savespace/ })).toBeVisible()
    await app.close()
  })

  test('settings: arrange windows is off by default and can be toggled', async () => {
    const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
    const page = await windowByRoute(app, '/')
    await page.getByRole('button', { name: 'Settings' }).click()
    const toggle = page.getByRole('switch', { name: 'Arrange windows' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('switch', { name: 'Capture Safari tabs' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await page.screenshot({ path: 'test-results/settings.png', fullPage: true })
    const source = page.getByLabel('AI source')
    await source.scrollIntoViewIfNeeded()
    await expect(source).toHaveValue('auto')
    await expect(page.getByText('Now using:')).toBeVisible()
    await page.screenshot({ path: 'test-results/settings-ai.png' })
    await app.close()
  })

  test('palette: fuzzy search and resume from the keyboard', async () => {
    const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
    const palette = await windowByRoute(app, '/palette')
    await palette.evaluate('window.dispatchEvent(new Event("focus"))')
    const input = palette.getByRole('combobox', { name: 'Command palette' })
    await input.fill('atls')
    await expect(palette.getByRole('option', { name: /Resume Atlas API/ })).toBeVisible()
    await expect(palette.getByRole('option', { name: /Marketing/ })).toHaveCount(0)
    await palette.screenshot({ path: 'test-results/palette.png' })
    await input.press('Enter')
    await expect(palette.getByText('Restore finished')).toBeVisible({ timeout: 20_000 })
    await app.close()
  })

  test('tray popover shows recent projects', async () => {
    const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
    const pop = await windowByRoute(app, '/popover')
    await expect(pop.getByRole('button', { name: /Checkpoint now/ })).toBeVisible()
    await expect(pop.getByRole('button', { name: 'Resume Atlas API' })).toBeVisible()
    await pop.screenshot({ path: 'test-results/popover.png' })
    await app.close()
  })
})
