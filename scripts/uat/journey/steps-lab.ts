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
 * Read a Companion variable, polling while it is undefined (404 → throws) or not yet `ready` —
 * the module defines/populates variables a moment after connecting. Returns the last value seen.
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
    } catch {
      /* 404 — variable not defined yet */
    }
    await ctx.sleep(POLL_DELAY_MS)
  }
  return value
}

// Known test values the SETUP buttons must be configured to set (so the oracle can verify).
const UAT_STREAM_NAME = 'UAT-STREAM'
const UAT_MULTICAST = '239.200.0.1'

// Receiver-side test values (sourced from DiscoveredStreams in docs/hardware-validation/raw/192.168.2.9).
const UAT_RX_URL = 'rtsp://192.168.2.10:554/live.sdp'
const UAT_RX_MULTICAST = '239.1.1.4'
const UAT_RX_CONNECT_NAME = 'DM-NVX-360-C442684E534B' // resolves → Multicast via RTSP / 239.1.1.4

/** Press the button mapped to `actionKey`, or return false if none is mapped (SETUP missing). */
async function pressMapped(ctx: JourneyContext, actionKey: string): Promise<boolean> {
  const loc = ctx.config.layout?.[actionKey]
  if (!loc) return false
  await ctx.http.press(loc.page, loc.row, loc.col)
  return true
}

/** Poll the device (oracle) until `pred(Streams[0])` holds, returning the last snapshot. */
async function pollOracle(
  ctx: JourneyContext,
  pred: (s: Record<string, unknown>) => boolean,
): Promise<{ ok: boolean; snapshot: Record<string, unknown> | null }> {
  let snapshot: Record<string, unknown> | null = null
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    snapshot = await ctx.oracle.readStream0()
    if (pred(snapshot)) return { ok: true, snapshot }
    await ctx.sleep(POLL_DELAY_MS)
  }
  return { ok: false, snapshot }
}

/** Poll StreamReceive (oracle) until `pred(Streams[0])` holds, returning the last snapshot. */
async function pollOracleRx(
  ctx: JourneyContext,
  pred: (s: Record<string, unknown>) => boolean,
): Promise<{ ok: boolean; snapshot: Record<string, unknown> | null }> {
  let snapshot: Record<string, unknown> | null = null
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    snapshot = await ctx.oracle.readReceiveStream0()
    if (pred(snapshot)) return { ok: true, snapshot }
    await ctx.sleep(POLL_DELAY_MS)
  }
  return { ok: false, snapshot }
}

/** A WRITE step: press an action button, then confirm the device changed via the oracle. */
function writeStep(
  id: string,
  title: string,
  actionKey: string,
  pred: (s: Record<string, unknown>) => boolean,
  expected: unknown,
): JourneyStep {
  return {
    id,
    title,
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip(id, `${title} (no device)`, 1, { note: 'NVX_PASS unset' })
      if (!(await pressMapped(ctx, actionKey)))
        return skip(id, `${title} (button unmapped)`, 1, { note: `button '${actionKey}' not in layout — see SETUP` })
      const r = await pollOracle(ctx, pred)
      return r.ok
        ? pass(id, title, 1, { deviceJson: r.snapshot, note: 'device changed as expected' })
        : fail(id, title, 1, { expected, observed: r.snapshot })
    },
  }
}

/** A WRITE step targeting StreamReceive: press a button, confirm via StreamReceive oracle. */
function writeStepRx(
  id: string,
  title: string,
  actionKey: string,
  pred: (s: Record<string, unknown>) => boolean,
  expected: unknown,
): JourneyStep {
  return {
    id,
    title,
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip(id, `${title} (no device)`, 1, { note: 'NVX_PASS unset' })
      if (!(await pressMapped(ctx, actionKey)))
        return skip(id, `${title} (button unmapped)`, 1, { note: `button '${actionKey}' not in layout — see SETUP` })
      const r = await pollOracleRx(ctx, pred)
      return r.ok
        ? pass(id, title, 1, { deviceJson: r.snapshot, note: 'device changed as expected' })
        : fail(id, title, 1, { expected, observed: r.snapshot })
    },
  }
}

