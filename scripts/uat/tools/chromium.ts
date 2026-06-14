import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'

/**
 * Drives the Companion web UI for the two things REST cannot do: confirm the module is
 * installable and fill a connection's config form. Uses the SYSTEM Google Chrome via
 * `channel: 'chrome'` (playwright-core is global + npm-linked, no bundled browser download).
 *
 * Navigation FLOW is verified (Wave 0, discovery-notes.md §4):
 *   onboarding modals → Welcome:Cancel, What's New:X → add-connection search "NVX" → Add → form.
 * The form-field LOCATORS are a documented hypothesis (Wave 0 could not reach the form to
 * confirm them) — to be validated live in Wave 2 Task 2.3 against companion-uat. fillByLabel()
 * therefore tries getByLabel first, then falls back to label-text → adjacent input.
 */
export class CompanionUi {
  private browser?: Browser
  constructor(private base = 'http://localhost:8000') {}

  async open(): Promise<Page> {
    this.browser = await chromium.launch({ channel: 'chrome', headless: true })
    const page = await this.browser.newPage()
    await page.goto(this.base, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await this.dismissOnboarding(page)
    return page
  }

  async close(): Promise<void> {
    await this.browser?.close()
    this.browser = undefined
  }

  /** Dismiss the onboarding modals if present. Tolerant: a re-opened Companion shows neither. */
  private async dismissOnboarding(page: Page): Promise<void> {
    // "Welcome to Companion" wizard → Cancel.
    const cancel = page.getByRole('button', { name: /^cancel$/i })
    if (await cancel.first().isVisible().catch(() => false)) {
      await cancel.first().click().catch(() => {})
    }
    // "What's New in Companion" → X button (does NOT close on Escape/Cancel — Wave 0 finding).
    const close = page.getByRole('button', { name: /close/i })
    if (await close.first().isVisible().catch(() => false)) {
      await close.first().click().catch(() => {})
    }
  }

  /** True if the module shows up when searching the add-connection list. */
  async moduleAvailable(page: Page, moduleName: string): Promise<boolean> {
    const search = page.getByPlaceholder(/search/i).first()
    if (await search.isVisible().catch(() => false)) {
      await search.fill(moduleName)
    }
    // Wave 0: result row reads "Crestron: DM-NVX-350; DM-NVX-351; DM-NVX-363; DM-NVX-E50".
    return (await page.getByText(moduleName, { exact: false }).count()) > 0
  }

  /** Fill an existing connection's config form, then Save. Locators per discovery-notes.md §4. */
  async fillConfig(
    page: Page,
    fields: { host?: string; username?: string; password?: string },
  ): Promise<void> {
    if (fields.host !== undefined) await this.fillByLabel(page, 'Device IP / Hostname', fields.host)
    if (fields.username !== undefined) await this.fillByLabel(page, 'Username', fields.username)
    if (fields.password !== undefined) await this.fillByLabel(page, 'Password', fields.password)
    const save = page.getByRole('button', { name: /save/i }).first()
    if (await save.isVisible().catch(() => false)) await save.click()
  }

  /**
   * Fill an input identified by its label text. Companion's form has no data-testid and no
   * label/for association (Wave 0), so: try getByLabel, else the input following the label.
   */
  private async fillByLabel(page: Page, labelText: string, value: string): Promise<void> {
    const byLabel = page.getByLabel(labelText, { exact: false })
    if (await byLabel.first().isVisible().catch(() => false)) {
      await byLabel.first().fill(value)
      return
    }
    const adjacent = page
      .locator('label', { hasText: labelText })
      .locator('xpath=following::input[1]')
      .first()
    await adjacent.fill(value)
  }
}
