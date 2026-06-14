import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { encoderPanel, streamTransmitBody } from './encoder.js'
import type { PanelContext } from './types.js'
import type { NvxApiClient } from '../api.js'

function def<T>(d: T | false | undefined): T {
  if (!d) throw new Error('definition missing/disabled')
  return d
}

const load = (host: string): unknown =>
  JSON.parse(readFileSync(`docs/hardware-validation/raw/${host}/Device_StreamTransmit.json`, 'utf8'))

const ctx = (role: 'Transmitter' | 'Receiver' | null): PanelContext => ({
  caps: { canEncode: true, canDecode: true, canSwitchMode: true },
  role,
})

test('encoder gate: active only in Transmitter mode', () => {
  assert.equal(encoderPanel.gate(ctx('Transmitter')), true)
  assert.equal(encoderPanel.gate(ctx('Receiver')), false)
  assert.equal(encoderPanel.gate(ctx(null)), false)
})

test('encoder.readVariables on an ACTIVE transmitter (.10)', () => {
  const v = encoderPanel.readVariables(load('192.168.2.10'))
  assert.equal(v.stream_name, 'DM-NVX-360-C442684E534B')
  assert.equal(v.multicast_address, '239.1.1.4')
  assert.equal(v.encoder_url, 'rtsp://192.168.2.10:554/live.sdp')
  assert.equal(v.stream_enabled, true)
})

test('encoder.readVariables on an idle stream (.9, Stream Stopped)', () => {
  const v = encoderPanel.readVariables(load('192.168.2.9'))
  assert.equal(v.stream_enabled, false)
  assert.equal(v.multicast_address, '')
})

test('streamTransmitBody addresses Streams[0] by position, leaves others empty', () => {
  assert.deepEqual(streamTransmitBody(0, { RtspSessionName: 'X' }), {
    Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'X' }] } },
  })
})

function fakeApi(): { calls: unknown[]; api: NvxApiClient } {
  const calls: unknown[] = []
  const api = { postSetPartial: async (body: unknown) => { calls.push(body); return 0 } } as unknown as NvxApiClient
  return { calls, api }
}

test('set_stream_name action POSTs RtspSessionName on Streams[0]', async () => {
  const { calls, api } = fakeApi()
  const actions = encoderPanel.buildActions(api)
  await def(actions.set_stream_name).callback(
    { actionId: 'set_stream_name', options: { name: 'STUDIO-A' }, controlId: 'c', surfaceId: undefined, id: 'i' } as never,
    {} as never,
  )
  assert.deepEqual(calls[0], { Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'STUDIO-A' }] } } })
})

test('enable_stream POSTs Start:true, disable_stream POSTs Stop:true', async () => {
  const { calls, api } = fakeApi()
  const actions = encoderPanel.buildActions(api)
  await def(actions.enable_stream).callback({ actionId: 'enable_stream', options: {}, controlId: 'c', surfaceId: undefined, id: 'i' } as never, {} as never)
  await def(actions.disable_stream).callback({ actionId: 'disable_stream', options: {}, controlId: 'c', surfaceId: undefined, id: 'i' } as never, {} as never)
  assert.deepEqual(calls[0], { Device: { StreamTransmit: { Streams: [{ Start: true }] } } })
  assert.deepEqual(calls[1], { Device: { StreamTransmit: { Streams: [{ Stop: true }] } } })
})

test('stream_enabled feedback reflects the latest polled state', () => {
  const fb = encoderPanel.buildFeedbacks(() => ({ stream_enabled: true }))
  const on = def(fb.stream_enabled).callback(
    { feedbackId: 'stream_enabled', options: {}, controlId: 'c', id: 'i', type: 'boolean' } as never,
    {} as never,
  )
  assert.equal(on, true)
})

test('stream_name_matches compares the option to the polled stream_name', () => {
  const fb = encoderPanel.buildFeedbacks(() => ({ stream_name: 'STUDIO-A' }))
  const make = (name: string) =>
    def(fb.stream_name_matches).callback(
      { feedbackId: 'stream_name_matches', options: { name }, controlId: 'c', id: 'i', type: 'boolean' } as never,
      {} as never,
    )
  assert.equal(make('STUDIO-A'), true)
  assert.equal(make('OTHER'), false)
})

test('set_multicast_address action POSTs MulticastAddress on Streams[0]', async () => {
  const { calls, api } = fakeApi()
  const actions = encoderPanel.buildActions(api)
  await def(actions.set_multicast_address).callback(
    { actionId: 'set_multicast_address', options: { address: '239.1.1.9' }, controlId: 'c', surfaceId: undefined, id: 'i' } as never,
    {} as never,
  )
  assert.deepEqual(calls[0], { Device: { StreamTransmit: { Streams: [{ MulticastAddress: '239.1.1.9' }] } } })
})