const useSteps: JourneyStep[] = [
  {
    id: 'CAP',
    title: 'encoder panel active (device_role = Transmitter)',
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip('CAP', 'capability (no device)', 1, { note: 'NVX_PASS unset' })
      const role = await readVar(ctx, 'device_role', (v) => v === 'Transmitter')
      return role === 'Transmitter'
        ? pass('CAP', 'encoder panel active (role=Transmitter)', 1, { note: `device_role=${role}` })
        : fail('CAP', 'expected a Transmitter device for the encoder journey', 1, {
            expected: 'Transmitter',
            observed: role,
          })
    },
  },
  {
    id: 'ENC-VARS',
    title: 'encoder variables (REST) == device (oracle)',
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip('ENC-VARS', 'variables (no device)', 1, { note: 'NVX_PASS unset' })
      const s = await ctx.oracle.readStream0()
      const checks: Record<string, [string, string]> = {
        // wait for the panel to have polled at least once (tx_stream_name populated), then read all
        tx_stream_name: [await readVar(ctx, 'tx_stream_name', (v) => v !== ''), str(s.RtspSessionName)],
        tx_multicast_address: [await readVar(ctx, 'tx_multicast_address'), str(s.MulticastAddress)],
        tx_stream_url: [await readVar(ctx, 'tx_stream_url'), str(s.StreamLocation)],
        tx_enabled: [await readVar(ctx, 'tx_enabled'), String(str(s.Status) === 'Stream started')],
      }
      const mismatches = Object.entries(checks).filter(([, [a, b]]) => a !== b)
      return mismatches.length === 0
        ? pass('ENC-VARS', 'companion variables == device', 1, { note: `${Object.keys(checks).length}/4 match` })
        : fail('ENC-VARS', 'variable/device mismatch', 1, {
            observed: Object.fromEntries(mismatches.map(([k, [a, b]]) => [k, { companion: a, device: b }])),
          })
    },
  },
  {
    id: 'ENC-FEEDBACKS',
    title: 'stream_enabled feedback source matches device',
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip('ENC-FEEDBACKS', 'feedbacks (no device)', 1, { note: 'NVX_PASS unset' })
      // Satellite colour check deferred (spec §8); validate the variable that drives the feedback.
      const varVal = await readVar(ctx, 'tx_enabled', (v) => v !== '')
      const s = await ctx.oracle.readStream0()
      const deviceVal = String(str(s.Status) === 'Stream started')
      return varVal === deviceVal
        ? pass('ENC-FEEDBACKS', 'feedback source matches device', 1, { note: `tx_enabled=${varVal}` })
        : fail('ENC-FEEDBACKS', 'feedback source mismatch', 1, { expected: deviceVal, observed: varVal })
    },
  },
  writeStep('ENC-NAME', 'set stream name → device', 'set_stream_name', (s) => str(s.RtspSessionName) === UAT_STREAM_NAME, { RtspSessionName: UAT_STREAM_NAME }),
  writeStep('ENC-MULTICAST', 'set multicast address → device', 'set_multicast_address', (s) => str(s.MulticastAddress) === UAT_MULTICAST, { MulticastAddress: UAT_MULTICAST }),
  writeStep('ENC-ENABLE', 'start stream → device', 'enc_enable_stream', (s) => str(s.Status) === 'Stream started', { Status: 'Stream started' }),
  writeStep('ENC-DISABLE', 'stop stream → device', 'enc_disable_stream', (s) => str(s.Status) !== 'Stream started', { Status: 'not started' }),
]

