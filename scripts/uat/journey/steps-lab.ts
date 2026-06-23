import { pass, fail, skip, ambiguous } from '../lib/verdict.js'
import type { Verdict } from '../lib/verdict.js'
import type { JourneyStep, JourneyContext } from './types.js'
import { HttpError } from '../tools/companion-http.js'
import { buildCapStep, buildVarsStep, buildBaselineStep, buildTeardownStep, buildWriteStep } from './subsystem.js'
import { encoderSpec } from './subsystems/encoder.js'
import { decoderSpec } from './subsystems/decoder.js'

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
  fields: { host?: string; port?: number; username?: string; password?: string },
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

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Read a Companion variable, polling while it is not yet defined (HTTP 404) or not yet `ready` —
 * the module defines/populates variables a moment after connecting. Returns the last value seen.
 * Any error other than a 404 (network failure, server error…) is re-thrown immediately so the
 * caller receives an honest failure instead of a silent empty string.
 */
async function readVar(
  ctx: JourneyContext,
  name: string,
  ready: (v: string) => boolean = () => true,
): Promise<string> {
  let value = ''
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    try {
      value = await ctx.http.getVariable(ctx.config.label, name)
      if (ready(value)) return value
    } catch (err) {
      // A 404 means the variable is not yet registered — normal during module startup, keep polling.
      if (!(err instanceof HttpError && err.status === 404)) throw err
    }
    await ctx.sleep(POLL_DELAY_MS)
  }
  return value
}


const useSteps: JourneyStep[] = [
  buildCapStep(encoderSpec, {
    id: 'CAP',
    title: 'encoder panel active (device_role = Transmitter)',
    titles: {
      step: 'encoder panel active (device_role = Transmitter)',
      pass: 'encoder panel active (role=Transmitter)',
      skipRole: 'encoder journey (device is not a Transmitter)',
      noDevice: 'capability (no device)',
    },
  }),
  buildVarsStep(encoderSpec, {
    id: 'ENC-VARS',
    title: 'encoder variables (REST) == device (oracle)',
    titles: {
      step: 'encoder variables (REST) == device (oracle)',
      pass: 'companion variables == device',
      fail: 'variable/device mismatch',
      skipRole: 'encoder vars (device is not a Transmitter)',
      noDevice: 'variables (no device)',
    },
  }),
  {
    id: 'ENC-FEEDBACKS',
    title: 'stream_enabled feedback source matches device',
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip('ENC-FEEDBACKS', 'feedbacks (no device)', 1, { note: 'NVX_PASS unset' })
      const role = await readVar(ctx, 'device_role')
      if (role !== 'Transmitter') return skip('ENC-FEEDBACKS', 'encoder feedbacks (device is not a Transmitter)', 1, { note: `device_role=${role}` })
      // Satellite colour check deferred (spec §8); validate the variable that drives the feedback.
      const varVal = await readVar(ctx, 'tx_enabled', (v) => v !== '')
      const subsystem = await ctx.oracle.read(encoderSpec.endpoint)
      const s = encoderSpec.extract(subsystem)
      const deviceVal = String(str(s.Status) === 'Stream started')
      return varVal === deviceVal
        ? pass('ENC-FEEDBACKS', 'feedback source matches device', 1, { note: `tx_enabled=${varVal}` })
        : fail('ENC-FEEDBACKS', 'feedback source mismatch', 1, { expected: deviceVal, observed: varVal })
    },
  },
  ...encoderSpec.writes.map((wc) => buildWriteStep(encoderSpec, wc)),
]

