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
  await expect(
    page.getByText('You were adding rate limits to the public API.').first(),
  ).toBeVisible()
  await expect(page.getByText('Add token bucket limiter #88')).toHaveCount(0)
  await app.close()
})

test('edit a project: add an app, pin a tab, and it reopens; delete keeps checkpoints', async () => {
  const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
  const page = await windowByRoute(app, '/')
  await page.getByRole('button', { name: /Marketing site/ }).click()
  await page.getByRole('button', { name: 'Marketing site options' }).click()
  await expect(page.getByRole('menuitem', { name: /Merge|Split/ })).toHaveCount(0)
  await page.getByRole('menuitem', { name: /Edit project/ }).click()
  const dialog = page.getByRole('dialog')
  // No more free-form folders/websites box.
  await expect(dialog.getByText('What belongs to this project', { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('textbox', { name: 'Add a folder or website' })).toHaveCount(0)
  await dialog.getByLabel('Name').fill('Website relaunch')
  await dialog.getByRole('button', { name: 'Add app' }).click()
  await dialog.getByLabel('Search your apps').fill('chrome')
  await dialog.getByRole('button', { name: /Google Chrome/ }).click()
  // Chrome's editor: pin a tab.
  await expect(dialog.getByRole('heading', { name: 'Google Chrome' })).toBeVisible()
  await dialog.getByLabel('Web address').fill('www.figma.com/design/abc123/Homepage-v3')
  await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(
    dialog
      .getByRole('list', { name: 'Pinned in Google Chrome' })
      .getByText(/figma\.com\/design\/abc123/),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/project-app-edit.png' })
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(
    dialog.getByRole('list', { name: 'Apps in this project' }).getByText('1 tab'),
  ).toBeVisible()
  // With apps added, "Only restore these apps" appears (on by default) and can be turned off.
  const only = dialog.getByRole('switch', { name: 'Only restore these apps' })
  await expect(only).toBeChecked()
  await expect(dialog.getByText(/save only the apps above/)).toBeVisible()
  await only.click()
  await expect(only).not.toBeChecked()
  await expect(dialog.getByText(/always saved, along with anything else/)).toBeVisible()
  await page.screenshot({ path: 'test-results/project-edit.png' })
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'Website relaunch' })).toBeVisible()
  const p = (
    (await page.evaluate("window.savespace.invoke('projects:list')")) as {
      name: string
      apps: unknown[]
      onlyApps: boolean
    }[]
  ).find((x) => x.name === 'Website relaunch')!
  expect(p.onlyApps).toBe(false)
  expect(p.apps).toEqual([
    {
      bundleId: 'com.google.Chrome',
      name: 'Google Chrome',
      items: [{ kind: 'url', url: 'https://www.figma.com/design/abc123/Homepage-v3' }],
    },
  ])

  // The pinned tab is part of resuming.
  await page.getByRole('button', { name: 'Preview restore' }).click()
  await expect(
    page
      .getByRole('dialog', { name: 'Preview restore' })
      .getByText(/Figma file/)
      .first(),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Website relaunch options' }).click()
  await page.getByRole('menuitem', { name: /Delete project/ }).click()
  await page.getByRole('button', { name: 'Delete project' }).click()
  await expect(page.getByRole('button', { name: /Website relaunch/ })).toHaveCount(0)
  await expect(page.getByText('Unassigned').first()).toBeVisible()
  await app.close()
})

test('Checkpoint now greys out while saving, so it cannot be spammed', async () => {
  const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
  const page = await windowByRoute(app, '/')
  const before = (
    (await page.evaluate("window.savespace.invoke('checkpoints:list', {})")) as unknown[]
  ).length
  const button = page.getByRole('button', { name: /Checkpoint now|Saving/ }).first()
  // Fire several clicks in the same instant, like an impatient triple click, and look at the
  // button on the very next frame (in this test mode a checkpoint saves in milliseconds).
  const during = await button.evaluate(
    async (b: { click(): void; disabled: boolean; textContent: string | null }) => {
      b.click()
      b.click()
      b.click()
      await new Promise((r) =>
        (
          globalThis as unknown as { requestAnimationFrame(cb: () => void): void }
        ).requestAnimationFrame(() => r(null)),
      )
      return { disabled: b.disabled, text: b.textContent }
    },
  )
  expect(during).toEqual({ disabled: true, text: 'Saving…' })
  await expect(button).toBeEnabled({ timeout: 15_000 })
  await expect(button).toHaveText(/Checkpoint now/)
  const after = (
    (await page.evaluate("window.savespace.invoke('checkpoints:list', {})")) as unknown[]
  ).length
  expect(after - before).toBe(1)
  await app.close()
})

test('Apps page: turn reading/reopening off per app, and ask for macOS permission', async () => {
  const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
  const page = await windowByRoute(app, '/')
  await page.getByRole('button', { name: 'Apps', exact: true }).click()
  const chrome = page
    .getByRole('region', { name: 'Google Chrome' })
    .or(page.locator('[aria-label="Google Chrome"]'))
    .first()
  await expect(chrome).toBeVisible()
  await expect(chrome.getByRole('button', { name: /Allow…/ })).toBeVisible()
  await chrome.getByRole('switch', { name: 'Reopen Google Chrome when resuming' }).click()
  await chrome.getByRole('switch', { name: 'Save what’s open in Google Chrome' }).click()
  await expect(chrome.getByText(/won’t read Google Chrome or send it any requests/)).toBeVisible()
  await expect(
    chrome.getByRole('switch', { name: 'Save what’s open in Google Chrome' }),
  ).toHaveAttribute('aria-checked', 'false')
  await expect(
    chrome.getByRole('switch', { name: 'Reopen Google Chrome when resuming' }),
  ).toHaveAttribute('aria-checked', 'false')
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/apps-page.png' })
  const s = (await page.evaluate("window.savespace.invoke('settings:get')")) as {
    appsCaptureOff: string[]
    appsRestoreOff: string[]
  }
  expect(s).toMatchObject({ appsCaptureOff: ['chrome'], appsRestoreOff: ['chrome'] })

  // Restore preview now skips Chrome's tabs, saying why.
  await page.getByRole('button', { name: /Atlas API/ }).click()
  await page.getByRole('button', { name: 'Preview restore' }).click()
  const dialog = page.getByRole('dialog', { name: 'Preview restore' })
  await expect(
    dialog.getByText('Reopening Google Chrome is turned off (Apps page)').first(),
  ).toBeVisible()
  await app.close()
})

test('Checkpoint now lives in the timeline header and saves for the open project', async () => {
  const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
  const page = await windowByRoute(app, '/')
  // No Checkpoint now button above the sidebar any more.
  const nav = page.getByRole('navigation', { name: 'Projects and sections' })
  await expect(nav.getByRole('button', { name: /Checkpoint now/ })).toHaveCount(0)
  const timeline = page.getByRole('region', { name: 'Checkpoint timeline' })
  await expect(timeline.getByRole('heading', { name: 'All checkpoints' })).toBeVisible()
  await expect(timeline.getByRole('button', { name: 'Checkpoint now' })).toBeVisible()

  await nav.getByRole('button', { name: /Atlas API/ }).click()
  await expect(timeline.getByRole('heading', { name: 'Atlas API' })).toBeVisible()
  const projects = (await page.evaluate("window.savespace.invoke('projects:list')")) as {
    id: string
    name: string
  }[]
  const atlas = projects.find((p) => p.name === 'Atlas API')!
  const count = async () =>
    (
      (await page.evaluate(
        `window.savespace.invoke('checkpoints:list', { projectId: '${atlas.id}' })`,
      )) as unknown[]
    ).length
  const before = await count()
  const button = timeline.getByRole('button', { name: /Checkpoint now|Saving/ })
  await button.click()
  await expect(button).toHaveText(/Checkpoint now/, { timeout: 15_000 })
  await expect.poll(count).toBe(before + 1)
  await app.close()
})

test('deleting a checkpoint asks first, and Cancel keeps it', async () => {
  const { app } = await launchApp({ SAVESPACE_E2E_SEED: '1', SAVESPACE_DRY_RUN: '1' })
  const page = await windowByRoute(app, '/')
  const count = async () =>
    ((await page.evaluate("window.savespace.invoke('checkpoints:list', {})")) as unknown[]).length
  const before = await count()
  await page.getByText('Checkpoint evidence and saved items').click()
  await page.getByRole('button', { name: 'Delete checkpoint' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete this checkpoint?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/Your files, tabs and apps stay exactly as they are/)).toBeVisible()
  await expect(dialog.getByText(/saved items?/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.waitForTimeout(300) // let the entrance animation finish
  await page.screenshot({ path: 'test-results/delete-checkpoint.png' })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(await count()).toBe(before)

  await page.getByRole('button', { name: 'Delete checkpoint' }).click()
  await dialog.getByRole('button', { name: 'Delete checkpoint' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Checkpoint deleted')).toBeVisible()
  await expect.poll(count).toBe(before - 1)
  await app.close()
})
