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
  assert.equal(v.stream_processing, false) // Processing===false at rest (verified in fixture .10)
})

test('encoder.readVariables on an idle stream (.9, Stream Stopped)', () => {
  const v = encoderPanel.readVariables(load('192.168.2.9'))
  assert.equal(v.stream_enabled, false)
  assert.equal(v.multicast_address, '')
  assert.equal(v.stream_processing, false) // Processing===false at rest (verified in fixture .9)
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

const fakeHelpers = (processing: boolean) => ({
  state: () => ({ stream_processing: processing }),
  aux: () => ({}),
})

test('set_stream_name action POSTs RtspSessionName on Streams[0]', async () => {
  const { calls, api } = fakeApi()
  const actions = encoderPanel.buildActions(api, fakeHelpers(false))
  await def(actions.set_stream_name).callback(
    { actionId: 'set_stream_name', options: { name: 'STUDIO-A' }, controlId: 'c', surfaceId: undefined, id: 'i' } as never,
    {} as never,
  )
  assert.deepEqual(calls[0], { Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'STUDIO-A' }] } } })
})

test('enable_stream POSTs Start:true, disable_stream POSTs Stop:true', async () => {
  const { calls, api } = fakeApi()
  const actions = encoderPanel.buildActions(api, fakeHelpers(false))
  await def(actions.enable_stream).callback({ actionId: 'enable_stream', options: {}, controlId: 'c', surfaceId: undefined, id: 'i' } as never, {} as never)
  await def(actions.disable_stream).callback({ actionId: 'disable_stream', options: {}, controlId: 'c', surfaceId: undefined, id: 'i' } as never, {} as never)
  assert.deepEqual(calls[0], { Device: { StreamTransmit: { Streams: [{ Start: true }] } } })
  assert.deepEqual(calls[1], { Device: { StreamTransmit: { Streams: [{ Stop: true }] } } })
})

test('set_stream_name drops POST when Processing===true (device in transition)', async () => {
  const { calls, api } = fakeApi()
  const actions = encoderPanel.buildActions(api, fakeHelpers(true))
  await def(actions.set_stream_name).callback(
    { actionId: 'set_stream_name', options: { name: 'STUDIO-A' }, controlId: 'c', surfaceId: undefined, id: 'i' } as never,
    {} as never,
  )
  assert.equal(calls.length, 0)
})

test('enable_stream drops POST when Processing===true (device in transition)', async () => {
  const { calls, api } = fakeApi()
  const actions = encoderPanel.buildActions(api, fakeHelpers(true))
  await def(actions.enable_stream).callback(
    { actionId: 'enable_stream', options: {}, controlId: 'c', surfaceId: undefined, id: 'i' } as never,
    {} as never,
  )
  assert.equal(calls.length, 0)
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
  const actions = encoderPanel.buildActions(api, fakeHelpers(false))
  await def(actions.set_multicast_address).callback(
    { actionId: 'set_multicast_address', options: { address: '239.1.1.9' }, controlId: 'c', surfaceId: undefined, id: 'i' } as never,
    {} as never,
  )
  assert.deepEqual(calls[0], { Device: { StreamTransmit: { Streams: [{ MulticastAddress: '239.1.1.9' }] } } })
})

test('stream_processing feedback is active when stream_processing===true', () => {
  const fbOn = encoderPanel.buildFeedbacks(() => ({ stream_processing: true }))
  const on = def(fbOn.stream_processing).callback(
    { feedbackId: 'stream_processing', options: {}, controlId: 'c', id: 'i', type: 'boolean' } as never,
    {} as never,
  )
  assert.equal(on, true)
})

test('stream_processing feedback is inactive when stream_processing===false', () => {
  const fbOff = encoderPanel.buildFeedbacks(() => ({ stream_processing: false }))
  const off = def(fbOff.stream_processing).callback(
    { feedbackId: 'stream_processing', options: {}, controlId: 'c', id: 'i', type: 'boolean' } as never,
    {} as never,
  )
  assert.equal(off, false)
})

test('encoder presets reference only real action ids and live under the Encoder section', () => {
  const { section, presets } = encoderPanel.buildPresets!()
  const actionIds = new Set(Object.keys(encoderPanel.buildActions({} as never)))
  assert.equal(section.name, 'Encoder')
  const ids = Object.keys(presets)
  assert.deepEqual(ids.sort(), ['enc_set_multicast', 'enc_set_stream_name', 'enc_start_stream', 'enc_stop_stream'])
  // the section lists exactly the shipped presets
  assert.deepEqual([...section.definitions].map(String).sort(), [...ids].sort())
  for (const p of Object.values(presets)) {
    if (!p || p.type !== 'simple') continue
    for (const step of p.steps) {
      for (const a of step.down) assert.ok(actionIds.has(String(a.actionId)), `unknown actionId ${String(a.actionId)}`)
    }
  }
})

test('encoder start preset carries the stream_enabled feedback', () => {
  const { presets } = encoderPanel.buildPresets!()
  const start = presets.enc_start_stream
  assert.ok(start && start.type === 'simple')
  if (start && start.type === 'simple') {
    assert.ok(start.feedbacks.some((f) => f.feedbackId === 'stream_enabled'))
  }
})
