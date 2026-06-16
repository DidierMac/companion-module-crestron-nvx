import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decoderPanel, streamReceiveBody } from './decoder.js'
import type { PanelContext } from './types.js'

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
