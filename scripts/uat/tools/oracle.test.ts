import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Oracle } from './oracle.js'
import type { NvxApiClient } from '../../../src/api.js'

function fakeClient(stream0: Record<string, unknown>) {
  return {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamTransmit: { Streams: [stream0] } } }),
    postSetPartial: async () => 0,
  } as unknown as NvxApiClient
}

function fakeReceiveClient(stream0: Record<string, unknown>) {
  return {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamReceive: { Streams: [stream0] } } }),
    postSetPartial: async () => 0,
  } as unknown as NvxApiClient
}

test('readStream0 returns Streams[0]', async () => {
  const o = new Oracle(() => fakeClient({ RtspSessionName: 'X', Status: 'Stream started' }))
  const s = await o.readStream0()
  assert.equal(s.RtspSessionName, 'X')
})

test('readStream0 throws when Streams[0] is absent', async () => {
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamTransmit: { Streams: [] } } }),
    postSetPartial: async () => 0,
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  await assert.rejects(() => o.readStream0(), /Streams\[0\] absent/)
})

test('baseline then restore re-posts the captured values', async () => {
  const posted: unknown[] = []
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({
      Device: {
        StreamTransmit: {
          Streams: [{ RtspSessionName: 'ORIG', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' }],
        },
      },
    }),
    postSetPartial: async (b: unknown) => {
      posted.push(b)
      return 0
    },
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  await o.captureBaseline()
  await o.restore()
  assert.deepEqual(posted[0], { Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'ORIG' }] } } })
})

test('restore is a no-op without a baseline', async () => {
  const posted: unknown[] = []
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamTransmit: { Streams: [{}] } } }),
    postSetPartial: async (b: unknown) => {
      posted.push(b)
      return 0
    },
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  await o.restore()
  assert.equal(posted.length, 0)
})

// ── Receiver-side oracle (StreamReceive) ─────────────────────────────────────

test('readReceiveStream0 returns StreamReceive Streams[0]', async () => {
  const o = new Oracle(() => fakeReceiveClient({ SessionInitiation: 'Multicast via RTSP', Status: 'Stream Stopped' }))
  const s = await o.readReceiveStream0()
  assert.equal(s.SessionInitiation, 'Multicast via RTSP')
})

test('readReceiveStream0 throws when StreamReceive Streams[0] is absent', async () => {
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamReceive: { Streams: [] } } }),
    postSetPartial: async () => 0,
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  await assert.rejects(() => o.readReceiveStream0(), /StreamReceive Streams\[0\] absent/)
})

test('captureBaselineRx then restoreRx re-posts SessionInitiation + state', async () => {
  const posted: unknown[] = []
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({
      Device: {
        StreamReceive: {
          Streams: [{ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4', Status: 'Stream Stopped' }],
        },
      },
    }),
    postSetPartial: async (b: unknown) => {
      posted.push(b)
      return 0
    },
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  await o.captureBaselineRx()
  await o.restoreRx()
  // First post restores session initiation + multicast address
  assert.deepEqual(posted[0], { Device: { StreamReceive: { Streams: [{ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4' }] } } })
  // Second post restores stop state
  assert.deepEqual(posted[1], { Device: { StreamReceive: { Streams: [{ Stop: true }] } } })
})

test('captureBaselineRx then restoreRx ByReceiver branch re-posts URL + Start', async () => {
  const posted: unknown[] = []
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({
      Device: {
        StreamReceive: {
          Streams: [{ SessionInitiation: 'ByReceiver', StreamLocation: 'rtsp://10.0.0.9:554/live.sdp', Status: 'Stream started' }],
        },
      },
    }),
    postSetPartial: async (b: unknown) => {
      posted.push(b)
      return 0
    },
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  await o.captureBaselineRx()
  await o.restoreRx()
  // First post restores session initiation + stream URL (ByReceiver path)
  assert.deepEqual(posted[0], { Device: { StreamReceive: { Streams: [{ SessionInitiation: 'ByReceiver', StreamLocation: 'rtsp://10.0.0.9:554/live.sdp' }] } } })
  // Second post restores active state (baseline Status was 'Stream started' → Start: true)
  assert.deepEqual(posted[1], { Device: { StreamReceive: { Streams: [{ Start: true }] } } })
})

test('restoreRx is a no-op without a baselineRx', async () => {
  const posted: unknown[] = []
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamReceive: { Streams: [{}] } } }),
    postSetPartial: async (b: unknown) => {
      posted.push(b)
      return 0
    },
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  await o.restoreRx()
  assert.equal(posted.length, 0)
})

// ── Task 6: restore/restoreRx signal "no baseline" honestly ──────────────────

test('restore() returns { skipped: true } when no baseline was captured', async () => {
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamTransmit: { Streams: [{}] } } }),
    postSetPartial: async () => 0,
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  const result = await o.restore()
  assert.deepEqual(result, { skipped: true }, 'restore() must signal that no baseline was captured')
})

test('restore() returns { skipped: false } when a baseline was captured and restored', async () => {
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({
      Device: {
        StreamTransmit: {
          Streams: [{ RtspSessionName: 'X', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' }],
        },
      },
    }),
    postSetPartial: async () => 0,
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  await o.captureBaseline()
  const result = await o.restore()
  assert.deepEqual(result, { skipped: false }, 'restore() must signal that baseline was applied')
})

test('restoreRx() returns { skipped: true } when no baselineRx was captured', async () => {
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamReceive: { Streams: [{}] } } }),
    postSetPartial: async () => 0,
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  const result = await o.restoreRx()
  assert.deepEqual(result, { skipped: true }, 'restoreRx() must signal that no baselineRx was captured')
})

test('restoreRx() returns { skipped: false } when a baselineRx was captured and restored', async () => {
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({
      Device: {
        StreamReceive: {
          Streams: [{ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4', Status: 'Stream Stopped' }],
        },
      },
    }),
    postSetPartial: async () => 0,
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  await o.captureBaselineRx()
  const result = await o.restoreRx()
  assert.deepEqual(result, { skipped: false }, 'restoreRx() must signal that baselineRx was applied')
})

// ── M4 : logout() doit être appelé après chaque méthode (bracket try/finally) ──
// Tous ces tests échouent en phase RED : oracle.ts appelle login() sans jamais logout().
// Ils passent une fois le coder ayant ajouté try { … } finally { await c.logout().catch(() => {}) }.

test('readStream0() appelle logout() exactement une fois après succès', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'X' }] } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await o.readStream0()
  assert.equal(logoutCount, 1, 'readStream0() doit appeler logout() exactement une fois')
})

