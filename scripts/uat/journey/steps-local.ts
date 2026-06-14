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
async function configFailureStep(
  ctx: JourneyContext,
  fields: { host?: string; username?: string; password?: string },
  expectCat: string,
  causeRe: RegExp,
  id: string,
  title: string,
): Promise<Verdict> {
  // 1. Apply the config state through the UI (the one thing REST cannot do).
  const page = await ctx.ui.open()
  try {
    await ctx.ui.fillConfig(page, fields)
  } finally {
    await ctx.ui.close()
  }

  // 2. Locate the connection.
  const connId = await ctx.http.findConnectionId(ctx.config.label)
  if (!connId) return fail(id, title, 1, { note: `connection '${ctx.config.label}' not found — run SETUP` })

  // 3. Mark logs, then force a fresh attempt so the cause is logged AFTER the mark.
  const m = ctx.logs.mark()
  await ctx.http.restart(connId)

  // 4. Triple-check: REST status category + log proof of the cause.
  const st = await ctx.http.status(connId)
  const logged = ctx.logs.detect(m, ctx.config.label, causeRe)
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
        { host: ctx.config.nvxHost, username: 'admin', password: '' },
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
        { host: '192.0.2.1', username: 'admin', password: 'whatever' },
        'error',
        /timeout|nvx timeout|econn|connection fail/i,
        'CFG-UNREACHABLE',
        'unreachable IP → ConnectionFailure',
      ),
  },
]
