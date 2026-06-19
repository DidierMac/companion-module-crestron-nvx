/**
 * oracle.test.ts — Red phase (vague 1, Phase 3) — v2 post-revue archi
 *
 * Co-évolution test-first : oracle.test.ts teste l'API CIBLE générique.
 * oracle.ts implémente encore l'ancienne API → tests Red pour bonne raison.
 *
 * Contrat de l'API cible :
 *   read(endpoint)                  → Device[lastSegment] brut  (PAS Streams[0])
 *   snapshot(endpoint)              → stocke Device[lastSegment] par clé endpoint
 *   restore(endpoint, buildBodies)  → poste buildBodies(subsystem) dans l'ordre
 *   setRxScenario(scenario)         → inchangé
 *
 * Wrappers legacy (cohabitent avec steps-lab v1 non migré) :
 *   readStream0()      = read('/Device/StreamTransmit').Streams[0]
 *   readReceiveStream0()= read('/Device/StreamReceive').Streams[0]
 *   captureBaseline()  = snapshot('/Device/StreamTransmit')
 *   captureBaselineRx()= snapshot('/Device/StreamReceive')
 *   restoreTx()        = restore('/Device/StreamTransmit', txBuilder)  ← RENOMMÉ depuis restore()
 *   restoreRx()        = restore('/Device/StreamReceive', rxBuilder)
 *
 * Invariants comportementaux préservés :
 *   Tx  — restoreTx rejoue  name → multicast → {Start|Stop}
 *   Rx  — restoreRx rejoue  {SessionInitiation + URL|Multicast} → {Start|Stop}
 *   {skipped:true} sans snapshot/captureBaseline, {skipped:false} avec
 *   logout() dans finally après chaque méthode
 *
 * Invariant architectural :
 *   aucun import de src/panels dans oracle.ts (test d'architecture)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Oracle } from './oracle.js'
import type { NvxApiClient } from '../../../src/api.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// ── Types cible ────────────────────────────────────────────────────────────────

/** Json = type des valeurs manipulées par l'oracle générique. */
type Json = Record<string, unknown>

/**
 * Builder : reçoit le subsystem complet (Device[lastSegment]) et retourne
 * la liste de bodies SetPartial à poster dans l'ordre.
 * Exemple Tx : buildBodies reçoit { Streams: [{...}] }, drill dans Streams[0].
 */
type BuildBodiesFn = (subsystem: Json) => unknown[]

/** Interface de l'oracle cible. Déclarée localement pour permettre la compilation
 *  avant que oracle.ts n'implémente ces méthodes (cast via unknown). */
interface OracleTarget {
  // Noyau générique
  read(endpoint: string): Promise<Json>
  snapshot(endpoint: string): Promise<void>
  restore(endpoint: string, buildBodies: BuildBodiesFn): Promise<{ skipped: boolean }>
  // Wrappers legacy
  readStream0(): Promise<Json>
  readReceiveStream0(): Promise<Json>
  captureBaseline(): Promise<void>
  captureBaselineRx(): Promise<void>
  restoreTx(): Promise<{ skipped: boolean }>  // renommé depuis restore()
  restoreRx(): Promise<{ skipped: boolean }>
  // Fake control
  setRxScenario(scenario: string): Promise<void>
}

// ── Builders (fournis par le SubsystemSpec ; reçoivent le subsystem complet) ───

/**
 * Builder Tx — reproduit la séquence de l'ancienne restore().
 * Reçoit Device.StreamTransmit = { Streams: [{...}] }, drill dans Streams[0].
 *
 * Séquence POST exacte à préserver :
 *   POST 1 : { RtspSessionName }   si présent
 *   POST 2 : { MulticastAddress }  si présent
 *   POST 3 : { Start:true } ou { Stop:true } selon Status
 */
