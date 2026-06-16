/**
 * Tests unitaires pour scenarios.ts — cœur pur de l'API de contrôle du fake.
 * Chaque scénario nommé → état device attendu (champs exacts de StreamReceive/StreamTransmit).
 *
 * SIGNATURES QUE LE CODER DOIT RESPECTER (voir aussi le stub scenarios.ts) :
 *
 *   scenarioToReceiveState(name: string): {
 *     Status: string
 *     CodecReady: boolean
 *     HorizontalResolution: number
 *     VerticalResolution: number
 *     FramesPerSecond: number
 *     NumVideoPacketsRcvd: number
 *   }
 *
 *   scenarioToTransmitState(name: string): {
 *     Status: string
 *   }
 *
 * Noms de champs alignés sur applyReceiveSetPartial / applySetPartial (server.ts).
 * Défaut RX = 'decoding' (zéro régression des journeys existants sans appel de contrôle).
 * Scénario inconnu → throw (fail-fast, pas de défaut silencieux).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scenarioToReceiveState, scenarioToTransmitState } from './scenarios.js'

// ---------------------------------------------------------------------------
// RX scenarios
// ---------------------------------------------------------------------------

test("scenarioToReceiveState('idle') → Stream Stopped, CodecReady false, résolution 0, 0 paquet", () => {
  const s = scenarioToReceiveState('idle')
  assert.equal(s.Status,                 'Stream Stopped')
  assert.equal(s.CodecReady,             false)
  assert.equal(s.HorizontalResolution,   0)
  assert.equal(s.VerticalResolution,     0)
  assert.equal(s.FramesPerSecond,        0)
  assert.equal(s.NumVideoPacketsRcvd,    0)
})

test("scenarioToReceiveState('negotiating') → Stream started, CodecReady false, 4K@30, 0 paquet", () => {
  // Simule un chiffrement ou négociation RTSP sans décodage :
  // résolution peuplée (rx_armed=true) mais CodecReady=false → feedback rx_negotiating (ambre).
  const s = scenarioToReceiveState('negotiating')
  assert.equal(s.Status,                 'Stream started')
  assert.equal(s.CodecReady,             false)
  assert.equal(s.HorizontalResolution,   3840)
  assert.equal(s.VerticalResolution,     2160)
  assert.equal(s.FramesPerSecond,        30)
  assert.equal(s.NumVideoPacketsRcvd,    0)
})

test("scenarioToReceiveState('decoding') → Stream started, CodecReady true, 4K@30, paquets > 0", () => {
  // Décodage effectif → feedback rx_receiving (vert).
  const s = scenarioToReceiveState('decoding')
  assert.equal(s.Status,                 'Stream started')
  assert.equal(s.CodecReady,             true)
  assert.equal(s.HorizontalResolution,   3840)
  assert.equal(s.VerticalResolution,     2160)
  assert.equal(s.FramesPerSecond,        30)
  assert.ok(Number(s.NumVideoPacketsRcvd) > 0,
    `NumVideoPacketsRcvd must be > 0 for decoding scenario, got ${String(s.NumVideoPacketsRcvd)}`)
})

test("scenarioToReceiveState: défaut = 'decoding' (non-régression journeys existants)", () => {
  // Sans appel de contrôle, le scénario courant doit être 'decoding' —
  // c'est le comportement figé actuel du fake (Start → CodecReady:true).
  // Ce test vérifie que 'decoding' produit le même état que le bloc figé
  // qu'il remplace (CodecReady:true, résolution 4K, paquets > 0).
  const s = scenarioToReceiveState('decoding')
  assert.equal(s.CodecReady, true,
    "default scenario 'decoding' must keep CodecReady:true (non-regression)")
  assert.ok(Number(s.NumVideoPacketsRcvd) > 0,
    "default scenario 'decoding' must keep NumVideoPacketsRcvd > 0 (non-regression)")
})

test("scenarioToReceiveState: scénario inconnu → throw avec message clair", () => {
  // Fail-fast : un scénario non connu doit lever une erreur explicite,
  // pas retourner un défaut silencieux.
  assert.throws(
    () => scenarioToReceiveState('unknown-rx'),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.ok(
        err.message.includes("scenarioToReceiveState") && err.message.includes("unknown-rx"),
        `error message must name the function and the scenario, got: ${(err as Error).message}`,
      )
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// TX scenarios
// ---------------------------------------------------------------------------

test("scenarioToTransmitState('stopped') → Status 'Stream Stopped'", () => {
  const s = scenarioToTransmitState('stopped')
  assert.equal(s.Status, 'Stream Stopped')
})

test("scenarioToTransmitState('streaming') → Status 'Stream started'", () => {
  const s = scenarioToTransmitState('streaming')
  assert.equal(s.Status, 'Stream started')
})

test("scenarioToTransmitState: scénario inconnu → throw avec message clair", () => {
  assert.throws(
    () => scenarioToTransmitState('unknown-tx'),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.ok(
        err.message.includes("scenarioToTransmitState") && err.message.includes("unknown-tx"),
        `error message must name the function and the scenario, got: ${(err as Error).message}`,
      )
      return true
    },
  )
})