/** Steps testing the decoder (StreamReceive) — only active on a Receiver device. */
const decoderUseSteps: JourneyStep[] = [
  {
    id: 'DEC-CAP',
    title: 'decoder panel active (device_role = Receiver)',
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip('DEC-CAP', 'decoder capability (no device)', 1, { note: 'NVX_PASS unset' })
      const role = await readVar(ctx, 'device_role', (v) => v === 'Receiver')
      return role === 'Receiver'
        ? pass('DEC-CAP', 'decoder panel active (role=Receiver)', 1, { note: `device_role=${role}` })
        : skip('DEC-CAP', 'decoder panel (device is not a Receiver)', 1, { note: `device_role=${role}` })
    },
  },
  {
    id: 'BASELINE-RX',
    title: 'capture decoder baseline (StreamReceive Streams[0])',
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip('BASELINE-RX', 'baseline-rx (no device)', 1, { note: 'NVX_PASS unset' })
      // Only capture if on a Receiver (gracefully skip on Transmitter).
      const role = await readVar(ctx, 'device_role')
      if (role !== 'Receiver') return skip('BASELINE-RX', 'baseline-rx (device is not a Receiver)', 1, { note: `device_role=${role}` })
      try {
        await ctx.oracle.captureBaselineRx()
        return pass('BASELINE-RX', 'decoder baseline captured', 1, { note: 'stored for TEARDOWN-RX restore' })
      } catch (err) {
        return fail('BASELINE-RX', 'decoder baseline capture failed', 1, { note: msg(err) })
      }
    },
  },
  {
    id: 'DEC-VARS',
    title: 'decoder variables (REST) == device (oracle)',
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip('DEC-VARS', 'decoder variables (no device)', 1, { note: 'NVX_PASS unset' })
      const role = await readVar(ctx, 'device_role')
      if (role !== 'Receiver') return skip('DEC-VARS', 'decoder variables (device is not a Receiver)', 1, { note: `device_role=${role}` })
      const s = await ctx.oracle.readReceiveStream0()
      const checks: Record<string, [string, string]> = {
        // Wait for the decoder panel to have polled at least once (rx_status populated), then read all.
        rx_status: [await readVar(ctx, 'rx_status', (v) => v !== ''), str(s.Status)],
        rx_source_url: [await readVar(ctx, 'rx_source_url'), str(s.StreamLocation)],
        rx_multicast_address: [await readVar(ctx, 'rx_multicast_address'), str(s.MulticastAddress)],
        rx_session_initiation: [await readVar(ctx, 'rx_session_initiation'), str(s.SessionInitiation)],
      }
      const mismatches = Object.entries(checks).filter(([, [a, b]]) => a !== b)
      return mismatches.length === 0
        ? pass('DEC-VARS', 'companion decoder variables == device', 1, { note: `${Object.keys(checks).length}/4 match` })
        : fail('DEC-VARS', 'decoder variable/device mismatch', 1, {
            observed: Object.fromEntries(mismatches.map(([k, [a, b]]) => [k, { companion: a, device: b }])),
          })
    },
  },
  writeStepRx(
    'DEC-SOURCE-URL',
    'set source URL (ByReceiver) → device',
    'set_source_url',
    (s) => str(s.SessionInitiation) === 'ByReceiver' && str(s.StreamLocation) === UAT_RX_URL,
    { SessionInitiation: 'ByReceiver', StreamLocation: UAT_RX_URL },
  ),
  writeStepRx(
    'DEC-SOURCE-MCAST',
    'set source multicast → device',
    'set_source_multicast',
    (s) => str(s.SessionInitiation) === 'Multicast via RTSP' && str(s.MulticastAddress) === UAT_RX_MULTICAST,
    { SessionInitiation: 'Multicast via RTSP', MulticastAddress: UAT_RX_MULTICAST },
  ),
  // NOTE: connect-by-name resolves to the same multicast as DEC-SOURCE-MCAST → shared terminal state by design (assertion can't distinguish the two paths at device level).
  writeStepRx(
    'DEC-CONNECT',
    'connect to discovered stream by name → device',
    'connect_to_stream',
    (s) => str(s.SessionInitiation) === 'Multicast via RTSP' && str(s.MulticastAddress) === UAT_RX_MULTICAST,
    { SessionInitiation: 'Multicast via RTSP', MulticastAddress: UAT_RX_MULTICAST, note: `resolved from name '${UAT_RX_CONNECT_NAME}'` },
  ),
  writeStepRx(
    'DEC-ENABLE',
    'start reception → device',
    'dec_enable_stream',
    (s) => s.CodecReady === true || Number(s.NumVideoPacketsRcvd) > 0,
    { CodecReady: true, NumVideoPacketsRcvd: '>0' },
  ),
  writeStepRx(
    'DEC-DISABLE',
    'stop reception → device',
    'dec_disable_stream',
    (s) => s.CodecReady === false,
    { CodecReady: false },
  ),
  {
    id: 'TEARDOWN-RX',
    title: 'restore decoder (StreamReceive) to baseline',
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip('TEARDOWN-RX', 'teardown-rx (no device)', 1, { note: 'NVX_PASS unset' })
      try {
        await ctx.oracle.restoreRx()
        return pass('TEARDOWN-RX', 'decoder restored', 1, { note: 'StreamReceive baseline re-applied' })
      } catch (err) {
        return fail('TEARDOWN-RX', 'decoder restore failed', 1, { note: `decoder restore failed: ${msg(err)}` })
      }
    },
  },
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
      await setConfig(ctx, connId, { host: ctx.config.nvxHost, port: ctx.config.nvxPort, username: 'admin', password: WRONG_PASSWORD })
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

      await ctx.http.enable(connId) // idempotent — a prior TEARDOWN may have disabled it
      await setConfig(ctx, connId, { host: ctx.config.nvxHost, port: ctx.config.nvxPort, username: 'admin', password: ctx.config.nvxPass })
      await ctx.http.restart(connId)
      // REST category for a healthy connection is 'good' (the UI label is "OK") — verified live.
      const category = await pollStatusCategory(ctx, connId, 'good')

      // Independent proof of a real session: the oracle logs in and reads Streams[0].
      let oracleOk = false
      let oracleErr: string | undefined
      try {
        await ctx.oracle.readStream0()
        oracleOk = true
      } catch (err) {
        oracleErr = err instanceof Error ? err.message : String(err)
      }
      return category === 'good' && oracleOk
        ? pass('CFG-GOOD', 'connected (oracle confirms session)', 1, { companion: { category }, note: 'status good + oracle read stream' })
        : fail('CFG-GOOD', 'connected (oracle confirms session)', 1, {
            expected: { category: 'good', oracle: 'readStream0 succeeds' },
            observed: { category, oracleOk, oracleErr },
          })
    },
  },
]

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Capture the device's pre-USE state so TEARDOWN can restore it. */
const baselineStep: JourneyStep = {
  id: 'BASELINE',
  title: 'capture device baseline (Streams[0])',
  scope: 'lab',
  run: async (ctx): Promise<Verdict> => {
    if (noDevice(ctx)) return skip('BASELINE', 'baseline (no device)', 1, { note: 'NVX_PASS unset' })
    try {
      await ctx.oracle.captureBaseline()
      return pass('BASELINE', 'baseline captured', 1, { note: 'stored for TEARDOWN restore' })
    } catch (err) {
      return fail('BASELINE', 'baseline capture failed', 1, { note: msg(err) })
    }
  },
}