const buildTxBodies: BuildBodiesFn = (subsystem) => {
  const b = (subsystem.Streams as Array<Json>)?.[0] ?? {}
  const bodies: unknown[] = []
  if (typeof b.RtspSessionName === 'string')
    bodies.push({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: b.RtspSessionName }] } } })
  if (typeof b.MulticastAddress === 'string')
    bodies.push({ Device: { StreamTransmit: { Streams: [{ MulticastAddress: b.MulticastAddress }] } } })
  bodies.push({ Device: { StreamTransmit: { Streams: [b.Status === 'Stream started' ? { Start: true } : { Stop: true }] } } })
  return bodies
}

/**
 * Builder Rx — reproduit la séquence de l'ancienne restoreRx().
 * Reçoit Device.StreamReceive = { Streams: [{...}] }, drill dans Streams[0].
 *
 * Séquence POST exacte à préserver :
 *   POST 1 : { SessionInitiation + StreamLocation } (ByReceiver) ou { SessionInitiation + MulticastAddress }
 *   POST 2 : { Start:true } ou { Stop:true } selon Status
 */
const buildRxBodies: BuildBodiesFn = (subsystem) => {
  const b = (subsystem.Streams as Array<Json>)?.[0] ?? {}
  const bodies: unknown[] = []
  if (typeof b.SessionInitiation === 'string') {
    if (b.SessionInitiation === 'ByReceiver' && typeof b.StreamLocation === 'string')
      bodies.push({ Device: { StreamReceive: { Streams: [{ SessionInitiation: 'ByReceiver', StreamLocation: b.StreamLocation }] } } })
    else if (typeof b.MulticastAddress === 'string')
      bodies.push({ Device: { StreamReceive: { Streams: [{ SessionInitiation: b.SessionInitiation, MulticastAddress: b.MulticastAddress }] } } })
  }
  bodies.push({ Device: { StreamReceive: { Streams: [b.Status === 'Stream started' ? { Start: true } : { Stop: true }] } } })
  return bodies
}

/**
 * Builder Audio v0.4 — NON-Streams.
 * Reçoit Device.AudioVideoInputOutput = { Outputs: [{Ports: [{Audio: {...}}]}] }.
 * Prouve que le pattern est générique : l'oracle ne connaît pas la structure.
 */
const buildAudioBodies: BuildBodiesFn = (subsystem) => {
  type AudioOut = { Ports: Array<{ Audio: unknown }> }
  const audio = (subsystem.Outputs as Array<AudioOut>)?.[0]?.Ports?.[0]?.Audio ?? {}
  return [{ Device: { AudioVideoInputOutput: { Outputs: [{ Ports: [{ Audio: audio }] }] } } }]
}

// ── Factories de clients fake ─────────────────────────────────────────────────
// Les clients retournent le JSON complet Device.*. L'oracle extrait Device[lastSegment].

function makeTxClient(stream0: Json, posted?: unknown[]) {
  return {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamTransmit: { Streams: [stream0] } } }),
    postSetPartial: async (b: unknown) => { posted?.push(b); return 0 },
    post: async () => ({}),
  } as unknown as NvxApiClient
}

function makeRxClient(stream0: Json, posted?: unknown[]) {
  return {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamReceive: { Streams: [stream0] } } }),
    postSetPartial: async (b: unknown) => { posted?.push(b); return 0 },
    post: async () => ({}),
  } as unknown as NvxApiClient
}

function makeAudioClient(audio: Json, posted?: unknown[]) {
  return {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { AudioVideoInputOutput: { Outputs: [{ Ports: [{ Audio: audio }] }] } } }),
    postSetPartial: async (b: unknown) => { posted?.push(b); return 0 },
    post: async () => ({}),
  } as unknown as NvxApiClient
}

