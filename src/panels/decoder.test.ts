import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decoderPanel, streamReceiveBody } from './decoder.js'
import type { PanelContext } from './types.js'
import type { NvxApiClient } from '../api.js'
import type { PanelActionHelpers } from './types.js'
import type { CompanionVariableValues } from '@companion-module/base'

function def<T>(d: T | false | undefined): T {
  if (!d) throw new Error('definition missing/disabled')
  return d
}

function fakeApi(): { calls: unknown[]; api: NvxApiClient } {
  const calls: unknown[] = []
  const api = { postSetPartial: async (body: unknown) => { calls.push(body); return 0 } } as unknown as NvxApiClient
  return { calls, api }
}

const ctxVars = { parseVariablesInString: async (s: string) => s } as never
const helpers = (state: CompanionVariableValues, disc: unknown): PanelActionHelpers => ({
  state: () => state,
  aux: () => ({ '/Device/DiscoveredStreams': disc }),
})

const ev = (id: string, options: Record<string, unknown>) =>
  ({ actionId: id, options, controlId: 'c', surfaceId: undefined, id: 'i' }) as never

const loadRx = (host: string): unknown =>
  JSON.parse(readFileSync(`docs/hardware-validation/raw/${host}/Device_StreamReceive.json`, 'utf8'))
const loadDisc = (host: string): unknown =>
  JSON.parse(readFileSync(`docs/hardware-validation/raw/${host}/Device_DiscoveredStreams.json`, 'utf8'))
const aux = (host: string): Record<string, unknown> => ({ '/Device/DiscoveredStreams': loadDisc(host) })

const ctx = (role: 'Transmitter' | 'Receiver' | null): PanelContext => ({
  caps: { canEncode: true, canDecode: true, canSwitchMode: true },
  role,
})

test('decoder declares StreamReceive primary + DiscoveredStreams aux', () => {
  assert.equal(decoderPanel.endpoint, '/Device/StreamReceive')
  assert.deepEqual(decoderPanel.auxEndpoints, ['/Device/DiscoveredStreams'])
})

test('decoder gate: active only in Receiver mode', () => {
  assert.equal(decoderPanel.gate(ctx('Receiver')), true)
  assert.equal(decoderPanel.gate(ctx('Transmitter')), false)
  assert.equal(decoderPanel.gate(ctx(null)), false)
})

test('decoder.readVariables on idle receiver (.9, Stream Stopped, empty source)', () => {
  const v = decoderPanel.readVariables(loadRx('192.168.2.9'), aux('192.168.2.9'))
  assert.equal(v.rx_source_url, '')
  assert.equal(v.rx_multicast_address, '')
  assert.equal(v.rx_session_initiation, 'Multicast via RTSP')
  assert.equal(v.rx_status, 'Stream Stopped')
  assert.equal(v.rx_resolution, '0x0')
  assert.equal(v.rx_processing, false)
  assert.equal(v.rx_discovered_count, 2)
  assert.equal(v.rx_stream_name, '')
})

test('decoder.readVariables reverse-looks-up the stream name from discovery', () => {
  const primary = { Device: { StreamReceive: { Streams: [{ MulticastAddress: '239.1.1.4', Status: 'Stream Stopped', HorizontalResolution: 1920, VerticalResolution: 1080, SessionInitiation: 'Multicast via RTSP', Processing: false, StreamLocation: '' }] } } }
  const v = decoderPanel.readVariables(primary, aux('192.168.2.9'))
  assert.equal(v.rx_stream_name, 'DM-NVX-360-C442684E534B')
  assert.equal(v.rx_resolution, '1920x1080')
})

test('decoder.readVariables is sentinel-safe (E30 .11 StreamReceive = string sentinel)', () => {
  const v = decoderPanel.readVariables(loadRx('192.168.2.11'), {})
  assert.equal(v.rx_status, '')
  assert.equal(v.rx_discovered_count, 0)
})

test('streamReceiveBody addresses Streams[0] by position', () => {
  assert.deepEqual(streamReceiveBody(0, { Start: true }), {
    Device: { StreamReceive: { Streams: [{ Start: true }] } },
  })
})

test('set_source_url POSTs ByReceiver + StreamLocation (variable-resolved)', async () => {
  const { calls, api } = fakeApi()
  const actions = decoderPanel.buildActions(api, helpers({ rx_processing: false }, undefined))
  await def(actions.set_source_url).callback(ev('set_source_url', { url: 'rtsp://10.0.0.5:554/live.sdp' }), ctxVars)
  assert.deepEqual(calls[0], {
    Device: { StreamReceive: { Streams: [{ SessionInitiation: 'ByReceiver', StreamLocation: 'rtsp://10.0.0.5:554/live.sdp' }] } },
  })
})