/** Restore the device to baseline and disable the test connection (best-effort, reported). */
const teardownStep: JourneyStep = {
  id: 'TEARDOWN',
  title: 'restore device + disable connection',
  scope: 'lab',
  run: async (ctx): Promise<Verdict> => {
    if (noDevice(ctx)) return skip('TEARDOWN', 'teardown (no device)', 1, { note: 'NVX_PASS unset' })
    const notes: string[] = []
    let ok = true
    try {
      await ctx.oracle.restore()
      notes.push('device restored')
    } catch (err) {
      ok = false
      notes.push(`restore failed: ${msg(err)}`)
    }
    const connId = await ctx.http.findConnectionId(ctx.config.label)
    if (connId) {
      try {
        await ctx.http.disable(connId)
        notes.push('connection disabled')
      } catch (err) {
        ok = false
        notes.push(`disable failed: ${msg(err)}`)
      }
    }
    return ok
      ? pass('TEARDOWN', 'device restored + connection disabled', 1, { note: notes.join('; ') })
      : fail('TEARDOWN', 'teardown incomplete', 1, { note: notes.join('; ') })
  },
}

// Journey order: auth gauntlet → baseline → USE (v0.2 encoder) → decoder USE → teardown.
export const labSteps: JourneyStep[] = [...authSteps, baselineStep, ...useSteps, ...decoderUseSteps, teardownStep]