/** Cast oracle vers l'interface cible pour les appels de tests. */
function asTarget(o: Oracle): OracleTarget {
  return o as unknown as OracleTarget
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 1 — read(endpoint) : transport générique, retourne Device[lastSegment]
// ══════════════════════════════════════════════════════════════════════════════

test('read() retourne le subsystem StreamTransmit brut (PAS Streams[0])', async () => {
  const o = asTarget(new Oracle(() => makeTxClient({ RtspSessionName: 'MYSTREAM', Status: 'Stream started' })))
  const subsystem = await o.read('/Device/StreamTransmit')
  // subsystem = { Streams: [{ RtspSessionName: 'MYSTREAM', ... }] }
  assert.ok(Array.isArray(subsystem.Streams), 'doit retourner { Streams:[…] }, pas Streams[0] directement')
  assert.equal((subsystem.Streams as Array<Json>)[0]?.RtspSessionName, 'MYSTREAM')
})

test('read() retourne le subsystem StreamReceive brut', async () => {
  const o = asTarget(new Oracle(() => makeRxClient({ SessionInitiation: 'Multicast via RTSP', Status: 'Stream Stopped' })))
  const subsystem = await o.read('/Device/StreamReceive')
  assert.ok(Array.isArray(subsystem.Streams), 'doit retourner { Streams:[…] }')
  assert.equal((subsystem.Streams as Array<Json>)[0]?.SessionInitiation, 'Multicast via RTSP')
})

test('read() retourne le subsystem AudioVideoInputOutput brut — généricité NON-Streams prouvée', async () => {
  // Preuve que l'oracle n'est PAS couplé à Streams[0] :
  // un endpoint audio (v0.4) retourne { Outputs:[…] }, sans .Streams.
  const o = asTarget(new Oracle(() => makeAudioClient({ Volume: -20, Muted: false })))
  const subsystem = await o.read('/Device/AudioVideoInputOutput')
  assert.ok(subsystem.Outputs, 'doit retourner { Outputs:[…] } — pas .Streams')
  assert.ok(!('Streams' in subsystem), 'ne contient PAS .Streams — confirme que l\'oracle est générique')
  const audio = (subsystem.Outputs as Array<{ Ports: Array<{ Audio: Json }> }>)[0]?.Ports?.[0]?.Audio
  assert.equal(audio?.Volume, -20)
})

test('read() throw quand Device[endpoint-segment] est absent de la réponse', async () => {
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: {} }),  // StreamTransmit absent
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient
  const o = asTarget(new Oracle(() => client))
  await assert.rejects(() => o.read('/Device/StreamTransmit'))
})

test('read() appelle logout() exactement une fois après succès', async () => {
  let logoutCount = 0
  const o = asTarget(new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'X' }] } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient)))
  await o.read('/Device/StreamTransmit')
  assert.equal(logoutCount, 1, 'read() doit appeler logout() exactement une fois')
})

test('read() appelle logout() même si get() rejette (finally)', async () => {
  let logoutCount = 0
  const o = asTarget(new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => { throw new Error('device unreachable') },
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient)))
  await assert.rejects(() => o.read('/Device/StreamTransmit'), /device unreachable/)
  assert.equal(logoutCount, 1, 'read() doit appeler logout() même si get() rejette')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 2 — snapshot + restore — chemin Tx (séquence comportementale préservée)
// ══════════════════════════════════════════════════════════════════════════════

test('snapshot+restore Tx — reposte name → multicast → {Stop} dans l\'ordre exact', async () => {
  const posted: unknown[] = []
  const o = asTarget(new Oracle(() => makeTxClient(
    { RtspSessionName: 'ORIG', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' },
    posted,
  )))
  await o.snapshot('/Device/StreamTransmit')
  await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.equal(posted.length, 3, 'doit rejouer 3 POST : name + multicast + state')
  assert.deepEqual(posted[0], { Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'ORIG' }] } } })
  assert.deepEqual(posted[1], { Device: { StreamTransmit: { Streams: [{ MulticastAddress: '239.1.1.1' }] } } })
  assert.deepEqual(posted[2], { Device: { StreamTransmit: { Streams: [{ Stop: true }] } } })
})

test('snapshot+restore Tx — reposte {Start:true} quand Status était "Stream started"', async () => {
  const posted: unknown[] = []
  const o = asTarget(new Oracle(() => makeTxClient(
    { RtspSessionName: 'LIVE', MulticastAddress: '239.1.2.3', Status: 'Stream started' },
    posted,
  )))
  await o.snapshot('/Device/StreamTransmit')
  await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.deepEqual(posted[2], { Device: { StreamTransmit: { Streams: [{ Start: true }] } } })
})