test('readStream0() appelle logout() même si get() rejette (finally)', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => { throw new Error('device unreachable') },
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await assert.rejects(() => o.readStream0(), /device unreachable/)
  assert.equal(logoutCount, 1, 'readStream0() doit appeler logout() même si get() rejette')
})

test('readReceiveStream0() appelle logout() exactement une fois après succès', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamReceive: { Streams: [{ SessionInitiation: 'Multicast via RTSP' }] } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await o.readReceiveStream0()
  assert.equal(logoutCount, 1, 'readReceiveStream0() doit appeler logout() exactement une fois')
})

test('readReceiveStream0() appelle logout() même si get() rejette (finally)', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => { throw new Error('device unreachable') },
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await assert.rejects(() => o.readReceiveStream0(), /device unreachable/)
  assert.equal(logoutCount, 1, 'readReceiveStream0() doit appeler logout() même si get() rejette')
})

test('restore() appelle logout() exactement une fois après succès', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'X', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' }] } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await o.captureBaseline()
  const countBefore = logoutCount
  await o.restore()
  assert.equal(logoutCount - countBefore, 1, 'restore() doit appeler logout() exactement une fois')
})

test('restore() appelle logout() même si postSetPartial() rejette (finally)', async () => {
  let logoutCount = 0
  let throwOnPost = false
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'X', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' }] } } }),
    postSetPartial: async () => { if (throwOnPost) throw new Error('device unreachable'); return 0 },
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await o.captureBaseline()
  const countBefore = logoutCount
  throwOnPost = true
  await assert.rejects(() => o.restore(), /device unreachable/)
  assert.equal(logoutCount - countBefore, 1, 'restore() doit appeler logout() même si postSetPartial() rejette')
})

test('restoreRx() appelle logout() exactement une fois après succès', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamReceive: { Streams: [{ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4', Status: 'Stream Stopped' }] } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await o.captureBaselineRx()
  const countBefore = logoutCount
  await o.restoreRx()
  assert.equal(logoutCount - countBefore, 1, 'restoreRx() doit appeler logout() exactement une fois')
})

test('restoreRx() appelle logout() même si postSetPartial() rejette (finally)', async () => {
  let logoutCount = 0
  let throwOnPost = false
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamReceive: { Streams: [{ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4', Status: 'Stream Stopped' }] } } }),
    postSetPartial: async () => { if (throwOnPost) throw new Error('device unreachable'); return 0 },
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await o.captureBaselineRx()
  const countBefore = logoutCount
  throwOnPost = true
  await assert.rejects(() => o.restoreRx(), /device unreachable/)
  assert.equal(logoutCount - countBefore, 1, 'restoreRx() doit appeler logout() même si postSetPartial() rejette')
})

test('setRxScenario() appelle logout() exactement une fois après succès', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({}),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await o.setRxScenario('rx-negotiating')
  assert.equal(logoutCount, 1, 'setRxScenario() doit appeler logout() exactement une fois')
})

test('setRxScenario() appelle logout() même si post() rejette (finally)', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({}),
    postSetPartial: async () => 0,
    post: async () => { throw new Error('scenario route absent') },
  } as unknown as NvxApiClient))
  await assert.rejects(() => o.setRxScenario('rx-negotiating'), /scenario route absent/)
  assert.equal(logoutCount, 1, 'setRxScenario() doit appeler logout() même si post() rejette')
})
