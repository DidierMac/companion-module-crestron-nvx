import { pass, fail, skip } from '../lib/verdict.js'
import type { Verdict } from '../lib/verdict.js'
import type { JourneyStep, JourneyContext } from './types.js'

// A deliberately wrong password — never the real one, no secret handling.
const WRONG_PASSWORD = 'uat-deliberately-wrong-pw'

const POLL_ATTEMPTS = 15
const POLL_DELAY_MS = 1000

/** Lab steps require a reachable device; without NVX_PASS they SKIP (not FAIL). */
function noDevice(ctx: JourneyContext): boolean {
  return !ctx.config.nvxPass
}

/** Apply a config state through the UI (the one thing REST cannot do). */
async function setConfig(
  ctx: JourneyContext,
  connId: string,
  fields: { host?: string; username?: string; password?: string },
): Promise<void> {
  const page = await ctx.ui.open()
  try {
    await ctx.ui.openConnectionConfig(page, connId)
    await ctx.ui.fillConfig(page, fields)
  } finally {
    await ctx.ui.close()
  }
}

/** Poll the REST status until its category equals `wantCat` (or attempts run out). */
async function pollStatusCategory(ctx: JourneyContext, connId: string, wantCat: string): Promise<string> {
  let category = ''
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    category = (await ctx.http.status(connId)).category
    if (category === wantCat) break
    await ctx.sleep(POLL_DELAY_MS)
  }
  return category
}

/** Wait (bounded) for a log line matching `re` to appear for our label since `mark`. */
async function pollLog(ctx: JourneyContext, mark: { ts: string }, re: RegExp): Promise<boolean> {
  let logged = false
  for (let i = 0; i < POLL_ATTEMPTS && !logged; i++) {
    logged = ctx.logs.detect(mark, ctx.config.label, re)
    if (!logged) await ctx.sleep(POLL_DELAY_MS)
  }
  return logged
}

const authSteps: JourneyStep[] = [
  {
    // ⚠️ Consumes exactly ONE login failure from the NVX lockout budget (~3 → 15min block).
    // The module does NOT retry on AuthenticationFailure (api.ts login throws once) — lockout-safe.
    id: 'CFG-WRONGPASS',
    title: 'wrong password → AuthenticationFailure',
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip('CFG-WRONGPASS', 'wrong password (no device)', 1, { note: 'NVX_PASS unset' })
      const connId = await ctx.http.findConnectionId(ctx.config.label)
      if (!connId) return fail('CFG-WRONGPASS', 'wrong password', 1, { note: `connection '${ctx.config.label}' not found` })

      await setConfig(ctx, connId, { host: ctx.config.nvxHost, username: 'admin', password: WRONG_PASSWORD })
      const m = ctx.logs.mark()
      await ctx.http.restart(connId)
      const logged = await pollLog(ctx, m, /401|403|auth|unauthor|forbidden|credential/i)
      const st = await ctx.http.status(connId)
      // AuthenticationFailure → 'warning' (confirm at the lab, like BadConfig=warning).
      return st.category === 'warning' && logged
        ? pass('CFG-WRONGPASS', 'wrong password → AuthenticationFailure', 1, { companion: st, note: 'auth failure + logged (1 login used)' })
        : fail('CFG-WRONGPASS', 'wrong password → AuthenticationFailure', 1, {
            expected: { category: 'warning', cause: 'auth 401/403' },
            observed: { status: st, logged },
          })
    },
  },
  {
    id: 'CFG-GOOD',
    title: 'good password + host → connected (oracle confirms session)',
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip('CFG-GOOD', 'good password (no device)', 1, { note: 'NVX_PASS unset' })
      const connId = await ctx.http.findConnectionId(ctx.config.label)
      if (!connId) return fail('CFG-GOOD', 'good password', 1, { note: `connection '${ctx.config.label}' not found` })

      await setConfig(ctx, connId, { host: ctx.config.nvxHost, username: 'admin', password: ctx.config.nvxPass })
      await ctx.http.restart(connId)
      const category = await pollStatusCategory(ctx, connId, 'ok')

      // Independent proof of a real session: the oracle logs in and reads Streams[0].
      let oracleOk = false
      let oracleErr: string | undefined
      try {
        await ctx.oracle.readStream0()
        oracleOk = true
      } catch (err) {
        oracleErr = err instanceof Error ? err.message : String(err)
      }
      return category === 'ok' && oracleOk
        ? pass('CFG-GOOD', 'connected (oracle confirms session)', 1, { companion: { category }, note: 'status ok + oracle read stream' })
        : fail('CFG-GOOD', 'connected (oracle confirms session)', 1, {
            expected: { category: 'ok', oracle: 'readStream0 succeeds' },
            observed: { category, oracleOk, oracleErr },
          })
    },
  },
]

export const labSteps: JourneyStep[] = [...authSteps]
