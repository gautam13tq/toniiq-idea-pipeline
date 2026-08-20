import { test, expect } from '@playwright/test'

/** @type {import('@playwright/test').Page} */
let page
const consoleErrors = []

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name}. Source ~/.config/toniiq-npd/smoke.env before running.`)
  }
  return value
}

function isAllowlistedConsoleError(text) {
  if (/Failed to load resource.*favicon/i.test(text)) return true
  if (/favicon\.ico.*404/i.test(text)) return true
  return false
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (!isAllowlistedConsoleError(text)) {
      consoleErrors.push({ url: page.url(), text })
    }
  })
})

test.afterAll(async () => {
  await page?.close()
})

test('login flow completes and leaves the login screen', async () => {
  const email = requireEnv('SMOKE_EMAIL')
  const password = requireEnv('SMOKE_PASSWORD')

  await page.goto('/')
  await expect(page.getByText('Product Development Platform')).toBeVisible()
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()

  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()

  await expect(page.getByRole('button', { name: 'Sign In' })).not.toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Evaluation' })).toBeVisible({ timeout: 15_000 })
})

test('pipeline decide surface loads without errors or blank shell', async () => {
  await page.goto('/pipeline/decide')
  await expect(page.getByRole('heading', { name: 'Evaluation' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Loading...')).not.toBeVisible({ timeout: 30_000 })

  await expect(page.getByText(/Couldn't load the evaluation queue/)).not.toBeVisible()

  const main = page.locator('main').last()
  const mainText = (await main.innerText()).trim()
  expect(mainText.length).toBeGreaterThan(30)

  const hasEmptyState = await page.getByText('Nothing in evaluation right now.').isVisible()
  const hasIdeaCard = (await page.locator('main a[href*="/discovery/"]').count()) > 0
  const hasConceptCard = (await page.locator('main a[href*="/concepts/"]').count()) > 0
  expect(hasEmptyState || hasIdeaCard || hasConceptCard).toBe(true)
})

test('discover tabs render and switching tabs changes content', async () => {
  await page.goto('/discover')
  await expect(page).toHaveURL(/\/discover\/shortlist/)

  for (const label of ['Signals', 'AI Picks', 'Categories', 'Shortlist']) {
    await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible()
  }

  await expect(page.getByRole('heading', { name: 'Opportunity Queue' })).toBeVisible({ timeout: 30_000 })
  const shortlistSnippet = (await page.locator('main').last().innerText()).slice(0, 400)

  await page.getByRole('link', { name: 'AI Picks', exact: true }).click()
  await expect(page).toHaveURL(/\/discover\/picks/)
  await expect(page.getByRole('heading', { name: 'Market Atlas' })).toBeVisible({ timeout: 30_000 })

  const picksSnippet = (await page.locator('main').last().innerText()).slice(0, 400)
  expect(picksSnippet).not.toBe(shortlistSnippet)
})

test('development surface shows queue tabs and product rows', async () => {
  await page.goto('/development')
  await expect(page.getByRole('heading', { name: 'Development Cockpit' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Loading...')).not.toBeVisible({ timeout: 30_000 })

  await expect(page.getByRole('button', { name: /^Active \d+/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Bench \d+/ })).toBeVisible()

  const registryLine = page.getByText(/\d+ registry products/)
  await expect(registryLine).toBeVisible()
  const count = Number((await registryLine.innerText()).match(/(\d+) registry products/)?.[1] ?? '0')
  expect(count).toBeGreaterThan(0)

  let openButtons = page.getByRole('button', { name: 'Open' })
  if (await openButtons.count() === 0) {
    await page.getByRole('button', { name: /^Ideas \d+/ }).click()
    openButtons = page.getByRole('button', { name: 'Open' })
  }
  await expect(openButtons.first()).toBeVisible()
  expect(await openButtons.count()).toBeGreaterThan(0)
})

test('console stays clean across all visited pages', async () => {
  expect(consoleErrors, formatConsoleErrors(consoleErrors)).toEqual([])
})

function formatConsoleErrors(errors) {
  if (errors.length === 0) return ''
  return errors.map((e) => `${e.url}: ${e.text}`).join('\n')
}
