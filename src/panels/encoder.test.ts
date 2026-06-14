import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { encoderPanel, streamTransmitBody } from './encoder.js'
import type { PanelContext } from './types.js'

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
