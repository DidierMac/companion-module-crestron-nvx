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