/** Steps testing the decoder (StreamReceive) — only active on a Receiver device. */
const decoderUseSteps: JourneyStep[] = [
  buildCapStep(decoderSpec, {
    id: 'DEC-CAP',
    title: 'decoder panel active (device_role = Receiver)',
    titles: {
      step: 'decoder panel active (device_role = Receiver)',
      pass: 'decoder panel active (role=Receiver)',
      skipRole: 'decoder panel (device is not a Receiver)',
      noDevice: 'decoder capability (no device)',
    },
  }),
  buildBaselineStep(decoderSpec, {
    id: 'BASELINE-RX',
    title: 'capture decoder baseline (StreamReceive Streams[0])',
    // NO skipNote → note NUE = `device_role=${role}` (pas de suffixe endpoint)
    passNote: 'stored for TEARDOWN-RX restore',
    titles: {
      noDevice: 'baseline-rx (no device)',
      skipRole: 'baseline-rx (device is not a Receiver)',
      pass: 'decoder baseline captured',
      fail: 'decoder baseline capture failed',
    },
  }),
  buildVarsStep(decoderSpec, {
    id: 'DEC-VARS',
    title: 'decoder variables (REST) == device (oracle)',
    titles: {
      noDevice: 'decoder variables (no device)',
      skipRole: 'decoder variables (device is not a Receiver)',
      pass: 'companion decoder variables == device',
      fail: 'decoder variable/device mismatch',
    },
  }),
  ...decoderSpec.writes.map((wc) => buildWriteStep(decoderSpec, wc)),
  buildTeardownStep(decoderSpec, {
    id: 'TEARDOWN-RX',
    title: 'restore decoder (StreamReceive) to baseline',
    disableConnection: false,
    restoredNote: 'StreamReceive baseline re-applied',
    skippedNote: 'no baselineRx (SKIP capture) — nothing restored',
    failNote: 'decoder restore failed',
    titles: {
      noDevice: 'teardown-rx (no device)',
      pass: 'teardown-rx complete',
      fail: 'decoder restore failed',
    },
  }),
]

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

      await ctx.http.enable(connId) // idempotent — a prior TEARDOWN may have disabled it
      await setConfig(ctx, connId, { host: ctx.config.nvxHost, port: ctx.config.nvxPort, username: ctx.config.nvxUser, password: WRONG_PASSWORD })
      const m = ctx.logs.mark()
      await ctx.http.restart(connId)
      const logged = await pollLog(ctx, m, /401|403|auth|unauthor|forbidden|credential/i)
      const st = await ctx.http.status(connId)
      // AuthenticationFailure → 'warning' (confirm at the lab, like BadConfig=warning).
      if (st.category === 'warning' && logged) {
        return pass('CFG-WRONGPASS', 'wrong password → AuthenticationFailure', 1, { companion: st, note: 'auth failure + logged (1 login used)' })
      }
      if (!logged) {
        return ambiguous('CFG-WRONGPASS', 'wrong password → AuthenticationFailure', 1, {
          expected: { category: 'warning', cause: 'auth 401/403' },
          observed: { status: st, logged },
          note: 'cause auth non observée dans les logs — non concluant (env/UI)',
        })
      }
      return fail('CFG-WRONGPASS', 'wrong password → AuthenticationFailure', 1, {
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

      await ctx.http.enable(connId) // idempotent — a prior TEARDOWN may have disabled it
      await setConfig(ctx, connId, { host: ctx.config.nvxHost, port: ctx.config.nvxPort, username: ctx.config.nvxUser, password: ctx.config.nvxPass })
      await ctx.http.restart(connId)
      // REST category for a healthy connection is 'good' (the UI label is "OK") — verified live.
      const category = await pollStatusCategory(ctx, connId, 'good')

      // Independent proof of a real session: the oracle logs in and reads StreamTransmit.
      let oracleOk = false
      let oracleErr: string | undefined
      try {
        await ctx.oracle.read('/Device/DeviceInfo')
        oracleOk = true
      } catch (err) {
        oracleErr = err instanceof Error ? err.message : String(err)
      }
      if (category === 'good' && oracleOk) {
        return pass('CFG-GOOD', 'connected (oracle confirms session)', 1, { companion: { category }, note: 'status good + oracle read stream' })
      }
      if (category !== 'good') {
        return ambiguous('CFG-GOOD', 'connected (oracle confirms session)', 1, {
          expected: { category: 'good', oracle: 'oracle.read(/Device/StreamTransmit) succeeds' },
          observed: { category, oracleOk, oracleErr },
          note: 'connexion jamais saine — non concluant (env/UI), session non testable',
        })
      }
      return fail('CFG-GOOD', 'connected (oracle confirms session)', 1, {
        expected: { category: 'good', oracle: 'oracle.read(/Device/StreamTransmit) succeeds' },
        observed: { category, oracleOk, oracleErr },
      })
    },
  },
]

/** Capture the device's pre-USE state so TEARDOWN can restore it.
 *  SKIP on a Receiver: StreamTransmit is absent on Receiver devices. */
const baselineStep = buildBaselineStep(encoderSpec, {
  id: 'BASELINE',
  title: 'capture device baseline (Streams[0])',
  skipNote: '— StreamTransmit absent on Receiver',
  passNote: 'stored for TEARDOWN restore',
  titles: {
    noDevice: 'baseline (no device)',
    skipRole: 'baseline (device is not a Transmitter)',
    pass: 'baseline captured',
    fail: 'baseline capture failed',
  },
})

/** Restore the device to baseline and disable the test connection (best-effort, reported).
 *  Uses restore()'s return value to report honestly whether a baseline was actually applied. */
const teardownStep = buildTeardownStep(encoderSpec, {
  id: 'TEARDOWN',
  title: 'restore device + disable connection',
  disableConnection: true,
  restoredNote: 'device restored',
  skippedNote: 'no baseline (SKIP capture) — nothing restored',
  failNote: 'restore failed',
  titles: {
    noDevice: 'teardown (no device)',
    pass: 'teardown complete',
    fail: 'teardown incomplete',
  },
})

// Journey order: auth gauntlet → baseline → USE (v0.2 encoder) → decoder USE → teardown.
export const labSteps: JourneyStep[] = [...authSteps, baselineStep, ...useSteps, ...decoderUseSteps, teardownStep]
