import { pass, fail } from '../lib/verdict.js'
import type { Verdict } from '../lib/verdict.js'
import type { JourneyStep, JourneyContext } from './types.js'

/**
 * A config-failure step: set the connection's config via Chromium, then force a fresh
 * connection attempt via REST and assert the SPEC §4 triple-check —
 *   REST status category == expected  AND  the logs prove the cause.
 *
 * Log timing is deterministic: mark() is stamped BEFORE restart(), so the cause is always
 * logged after the mark (no reliance on enable() being non-idempotent).
 */
// The NVX timeout logs ~5s after a restart (Wave 2 Task 2.3). In a "warm" run (a connection
// switching from a reachable host to an unreachable one) the 10s device timeout + reconnect
// latency can exceed 15s, so poll up to ~30s.
const LOG_POLL_ATTEMPTS = 30
const LOG_POLL_DELAY_MS = 1000

async function configFailureStep(
  ctx: JourneyContext,
  fields: { host?: string; username?: string; password?: string },
  expectCat: string,
  causeRe: RegExp,
  id: string,
  title: string,
): Promise<Verdict> {
  // 1. Locate the connection (REST) — needed to deep-link its config editor.
  const connId = await ctx.http.findConnectionId(ctx.config.label)
  if (!connId) return fail(id, title, 1, { note: `connection '${ctx.config.label}' not found — run SETUP` })

  // 1b. Ensure it is enabled (idempotent) — a prior TEARDOWN may have disabled it, and the
  //     config form is only editable while the connection is enabled.
  await ctx.http.enable(connId)

  // 2. Apply the config state through the UI (the one thing REST cannot do).
  const page = await ctx.ui.open()
  try {
    await ctx.ui.openConnectionConfig(page, connId)
    await ctx.ui.fillConfig(page, fields)
  } finally {
    await ctx.ui.close()
  }

  // 3. Mark logs, then force a fresh attempt so the cause is logged AFTER the mark.
  const m = ctx.logs.mark()
  await ctx.http.restart(connId)

  // 4. Wait (bounded) for the cause to appear in the logs — the category is already sticky,
  //    but the proof line lands only after the NVX attempt completes.
  let logged = false
  for (let i = 0; i < LOG_POLL_ATTEMPTS && !logged; i++) {
    logged = ctx.logs.detect(m, ctx.config.label, causeRe)
    if (!logged) await ctx.sleep(LOG_POLL_DELAY_MS)
  }

  // 5. Triple-check: REST status category + log proof of the cause.
  const st = await ctx.http.status(connId)
  return st.category === expectCat && logged
    ? pass(id, title, 1, { companion: st, note: `status=${expectCat} + cause logged` })
    : fail(id, title, 1, {
        expected: { category: expectCat, cause: String(causeRe) },
        observed: { status: st, logged },
      })
}

export const localSteps: JourneyStep[] = [
  {
    id: 'INSTALL',
    title: 'module crestron-nvx available in Companion',
    scope: 'local',
    run: async (ctx) => {
      const page = await ctx.ui.open()
      try {
        const ok = await ctx.ui.moduleAvailable(page, 'NVX')
        return ok
          ? pass('INSTALL', 'module available', 1, {})
          : fail('INSTALL', 'module not available', 1, {})
      } finally {
        await ctx.ui.close()
      }
    },
  },
  {
    id: 'CFG-NOPASS',
    title: 'empty password → BadConfig',
    scope: 'local',
    run: (ctx) =>
      configFailureStep(
        ctx,
        { host: ctx.config.nvxHost, username: ctx.config.nvxUser, password: '' },
        'warning', // BadConfig → warning (confirm live in Task 2.3)
        /no password|bad ?config|missing|credential/i,
        'CFG-NOPASS',
        'empty password → BadConfig',
      ),
  },
  {
    id: 'CFG-UNREACHABLE',
    title: 'unreachable IP → ConnectionFailure',
    scope: 'local',
    run: (ctx) =>
      configFailureStep(
        ctx,
        { host: '192.0.2.1', username: ctx.config.nvxUser, password: 'whatever' },
        'error',
        /timeout|nvx timeout|econn|connection fail|unreach|refused|hang up|network error/i,
        'CFG-UNREACHABLE',
        'unreachable IP → ConnectionFailure',
      ),
  },
]
