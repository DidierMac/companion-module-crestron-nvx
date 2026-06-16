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

test('applyReceiveSetPartial maps Start:true → Status receiving, Stop:true → Stopped', () => {
  const s = stream0()
  applyReceiveSetPartial({ Device: { StreamReceive: { Streams: [{ Start: true }] } } }, s)
  assert.equal(s.Status, 'Stream started')
  applyReceiveSetPartial({ Device: { StreamReceive: { Streams: [{ Stop: true }] } } }, s)
  assert.equal(s.Status, 'Stream Stopped')
})

test('applyReceiveSetPartial ignores empty position objects and non-StreamReceive bodies', () => {
  const s = stream0()
  applyReceiveSetPartial({ Device: { StreamReceive: { Streams: [{}] } } }, s)
  applyReceiveSetPartial({ Device: { StreamTransmit: { Streams: [{ Start: true }] } } }, s)
  assert.equal(s.Status, 'Stream Stopped')
})