test('set_source_multicast POSTs Multicast via RTSP + MulticastAddress', async () => {
  const { calls, api } = fakeApi()
  const actions = decoderPanel.buildActions(api, helpers({ rx_processing: false }, undefined))
  await def(actions.set_source_multicast).callback(ev('set_source_multicast', { address: '239.5.5.5' }), ctxVars)
  assert.deepEqual(calls[0], {
    Device: { StreamReceive: { Streams: [{ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.5.5.5' }] } },
  })
})

test('enable_stream POSTs Start:true, disable_stream POSTs Stop:true', async () => {
  const { calls, api } = fakeApi()
  const actions = decoderPanel.buildActions(api, helpers({ rx_processing: false }, undefined))
  await def(actions.enable_stream).callback(ev('enable_stream', {}), ctxVars)
  await def(actions.disable_stream).callback(ev('disable_stream', {}), ctxVars)
  assert.deepEqual(calls[0], { Device: { StreamReceive: { Streams: [{ Start: true }] } } })
  assert.deepEqual(calls[1], { Device: { StreamReceive: { Streams: [{ Stop: true }] } } })
})

test('Processing guard: no POST is sent while rx_processing is true', async () => {
  const { calls, api } = fakeApi()
  const actions = decoderPanel.buildActions(api, helpers({ rx_processing: true }, undefined))
  await def(actions.enable_stream).callback(ev('enable_stream', {}), ctxVars)
  assert.equal(calls.length, 0)
})

test('connect_to_stream (dropdown id) resolves to multicast and POSTs', async () => {
  const disc = JSON.parse(readFileSync('docs/hardware-validation/raw/192.168.2.9/Device_DiscoveredStreams.json', 'utf8'))
  const { calls, api } = fakeApi()
  const actions = decoderPanel.buildActions(api, helpers({ rx_processing: false }, disc))
  await def(actions.connect_to_stream).callback(
    ev('connect_to_stream', { stream: '00000000-0000-4002-0059-e40020340313', custom: '' }),
    ctxVars,
  )
  assert.deepEqual(calls[0], {
    Device: { StreamReceive: { Streams: [{ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4' }] } },
  })
})

test('connect_to_stream (custom free-text, variable-resolved) routes by URL', async () => {
  const { calls, api } = fakeApi()
  const actions = decoderPanel.buildActions(api, helpers({ rx_processing: false }, undefined))
  await def(actions.connect_to_stream).callback(
    ev('connect_to_stream', { stream: 'custom', custom: 'rtsp://10.1.2.3:554/live.sdp' }),
    ctxVars,
  )
  assert.deepEqual(calls[0], {
    Device: { StreamReceive: { Streams: [{ SessionInitiation: 'ByReceiver', StreamLocation: 'rtsp://10.1.2.3:554/live.sdp' }] } },
  })
})

const fbEv = (id: string, options: Record<string, unknown>) =>
  ({ feedbackId: id, options, controlId: 'c', id: 'i', type: 'boolean' }) as never

test('rx_receiving: true when status is not Stopped and not processing', () => {
  const on = decoderPanel.buildFeedbacks(() => ({ rx_status: 'Stream started', rx_processing: false }))
  const off = decoderPanel.buildFeedbacks(() => ({ rx_status: 'Stream Stopped', rx_processing: false }))
  const proc = decoderPanel.buildFeedbacks(() => ({ rx_status: 'Stream started', rx_processing: true }))
  assert.equal(def(on.rx_receiving).callback(fbEv('rx_receiving', {}), {} as never), true)
  assert.equal(def(off.rx_receiving).callback(fbEv('rx_receiving', {}), {} as never), false)
  assert.equal(def(proc.rx_receiving).callback(fbEv('rx_receiving', {}), {} as never), false)
})

test('rx_source_matches compares by url, multicast or name', () => {
  const fb = decoderPanel.buildFeedbacks(() => ({
    rx_source_url: 'rtsp://10.0.0.5:554/live.sdp',
    rx_multicast_address: '239.5.5.5',
    rx_stream_name: 'STUDIO',
  }))
  const m = (value: string, by: string) =>
    def(fb.rx_source_matches).callback(fbEv('rx_source_matches', { value, by }), {} as never)
  assert.equal(m('rtsp://10.0.0.5:554/live.sdp', 'url'), true)
  assert.equal(m('239.5.5.5', 'multicast'), true)
  assert.equal(m('STUDIO', 'name'), true)
  assert.equal(m('OTHER', 'name'), false)
})

test('rx_processing feedback reflects the polled flag', () => {
  const fb = decoderPanel.buildFeedbacks(() => ({ rx_processing: true }))
  assert.equal(def(fb.rx_processing).callback(fbEv('rx_processing', {}), {} as never), true)
})

test('decoder presets reference only real action ids, under the Decoder section', () => {
  const { section, presets } = decoderPanel.buildPresets!()
  const actionIds = new Set(Object.keys(decoderPanel.buildActions({} as never)))
  assert.equal(section.name, 'Decoder')
  const ids = Object.keys(presets).sort()
  assert.deepEqual(ids, ['dec_connect_stream', 'dec_set_source_multicast', 'dec_set_source_url', 'dec_start_rx', 'dec_stop_rx'])
  assert.deepEqual([...section.definitions].map(String).sort(), ids)
  for (const p of Object.values(presets)) {
    if (!p || p.type !== 'simple') continue
    for (const step of p.steps) for (const a of step.down) assert.ok(actionIds.has(String(a.actionId)), `unknown actionId ${String(a.actionId)}`)
  }
})

test('decoder start preset carries the rx_receiving feedback', () => {
  const { presets } = decoderPanel.buildPresets!()
  const start = presets.dec_start_rx
  assert.ok(start && start.type === 'simple')
  if (start && start.type === 'simple') assert.ok(start.feedbacks.some((f) => f.feedbackId === 'rx_receiving'))
})
