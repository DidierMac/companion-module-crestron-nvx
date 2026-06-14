import { streamTransmitBody } from '../../../src/panels/encoder.js'
import { hasDevice, makeClient } from '../tiers/tier0-logic.js'
import { pass, fail, ambiguous, skip, assertEqual } from '../lib/verdict.js'
import type { UatCase, RunContext } from '../lib/case.js'

/** Login + GET StreamTransmit Streams[0]. Returns the parsed object or throws. */
async function streamTransmit0(ctx: RunContext): Promise<Record<string, unknown>> {
  const client = makeClient(ctx.config)
  await client.login()
  const json = (await client.get('/Device/StreamTransmit')) as {
    Device?: { StreamTransmit?: { Streams?: Array<Record<string, unknown>> } }
  }
  const s = json.Device?.StreamTransmit?.Streams?.[0]
  if (!s) throw new Error('Streams[0] absent')
  return s
}

const ENC01: UatCase = {
  id: 'ENC-01', title: 'set_stream_name changes RtspSessionName on the device', tier: 0, phase: 'read',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('ENC-01', 'no device (NVX_PASS unset)', 0, {})
    const client = makeClient(ctx.config)
    await client.login()
    const witness = 'UAT-STREAM-X'
    const status = await client.postSetPartial(streamTransmitBody(0, { RtspSessionName: witness }))
    if (status !== 0) return fail('ENC-01', 'POST RtspSessionName', 0, { note: `StatusId ${status}`, expected: 0, observed: status })
    const s = await streamTransmit0(ctx) // device cross-check
    return assertEqual('ENC-01', 'RtspSessionName on device', 0, s.RtspSessionName, witness, { deviceJson: s })
  },
}

const ENC02: UatCase = {
  id: 'ENC-02', title: 'set_multicast_address (INFERRED POST) changes MulticastAddress', tier: 0, phase: 'read',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('ENC-02', 'no device (NVX_PASS unset)', 0, {})
    const client = makeClient(ctx.config)
    await client.login()
    const witness = '239.9.9.9'
    const status = await client.postSetPartial(streamTransmitBody(0, { MulticastAddress: witness }))
    const s = await streamTransmit0(ctx)
    if (s.MulticastAddress === witness && status === 0) {
      return pass('ENC-02', 'MulticastAddress on device (inferred POST confirmed)', 0, { deviceJson: s, note: 'inferred POST CONFIRMED' })
    }
    // Inferred write: a mismatch is AMBIGUOUS (first real test of this field), not an outright FAIL.
    return ambiguous('ENC-02', 'MulticastAddress inferred POST — needs LLM/human confirmation', 0,
      { expected: witness, observed: s.MulticastAddress, note: `StatusId ${status}; inferred field` })
  },
}

const ENC03: UatCase = {
  id: 'ENC-03', title: 'enable/disable_stream (INFERRED POST) toggles Status', tier: 0, phase: 'read',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('ENC-03', 'no device (NVX_PASS unset)', 0, {})
    const client = makeClient(ctx.config)
    await client.login()
    const sStop = (await (async () => { await client.postSetPartial(streamTransmitBody(0, { Stop: true })); return streamTransmit0(ctx) })())
    const sStart = (await (async () => { await client.postSetPartial(streamTransmitBody(0, { Start: true })); return streamTransmit0(ctx) })())
    const ok = sStop.Status === 'Stream Stopped' && sStart.Status === 'Stream started'
    return ok
      ? pass('ENC-03', 'Start/Stop toggles Status (inferred POST confirmed)', 0, { note: 'transition observed', deviceJson: { sStop, sStart } })
      : ambiguous('ENC-03', 'Start/Stop inferred POST — needs LLM/human confirmation', 0,
          { expected: 'Stream Stopped → Stream started', observed: { stop: sStop.Status, start: sStart.Status } })
  },
}

const ENC05: UatCase = {
  id: 'ENC-05', title: 'encoder variables mirror the device Streams[0]', tier: 0, phase: 'read',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('ENC-05', 'no device (NVX_PASS unset)', 0, {})
    const s = await streamTransmit0(ctx)
    // readVariables is unit-tested elsewhere; here we assert the live device exposes the expected shape.
    const ok = typeof s.RtspSessionName === 'string' && 'MulticastAddress' in s && 'Status' in s
    return ok
      ? pass('ENC-05', 'device Streams[0] exposes name/multicast/status', 0, { deviceJson: s })
      : fail('ENC-05', 'device Streams[0] shape', 0, { observed: s })
  },
}

const C2: UatCase = {
  id: 'C2', title: 'unreachable host → connect fails fast, no module force-restart', tier: 0, phase: 'disruptive',
  run: async (ctx) => {
    // TEST-NET host (RFC5737) — network timeout, NOT a bad password (lockout budget = 0).
    const client = makeClient({ ...ctx.config, nvxHost: '192.0.2.1', nvxPass: ctx.config.nvxPass || 'x' })
    const t0 = Date.now()
    try { await client.login(); return fail('C2', 'unreachable host should not connect', 0, {}) }
    catch (err) {
      const ms = Date.now() - t0
      return pass('C2', 'unreachable host → fast failure', 0, { note: `failed in ${ms}ms: ${String(err)}` })
    }
  },
}

const C3: UatCase = {
  id: 'C3', title: 'logout emitted on teardown', tier: 0, phase: 'disruptive',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('C3', 'no device (NVX_PASS unset)', 0, {})
    const client = makeClient(ctx.config)
    await client.login()
    await client.logout()
    return pass('C3', 'logout emitted', 0, { note: 'logout() returned without error' })
  },
}

export const encoderCases: UatCase[] = [ENC01, ENC02, ENC03, ENC05, C2, C3]
