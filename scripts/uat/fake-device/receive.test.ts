import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyReceiveSetPartial } from './server.js'

function stream0() {
  return { Status: 'Stream Stopped', StreamLocation: '', MulticastAddress: '', SessionInitiation: 'Multicast via RTSP', Start: false, Stop: false, Processing: false } as Record<string, unknown>
}

test('applyReceiveSetPartial sets the source coordinates on Streams[0]', () => {
  const s = stream0()
  applyReceiveSetPartial({ Device: { StreamReceive: { Streams: [{ SessionInitiation: 'ByReceiver', StreamLocation: 'rtsp://x' }] } } }, s)
  assert.equal(s.SessionInitiation, 'ByReceiver')
  assert.equal(s.StreamLocation, 'rtsp://x')
})

test('applyReceiveSetPartial maps Start:true → full receiving state, Stop:true → stopped state', () => {
  const s = stream0()
  // Start: le fake simule une réception 4K avec codec prêt et paquets vidéo
  applyReceiveSetPartial({ Device: { StreamReceive: { Streams: [{ Start: true }] } } }, s)
  assert.equal(s.Status, 'Stream started')
  assert.equal(s.CodecReady, true)
  assert.equal(s.HorizontalResolution, 3840)
  assert.equal(s.VerticalResolution, 2160)
  assert.equal(s.FramesPerSecond, 30)
  assert.ok(Number(s.NumVideoPacketsRcvd) > 0, 'NumVideoPacketsRcvd must be > 0 after Start')
  // Stop: le fake remet le flux à zéro
  applyReceiveSetPartial({ Device: { StreamReceive: { Streams: [{ Stop: true }] } } }, s)
  assert.equal(s.Status, 'Stream Stopped')
  assert.equal(s.CodecReady, false)
  assert.equal(Number(s.NumVideoPacketsRcvd), 0)
})

test('applyReceiveSetPartial ignores empty position objects and non-StreamReceive bodies', () => {
  const s = stream0()
  applyReceiveSetPartial({ Device: { StreamReceive: { Streams: [{}] } } }, s)
  applyReceiveSetPartial({ Device: { StreamTransmit: { Streams: [{ Start: true }] } } }, s)
  assert.equal(s.Status, 'Stream Stopped')
})
