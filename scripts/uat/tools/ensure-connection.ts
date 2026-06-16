import type { CompanionHttp } from './companion-http.js'
import type { CompanionUi } from './chromium.js'

/**
 * Ensure a Companion connection with `label` exists, is configured, enabled and restarted.
 * - If absent: creates it via UI then fills config.
 * - If present: opens its config editor then fills config (realignment).
 * - In both cases: enables + restarts via REST.
 * - NEVER deletes an existing connection.
 *
 * `page` is typed `unknown` to avoid importing playwright-core in unit tests.
 * Production callers pass a real Playwright `Page`.
 */
export async function ensureConnection(
  deps: {
    http: Pick<CompanionHttp, 'findConnectionId' | 'enable' | 'restart'>
    ui:   Pick<CompanionUi,   'createConnection' | 'openConnectionConfig' | 'fillConfig'>
    page: unknown
  },
  label: string,
  config: { host: string; port: number; username?: string; password?: string },
): Promise<void> {
  const { http, ui, page } = deps

  let id = await http.findConnectionId(label)

  if (id == null) {
    // Connection absent: create it (leaves config editor open), then resolve the new id.
    await ui.createConnection(page as Parameters<CompanionUi['createConnection']>[0], label)
    id = await http.findConnectionId(label)
    if (id == null) throw new Error(`ensureConnection: created connection '${label}' but could not resolve its id`)
    // Fill config — editor is already open after createConnection.
    await ui.fillConfig(page as Parameters<CompanionUi['fillConfig']>[0], config)
  } else {
    // Connection exists: open its config editor for realignment.
    await ui.openConnectionConfig(page as Parameters<CompanionUi['openConnectionConfig']>[0], id)
    await ui.fillConfig(page as Parameters<CompanionUi['fillConfig']>[0], config)
  }

  // In both branches: enable + restart (id is now resolved — guard above ensures non-null).
  await http.enable(id)
  await http.restart(id)
}
