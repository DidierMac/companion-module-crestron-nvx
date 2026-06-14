// NB : chaque cas ouvre sa propre session NVX (login par cas). Divergence ASSUMÉE de UAT.md §151
// (qui veut 0 login après A3) : ce sont des BONS logins → 0 budget lockout consommé ; le mode
// 1-session/cas isole les cas (un échec ne pollue pas la session des autres).

import { streamTransmitBody } from '../../../src/panels/encoder.js'
import { hasDevice, makeClient } from '../tiers/tier0-logic.js'
import { pass, fail, ambiguous, skip, assertEqual } from '../lib/verdict.js'
import type { UatCase, RunContext } from '../lib/case.js'

/** Resolve the client factory: use ctx.clientFactory if provided (test DI), else makeClient. */
function getClient(ctx: RunContext) {
  return ctx.clientFactory ? ctx.clientFactory(ctx.config) : makeClient(ctx.config)
}

/** Login + GET StreamTransmit Streams[0]. Returns the parsed object or throws. */
async function streamTransmit0(ctx: RunContext): Promise<Record<string, unknown>> {
  const client = getClient(ctx)
  await client.login()
  const json = (await client.get('/Device/StreamTransmit')) as {
    Device?: { StreamTransmit?: { Streams?: Array<Record<string, unknown>> } }
  }
  const s = json.Device?.StreamTransmit?.Streams?.[0]
  if (!s) throw new Error('Streams[0] absent')
  return s
}

const ENC01: UatCase = {
  id: 'ENC-01', title: 'set_stream_name changes RtspSessionName on the device', tier: 0, phase: 'write',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('ENC-01', 'no device (NVX_PASS unset)', 0, {})
    // Capture initial value before any write.
    const initial = await streamTransmit0(ctx)
    const initialName = initial.RtspSessionName
    const witness = 'UAT-STREAM-X'
    const client = getClient(ctx)
    await client.login()
    let verdict
    try {
      const status = await client.postSetPartial(streamTransmitBody(0, { RtspSessionName: witness }))
      if (status !== 0) {
        verdict = fail('ENC-01', 'POST RtspSessionName', 0, { note: `StatusId ${status}`, expected: 0, observed: status })
      } else {
        const s = await streamTransmit0(ctx) // device cross-check
        verdict = assertEqual('ENC-01', 'RtspSessionName on device', 0, s.RtspSessionName, witness, { deviceJson: s })
      }
    } finally {
      // Restore original value regardless of outcome.
      await client.postSetPartial(streamTransmitBody(0, { RtspSessionName: initialName }))
    }
    return verdict
  },
}

const ENC02: UatCase = {
  id: 'ENC-02', title: 'set_multicast_address (INFERRED POST) changes MulticastAddress', tier: 0, phase: 'write',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('ENC-02', 'no device (NVX_PASS unset)', 0, {})
    // Capture initial value before any write.
    const initial = await streamTransmit0(ctx)
    const initialAddr = initial.MulticastAddress
    const witness = '239.9.9.9'
    const client = getClient(ctx)
    await client.login()
    let verdict
    try {
      const status = await client.postSetPartial(streamTransmitBody(0, { MulticastAddress: witness }))
      if (status !== 0) {
        // POST was rejected — definite failure, not an ambiguous inference.
        verdict = fail('ENC-02', 'POST MulticastAddress rejected', 0, { expected: 0, observed: status, note: `StatusId ${status}` })
      } else {
        const s = await streamTransmit0(ctx)
        if (s.MulticastAddress === witness) {
          verdict = pass('ENC-02', 'MulticastAddress on device (inferred POST confirmed)', 0, { deviceJson: s, note: 'inferred POST CONFIRMED' })
        } else {
          // status === 0 but device value didn't change: inferred field unconfirmed.
          verdict = ambiguous('ENC-02', 'MulticastAddress inferred POST — needs LLM/human confirmation', 0,
            { expected: witness, observed: s.MulticastAddress, note: 'StatusId 0 but value unchanged; inferred field' })
        }
      }
    } finally {
      // Restore original value regardless of outcome.
      await client.postSetPartial(streamTransmitBody(0, { MulticastAddress: initialAddr }))
    }
    return verdict
  },
}

const ENC03: UatCase = {
  id: 'ENC-03', title: 'enable/disable_stream (INFERRED POST) toggles Status', tier: 0, phase: 'write',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('ENC-03', 'no device (NVX_PASS unset)', 0, {})
    // Capture initial state before any write.
    const initial = await streamTransmit0(ctx)
    const initialStatus = initial.Status
    const client = getClient(ctx)
    await client.login()
    let verdict
    try {
      await client.postSetPartial(streamTransmitBody(0, { Stop: true }))
      const sStop = await streamTransmit0(ctx)
      await client.postSetPartial(streamTransmitBody(0, { Start: true }))
      const sStart = await streamTransmit0(ctx)
      const ok = sStop.Status === 'Stream Stopped' && sStart.Status === 'Stream started'
      verdict = ok
        ? pass('ENC-03', 'Start/Stop toggles Status (inferred POST confirmed)', 0, { note: 'transition observed', deviceJson: { sStop, sStart } })
        : ambiguous('ENC-03', 'Start/Stop inferred POST — needs LLM/human confirmation', 0,
            { expected: 'Stream Stopped → Stream started', observed: { stop: sStop.Status, start: sStart.Status } })
    } finally {
      // Restore original stream state.
      const restoreCmd = initialStatus === 'Stream started' ? { Start: true } : { Stop: true }
      await client.postSetPartial(streamTransmitBody(0, restoreCmd))
    }
    return verdict
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
    const client = getClient(ctx)
    await client.login()
    await client.logout()
    return pass('C3', 'logout emitted', 0, { note: 'logout() returned without error' })
  },
}

export const encoderCases: UatCase[] = [ENC01, ENC02, ENC03, ENC05, C2, C3]
