import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'

/**
 * Drives the Companion web UI for the two things REST cannot do: confirm the module is
 * installable and fill a connection's config form. Uses the SYSTEM Google Chrome via
 * `channel: 'chrome'` (playwright-core is global + npm-linked, no bundled browser download).
 *
 * Selectors are VERIFIED live against Companion 4.3.4 (Wave 2 Task 2.3):
 *   - Config inputs have no name/id/placeholder and no <label for> association
 *     → target by label text node, then the following input in document order.
 *   - The connection editor deep-links to /connections/<id>.
 *   - Save is enabled only when the form has pending changes (fillConfig always changes).
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

  /**
   * Dismiss the onboarding modals (Welcome wizard, "What's New"). A fresh browser context
   * renders them a moment AFTER domcontentloaded, so poll briefly and close whatever appears.
   * The "What's New" close control is `.btn-close[aria-label="Close"]` (verified Task 2.3).
   */
  private async dismissOnboarding(page: Page): Promise<void> {
    for (let i = 0; i < 6; i++) {
      const modal = page.locator('.modal.show').first()
      if (!(await modal.isVisible().catch(() => false))) {
        if (i < 2) {
          await page.waitForTimeout(800) // give late-rendering modals a chance
          continue
        }
        return
      }
      const closeX = modal.locator('.btn-close, button[aria-label="Close"]').first()
      const cancel = modal.getByRole('button', { name: /^cancel$/i }).first()
      if (await closeX.isVisible().catch(() => false)) await closeX.click().catch(() => {})
      else if (await cancel.isVisible().catch(() => false)) await cancel.click().catch(() => {})
      await page.waitForTimeout(400)
    }
  }

  /**
   * True if the crestron-nvx module is present in the connections page. Checks DOM presence
   * (count), NOT visibility — many matches live in the collapsed sidebar. If the module were
   * absent, its "DM-NVX" label would not render (connections would show "Unknown module").
   * Polls briefly to absorb async list loading.
   */
  async moduleAvailable(page: Page, moduleName = 'DM-NVX'): Promise<boolean> {
    for (let i = 0; i < 10; i++) {
      if ((await page.getByText(moduleName, { exact: false }).count()) > 0) return true
      await page.waitForTimeout(500)
    }
    return false
  }

  /** Open a connection's config editor by deep-linking to /connections/<id>. */
  async openConnectionConfig(page: Page, connectionId: string): Promise<void> {
    await page.goto(`${this.base}/connections/${connectionId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    })
    await this.dismissOnboarding(page) // a full reload can re-show the modals
    // Wait for the form to render (the host label is always present).
    await page.getByText('Device IP / Hostname', { exact: true }).first().waitFor({ timeout: 10000 })
  }

  /** Fill the currently-open config form, then Save. Locators per the verified strategy. */
  async fillConfig(
    page: Page,
    fields: { host?: string; username?: string; password?: string },
  ): Promise<void> {
    if (fields.host !== undefined) await this.fillByLabel(page, 'Device IP / Hostname', fields.host)
    if (fields.username !== undefined) await this.fillByLabel(page, 'Username', fields.username)
    if (fields.password !== undefined) await this.fillByLabel(page, 'Password', fields.password)
    // Save is enabled only when there are pending changes.
    const save = page.getByRole('button', { name: /^save$/i }).first()
    if (await save.isEnabled().catch(() => false)) await save.click()
  }

  /**
   * Fill the input that follows a label text node in document order. The config form has no
   * <label for> / name / id, so this is the reliable strategy (verified Wave 2 Task 2.3).
   */
  private async fillByLabel(page: Page, labelText: string, value: string): Promise<void> {
    const input = page.locator(`xpath=//*[normalize-space(text())="${labelText}"]/following::input[1]`).first()
    await input.fill(value)
  }
}
