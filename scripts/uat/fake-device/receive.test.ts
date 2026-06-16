/**
 * COUTURE TESTABLE IMPOSÉE AU CODER :
 *
 * Ajouter un 3e paramètre optionnel à applyReceiveSetPartial :
 *
 *   export function applyReceiveSetPartial(
 *     body: Json,
 *     target: Json,
 *     scenario = 'decoding',   // scénario RX courant ; défaut = comportement actuel
 *   ): void
 *
 * Le handler HTTP passe le scénario courant stocké en module-level :
 *
 *   let currentRxScenario = 'decoding'
 *   // POST /_control/scenario → currentRxScenario = body.scenario
 *   applyReceiveSetPartial(parsed, t, currentRxScenario)
 *
 * Avantages : fonction pure testable sans état partagé, non-régression garantie
 * (appel sans 3e arg → défaut 'decoding' = comportement actuel inchangé).
 */

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

// ---------------------------------------------------------------------------
// Tests de câblage scénario (Vague 2)
// Ces tests imposent le 3e paramètre optionnel `scenario` sur applyReceiveSetPartial.
// Tant qu'il n'est pas implémenté, la fonction ignore le scénario et pose
// CodecReady:true en dur → les assertions sur negotiating/idle cassent.
// ---------------------------------------------------------------------------

test("applyReceiveSetPartial + scénario 'negotiating' : Start → CodecReady false, 4K, 0 paquet", () => {
  const s = stream0()
  applyReceiveSetPartial({ Device: { StreamReceive: { Streams: [{ Start: true }] } } }, s, 'negotiating')
  assert.equal(s.Status,               'Stream started')
  assert.equal(s.CodecReady,           false,  'negotiating: CodecReady must be false')
  assert.equal(s.HorizontalResolution, 3840)
  assert.equal(s.VerticalResolution,   2160)
  assert.equal(s.FramesPerSecond,      30)
  assert.equal(Number(s.NumVideoPacketsRcvd), 0, 'negotiating: NumVideoPacketsRcvd must be 0')
})

test("applyReceiveSetPartial + scénario 'idle' : Start → reste Stopped, CodecReady false, résolution 0", () => {
  // scénario idle : la source ne délivre rien — Start ne change pas l'état visible
  const s = stream0()
  applyReceiveSetPartial({ Device: { StreamReceive: { Streams: [{ Start: true }] } } }, s, 'idle')
  assert.equal(s.Status,               'Stream Stopped')
  assert.equal(s.CodecReady,           false)
  assert.equal(s.HorizontalResolution, 0)
  assert.equal(s.VerticalResolution,   0)
  assert.equal(s.FramesPerSecond,      0)
  assert.equal(Number(s.NumVideoPacketsRcvd), 0)
})

test("applyReceiveSetPartial : Stop reset idle quel que soit le scénario", () => {
  // Après un Start en mode decoding, Stop doit toujours remettre à l'état repos.
  for (const scenario of ['decoding', 'negotiating', 'idle']) {
    const s = stream0()
    applyReceiveSetPartial({ Device: { StreamReceive: { Streams: [{ Start: true }] } } }, s, scenario)
    applyReceiveSetPartial({ Device: { StreamReceive: { Streams: [{ Stop: true }] } } }, s, scenario)
    assert.equal(s.Status,    'Stream Stopped', `Stop must reset to Stopped for scenario '${scenario}'`)
    assert.equal(s.CodecReady, false,            `Stop must reset CodecReady to false for scenario '${scenario}'`)
    assert.equal(Number(s.NumVideoPacketsRcvd), 0, `Stop must reset NumVideoPacketsRcvd to 0 for scenario '${scenario}'`)
  }
})