test('snapshot+restore Tx — omet POST name si RtspSessionName absent du snapshot', async () => {
  const posted: unknown[] = []
  const o = asTarget(new Oracle(() => makeTxClient(
    { MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' },  // pas de RtspSessionName
    posted,
  )))
  await o.snapshot('/Device/StreamTransmit')
  await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.equal(posted.length, 2, 'sans RtspSessionName : 2 POST seulement (multicast + state)')
  assert.deepEqual(posted[0], { Device: { StreamTransmit: { Streams: [{ MulticastAddress: '239.1.1.1' }] } } })
})

test('restore() Tx — retourne {skipped:true} sans snapshot préalable', async () => {
  const o = asTarget(new Oracle(() => makeTxClient({})))
  const result = await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.deepEqual(result, { skipped: true })
})

test('restore() Tx — retourne {skipped:false} avec snapshot préalable', async () => {
  const o = asTarget(new Oracle(() => makeTxClient({ RtspSessionName: 'X', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' })))
  await o.snapshot('/Device/StreamTransmit')
  const result = await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.deepEqual(result, { skipped: false })
})

test('restore() Tx — appelle logout() exactement une fois', async () => {
  let logoutCount = 0
  const o = asTarget(new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'X', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' }] } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient)))
  await o.snapshot('/Device/StreamTransmit')
  const countBefore = logoutCount
  await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.equal(logoutCount - countBefore, 1, 'restore() Tx doit appeler logout() exactement une fois')
})

test('restore() Tx — appelle logout() même si postSetPartial() rejette (finally)', async () => {
  let logoutCount = 0
  let throwOnPost = false
  const o = asTarget(new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'X', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' }] } } }),
    postSetPartial: async () => { if (throwOnPost) throw new Error('device unreachable'); return 0 },
    post: async () => ({}),
  } as unknown as NvxApiClient)))
  await o.snapshot('/Device/StreamTransmit')
  const countBefore = logoutCount
  throwOnPost = true
  await assert.rejects(() => o.restore('/Device/StreamTransmit', buildTxBodies), /device unreachable/)
  assert.equal(logoutCount - countBefore, 1, 'restore() Tx doit appeler logout() même si postSetPartial() rejette')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 3 — snapshot + restore — chemin Rx (séquence comportementale préservée)
// ══════════════════════════════════════════════════════════════════════════════

test('snapshot+restore Rx Multicast — reposte SessionInitiation+Multicast → {Stop}', async () => {
  const posted: unknown[] = []
  const o = asTarget(new Oracle(() => makeRxClient(
    { SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4', Status: 'Stream Stopped' },
    posted,
  )))
  await o.snapshot('/Device/StreamReceive')
  await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.deepEqual(posted[0], { Device: { StreamReceive: { Streams: [{ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4' }] } } })
  assert.deepEqual(posted[1], { Device: { StreamReceive: { Streams: [{ Stop: true }] } } })
})

test('snapshot+restore Rx ByReceiver — reposte SessionInitiation+StreamLocation → {Start}', async () => {
  const posted: unknown[] = []
  const o = asTarget(new Oracle(() => makeRxClient(
    { SessionInitiation: 'ByReceiver', StreamLocation: 'rtsp://10.0.0.9:554/live.sdp', Status: 'Stream started' },
    posted,
  )))
  await o.snapshot('/Device/StreamReceive')
  await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.deepEqual(posted[0], { Device: { StreamReceive: { Streams: [{ SessionInitiation: 'ByReceiver', StreamLocation: 'rtsp://10.0.0.9:554/live.sdp' }] } } })
  assert.deepEqual(posted[1], { Device: { StreamReceive: { Streams: [{ Start: true }] } } })
})

test('restore() Rx — retourne {skipped:true} sans snapshot préalable', async () => {
  const o = asTarget(new Oracle(() => makeRxClient({})))
  const result = await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.deepEqual(result, { skipped: true })
})

test('restore() Rx — retourne {skipped:false} avec snapshot préalable', async () => {
  const o = asTarget(new Oracle(() => makeRxClient(
    { SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4', Status: 'Stream Stopped' },
  )))
  await o.snapshot('/Device/StreamReceive')
  const result = await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.deepEqual(result, { skipped: false })
})

test('restore() Rx — appelle logout() exactement une fois', async () => {
  let logoutCount = 0
  const o = asTarget(new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamReceive: { Streams: [{ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4', Status: 'Stream Stopped' }] } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient)))
  await o.snapshot('/Device/StreamReceive')
  const countBefore = logoutCount
  await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.equal(logoutCount - countBefore, 1, 'restore() Rx doit appeler logout() exactement une fois')
})

test('restore() Rx — appelle logout() même si postSetPartial() rejette (finally)', async () => {
  let logoutCount = 0
  let throwOnPost = false
  const o = asTarget(new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamReceive: { Streams: [{ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4', Status: 'Stream Stopped' }] } } }),
    postSetPartial: async () => { if (throwOnPost) throw new Error('device unreachable'); return 0 },
    post: async () => ({}),
  } as unknown as NvxApiClient)))
  await o.snapshot('/Device/StreamReceive')
  const countBefore = logoutCount
  throwOnPost = true
  await assert.rejects(() => o.restore('/Device/StreamReceive', buildRxBodies), /device unreachable/)
  assert.equal(logoutCount - countBefore, 1, 'restore() Rx doit appeler logout() même si postSetPartial() rejette')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 4 — Généricité non-Streams (preuve que audio v0.4 branche sans toucher oracle.ts)
// ══════════════════════════════════════════════════════════════════════════════

test('snapshot+restore non-Streams — reposte exactement les bodies fournis par le builder audio', async () => {
  const posted: unknown[] = []
  const audioState = { Volume: -30, Muted: true }
  const o = asTarget(new Oracle(() => makeAudioClient(audioState, posted)))
  await o.snapshot('/Device/AudioVideoInputOutput')
  await o.restore('/Device/AudioVideoInputOutput', buildAudioBodies)
  assert.equal(posted.length, 1, 'le builder audio produit 1 seul POST')
  assert.deepEqual(
    posted[0],
    { Device: { AudioVideoInputOutput: { Outputs: [{ Ports: [{ Audio: audioState }] }] } } },
  )
})

test('deux snapshots indépendants — Tx et Rx isolés par clé endpoint', async () => {
  const txPosted: unknown[] = []
  const rxPosted: unknown[] = []
  let useRx = false
  const o = asTarget(new Oracle(() =>
    useRx
      ? makeRxClient({ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.99.0.1', Status: 'Stream started' }, rxPosted)
      : makeTxClient({ RtspSessionName: 'TX-ORIG', Status: 'Stream Stopped' }, txPosted),
  ))
  await o.snapshot('/Device/StreamTransmit')
  useRx = true
  await o.snapshot('/Device/StreamReceive')
  useRx = false
  await o.restore('/Device/StreamTransmit', buildTxBodies)
  useRx = true
  await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.ok(
    txPosted.some(b => JSON.stringify(b).includes('TX-ORIG')),
    'restore Tx doit rejouer le snapshot Tx (RtspSessionName TX-ORIG)',
  )
  assert.ok(
    rxPosted.some(b => JSON.stringify(b).includes('239.99.0.1')),
    'restore Rx doit rejouer le snapshot Rx (MulticastAddress 239.99.0.1)',
  )
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 5 — Wrappers legacy (filet comportemental pour la cohabitation v1)
// ══════════════════════════════════════════════════════════════════════════════

test('readStream0() retourne Streams[0] de StreamTransmit', async () => {
  const o = asTarget(new Oracle(() => makeTxClient({ RtspSessionName: 'ORIG', Status: 'Stream Stopped' })))
  const s = await o.readStream0()
  assert.equal(s.RtspSessionName, 'ORIG', 'readStream0 doit retourner Streams[0]')
})

test('readReceiveStream0() retourne Streams[0] de StreamReceive', async () => {
  const o = asTarget(new Oracle(() => makeRxClient({ SessionInitiation: 'ByReceiver', Status: 'Stream started' })))
  const s = await o.readReceiveStream0()
  assert.equal(s.SessionInitiation, 'ByReceiver', 'readReceiveStream0 doit retourner Streams[0]')
})

test('captureBaseline() + restoreTx() — rejoue le nom capturé', async () => {
  // captureBaseline() = snapshot('/Device/StreamTransmit')
  // restoreTx()       = restore('/Device/StreamTransmit', txBuilder)
  // Ce test est Red car restoreTx() n'existe pas encore (renommé depuis restore()).
  const posted: unknown[] = []
  const o = asTarget(new Oracle(() => makeTxClient(
    { RtspSessionName: 'CAP', MulticastAddress: '239.0.0.1', Status: 'Stream Stopped' },
    posted,
  )))
  await o.captureBaseline()
  await o.restoreTx()  // Red : TypeError — restoreTx is not a function
  assert.ok(posted.some(b => JSON.stringify(b).includes('CAP')), 'restoreTx doit rejouer le nom capturé')
})

test('captureBaselineRx() + restoreRx() — rejoue le multicast capturé', async () => {
  // captureBaselineRx() = snapshot('/Device/StreamReceive')
  // restoreRx()         = restore('/Device/StreamReceive', rxBuilder)
  const posted: unknown[] = []
  const o = asTarget(new Oracle(() => makeRxClient(
    { SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.0.0.4', Status: 'Stream Stopped' },
    posted,
  )))
  await o.captureBaselineRx()
  await o.restoreRx()
  assert.ok(posted.some(b => JSON.stringify(b).includes('239.0.0.4')), 'restoreRx doit rejouer le multicast capturé')
})

test('restoreTx() — {skipped:true} sans captureBaseline préalable', async () => {
  // Red : restoreTx() n'existe pas encore (renommé depuis restore()).
  const o = asTarget(new Oracle(() => makeTxClient({})))
  const result = await o.restoreTx()
  assert.deepEqual(result, { skipped: true })
})

test('restoreRx() — {skipped:true} sans captureBaselineRx préalable', async () => {
  const o = asTarget(new Oracle(() => makeRxClient({})))
  const result = await o.restoreRx()
  assert.deepEqual(result, { skipped: true })
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 6 — setRxScenario (API préservée telle quelle)
// ══════════════════════════════════════════════════════════════════════════════

test('setRxScenario() appelle logout() exactement une fois après succès', async () => {
  let logoutCount = 0
  const o = asTarget(new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({}),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient)))
  await o.setRxScenario('rx-negotiating')
  assert.equal(logoutCount, 1, 'setRxScenario() doit appeler logout() exactement une fois')
})

test('setRxScenario() appelle logout() même si post() rejette (finally)', async () => {
  let logoutCount = 0
  const o = asTarget(new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({}),
    postSetPartial: async () => 0,
    post: async () => { throw new Error('scenario route absent') },
  } as unknown as NvxApiClient)))
  await assert.rejects(() => o.setRxScenario('rx-negotiating'), /scenario route absent/)
  assert.equal(logoutCount, 1, 'setRxScenario() doit appeler logout() même si post() rejette')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 7 — Test d'architecture (régression)
// ══════════════════════════════════════════════════════════════════════════════

test('architecture — oracle.ts n\'importe aucun module de src/panels', () => {
  // Après implémentation, oracle.ts doit utiliser un builder local (streamsSetBody)
  // à la place de streamTransmitBody / streamReceiveBody importés depuis src/panels.
  // Ce test est Red car oracle.ts a encore ces 2 imports.
  const src = readFileSync(join(__dirname, 'oracle.ts'), 'utf8')
  assert.ok(
    !src.includes('src/panels'),
    'oracle.ts ne doit plus importer depuis src/panels — remplacer par un builder local',
  )
})
