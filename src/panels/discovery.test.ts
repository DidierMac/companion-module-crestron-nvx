import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { discoveredList, resolveSource, type DiscoveredStream } from './discovery.js'

const aux = (): Record<string, unknown> => ({
  '/Device/DiscoveredStreams': JSON.parse(
    readFileSync('docs/hardware-validation/raw/192.168.2.9/Device_DiscoveredStreams.json', 'utf8'),
  ),
})

test('discoveredList normalizes the UUID-keyed dict to a sorted array', () => {
  const list = discoveredList(aux()['/Device/DiscoveredStreams'])
  assert.equal(list.length, 2)
  const names = list.map((s) => s.sessionName).sort()
  assert.deepEqual(names, ['DM-NVX-360-C442684E534B', 'DM-NVX-E30-00107FEA8A32'])
  const e30 = list.find((s) => s.sessionName === 'DM-NVX-E30-00107FEA8A32') as DiscoveredStream
  assert.equal(e30.multicastAddress, '239.1.1.6')
  assert.equal(e30.rtspUri, 'rtsp://192.168.2.11:554/live.sdp')
  assert.equal(e30.uniqueId, '00000000-0000-4002-0059-e204080bff04')
})

test('discoveredList tolerates sentinel/absent discovery → empty list', () => {
  assert.deepEqual(discoveredList(undefined), [])
  assert.deepEqual(discoveredList({ Device: { DiscoveredStreams: 'UNSUPPORTED PROPERTY, CHECK REST API!!!' } }), [])
})

test('resolveSource by uniqueId prefers multicast (mode Multicast via RTSP)', () => {
  const r = resolveSource('00000000-0000-4002-0059-e204080bff04', '', discoveredList(aux()['/Device/DiscoveredStreams']))
  assert.deepEqual(r, { SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.6' })
})

test('resolveSource falls back to URL when entry has no multicast', () => {
  const list: DiscoveredStream[] = [
    { uniqueId: 'u1', sessionName: 'NoMcast', rtspUri: 'rtsp://10.0.0.1:554/live.sdp', multicastAddress: '' },
  ]
  const r = resolveSource('u1', '', list)
  assert.deepEqual(r, { SessionInitiation: 'ByReceiver', StreamLocation: 'rtsp://10.0.0.1:554/live.sdp' })
})

test('resolveSource custom: match a discovered SessionName → its coordinates', () => {
  const r = resolveSource('custom', 'DM-NVX-360-C442684E534B', discoveredList(aux()['/Device/DiscoveredStreams']))
  assert.deepEqual(r, { SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4' })
})

test('resolveSource custom: unmatched value starting with rtsp:// → URL source', () => {
  const r = resolveSource('custom', 'rtsp://10.9.9.9:554/live.sdp', [])
  assert.deepEqual(r, { SessionInitiation: 'ByReceiver', StreamLocation: 'rtsp://10.9.9.9:554/live.sdp' })
})

test('resolveSource custom: unmatched value that looks multicast → multicast source', () => {
  const r = resolveSource('custom', '239.9.9.9', [])
  assert.deepEqual(r, { SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.9.9.9' })
})

test('resolveSource returns null when nothing resolvable', () => {
  assert.equal(resolveSource('custom', '', []), null)
  assert.equal(resolveSource('unknown-id', '', []), null)
})
