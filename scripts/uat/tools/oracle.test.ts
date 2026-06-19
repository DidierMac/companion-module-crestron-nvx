/**
 * oracle.test.ts — co-évolution vague 1 — Green depuis ae417bb
 *
 * Contrat de l'API oracle (implémentée) :
 *   read(endpoint)                  → Device[lastSegment] brut  (PAS Streams[0])
 *   snapshot(endpoint)              → stocke Device[lastSegment] par clé endpoint
 *   restore(endpoint, buildBodies)  → poste buildBodies(subsystem) dans l'ordre
 *   setRxScenario(scenario)         → inchangé
 *
 * Wrappers legacy (v1 — cohabitent avec steps-lab non migré) :
 *   readStream0()      = read('/Device/StreamTransmit').Streams[0]
 *   readReceiveStream0()= read('/Device/StreamReceive').Streams[0]
 *   captureBaseline()  = snapshot('/Device/StreamTransmit')
 *   captureBaselineRx()= snapshot('/Device/StreamReceive')
 *   restoreTx()        = restore('/Device/StreamTransmit', txBuilder)
 *   restoreRx()        = restore('/Device/StreamReceive', rxBuilder)
 *
 * Invariants comportementaux :
 *   Tx  — restoreTx rejoue  name → multicast → {Start|Stop}
 *   Rx  — restoreRx rejoue  {SessionInitiation + URL|Multicast} → {Start|Stop}
 *   {skipped:true} sans snapshot/captureBaseline, {skipped:false} avec
 *   logout() dans finally après chaque méthode
 *
 * Invariant architectural :
 *   aucun import de src/panels dans oracle.ts (test d'architecture)
 *
 * Seul test Red restant : guard builders (M-2) — attend l'implémentation du guard.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Oracle } from './oracle.js'
import type { NvxApiClient } from '../../../src/api.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// ── Types ─────────────────────────────────────────────────────────────────────

/** Json = type des valeurs manipulées par l'oracle. */
type Json = Record<string, unknown>

/**
 * Builder : reçoit le subsystem complet (Device[lastSegment]) et retourne
 * la liste de bodies SetPartial à poster dans l'ordre.
 * Tx : reçoit { Streams: [{...}] }, drill dans Streams[0].
 */
type BuildBodiesFn = (subsystem: Json) => unknown[]

// ── Builders (fournis par le SubsystemSpec ; reçoivent le subsystem complet) ───

/**
 * Builder Tx — reproduit la séquence POST de l'ancienne restore().
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
 * Builder Rx — reproduit la séquence POST de l'ancienne restoreRx().
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

// ══════════════════════════════════════════════════════════════════════════════
// Section 1 — read(endpoint) : transport générique, retourne Device[lastSegment]
// ══════════════════════════════════════════════════════════════════════════════

test('read() retourne le subsystem StreamTransmit brut (PAS Streams[0])', async () => {
  const o = new Oracle(() => makeTxClient({ RtspSessionName: 'MYSTREAM', Status: 'Stream started' }))
  const subsystem = await o.read('/Device/StreamTransmit')
  // subsystem = { Streams: [{ RtspSessionName: 'MYSTREAM', ... }] }
  assert.ok(Array.isArray(subsystem.Streams), 'doit retourner { Streams:[…] }, pas Streams[0] directement')
  assert.equal((subsystem.Streams as Array<Json>)[0]?.RtspSessionName, 'MYSTREAM')
})

test('read() retourne le subsystem StreamReceive brut', async () => {
  const o = new Oracle(() => makeRxClient({ SessionInitiation: 'Multicast via RTSP', Status: 'Stream Stopped' }))
  const subsystem = await o.read('/Device/StreamReceive')
  assert.ok(Array.isArray(subsystem.Streams), 'doit retourner { Streams:[…] }')
  assert.equal((subsystem.Streams as Array<Json>)[0]?.SessionInitiation, 'Multicast via RTSP')
})

test('read() retourne le subsystem AudioVideoInputOutput brut — généricité NON-Streams prouvée', async () => {
  // Preuve que l'oracle n'est PAS couplé à Streams[0] :
  // un endpoint audio (v0.4) retourne { Outputs:[…] }, sans .Streams.
  const o = new Oracle(() => makeAudioClient({ Volume: -20, Muted: false }))
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
  const o = new Oracle(() => client)
  await assert.rejects(() => o.read('/Device/StreamTransmit'))
})

test('read() appelle logout() exactement une fois après succès', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'X' }] } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await o.read('/Device/StreamTransmit')
  assert.equal(logoutCount, 1, 'read() doit appeler logout() exactement une fois')
})

test('read() appelle logout() même si get() rejette (finally)', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => { throw new Error('device unreachable') },
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await assert.rejects(() => o.read('/Device/StreamTransmit'), /device unreachable/)
  assert.equal(logoutCount, 1, 'read() doit appeler logout() même si get() rejette')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 2 — snapshot + restore — chemin Tx (séquence comportementale préservée)
// ══════════════════════════════════════════════════════════════════════════════

test('snapshot+restore Tx — reposte name → multicast → {Stop} dans l\'ordre exact', async () => {
  const posted: unknown[] = []
  const o = new Oracle(() => makeTxClient(
    { RtspSessionName: 'ORIG', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' },
    posted,
  ))
  await o.snapshot('/Device/StreamTransmit')
  await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.equal(posted.length, 3, 'doit rejouer 3 POST : name + multicast + state')
  assert.deepEqual(posted[0], { Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'ORIG' }] } } })
  assert.deepEqual(posted[1], { Device: { StreamTransmit: { Streams: [{ MulticastAddress: '239.1.1.1' }] } } })
  assert.deepEqual(posted[2], { Device: { StreamTransmit: { Streams: [{ Stop: true }] } } })
})

test('snapshot+restore Tx — reposte {Start:true} quand Status était "Stream started"', async () => {
  const posted: unknown[] = []
  const o = new Oracle(() => makeTxClient(
    { RtspSessionName: 'LIVE', MulticastAddress: '239.1.2.3', Status: 'Stream started' },
    posted,
  ))
  await o.snapshot('/Device/StreamTransmit')
  await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.deepEqual(posted[2], { Device: { StreamTransmit: { Streams: [{ Start: true }] } } })
})

test('snapshot+restore Tx — omet POST name si RtspSessionName absent du snapshot', async () => {
  const posted: unknown[] = []
  const o = new Oracle(() => makeTxClient(
    { MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' },  // pas de RtspSessionName
    posted,
  ))
  await o.snapshot('/Device/StreamTransmit')
  await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.equal(posted.length, 2, 'sans RtspSessionName : 2 POST seulement (multicast + state)')
  assert.deepEqual(posted[0], { Device: { StreamTransmit: { Streams: [{ MulticastAddress: '239.1.1.1' }] } } })
})

test('restore() Tx — retourne {skipped:true} sans snapshot préalable', async () => {
  const o = new Oracle(() => makeTxClient({}))
  const result = await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.deepEqual(result, { skipped: true })
})

test('restore() Tx — retourne {skipped:false} avec snapshot préalable', async () => {
  const o = new Oracle(() => makeTxClient({ RtspSessionName: 'X', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' }))
  await o.snapshot('/Device/StreamTransmit')
  const result = await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.deepEqual(result, { skipped: false })
})

test('restore() Tx — appelle logout() exactement une fois', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'X', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' }] } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await o.snapshot('/Device/StreamTransmit')
  const countBefore = logoutCount
  await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.equal(logoutCount - countBefore, 1, 'restore() Tx doit appeler logout() exactement une fois')
})

test('restore() Tx — appelle logout() même si postSetPartial() rejette (finally)', async () => {
  let logoutCount = 0
  let throwOnPost = false
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'X', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' }] } } }),
    postSetPartial: async () => { if (throwOnPost) throw new Error('device unreachable'); return 0 },
    post: async () => ({}),
  } as unknown as NvxApiClient))
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
  const o = new Oracle(() => makeRxClient(
    { SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4', Status: 'Stream Stopped' },
    posted,
  ))
  await o.snapshot('/Device/StreamReceive')
  await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.deepEqual(posted[0], { Device: { StreamReceive: { Streams: [{ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4' }] } } })
  assert.deepEqual(posted[1], { Device: { StreamReceive: { Streams: [{ Stop: true }] } } })
})

test('snapshot+restore Rx ByReceiver — reposte SessionInitiation+StreamLocation → {Start}', async () => {
  const posted: unknown[] = []
  const o = new Oracle(() => makeRxClient(
    { SessionInitiation: 'ByReceiver', StreamLocation: 'rtsp://10.0.0.9:554/live.sdp', Status: 'Stream started' },
    posted,
  ))
  await o.snapshot('/Device/StreamReceive')
  await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.deepEqual(posted[0], { Device: { StreamReceive: { Streams: [{ SessionInitiation: 'ByReceiver', StreamLocation: 'rtsp://10.0.0.9:554/live.sdp' }] } } })
  assert.deepEqual(posted[1], { Device: { StreamReceive: { Streams: [{ Start: true }] } } })
})

test('restore() Rx — retourne {skipped:true} sans snapshot préalable', async () => {
  const o = new Oracle(() => makeRxClient({}))
  const result = await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.deepEqual(result, { skipped: true })
})

test('restore() Rx — retourne {skipped:false} avec snapshot préalable', async () => {
  const o = new Oracle(() => makeRxClient(
    { SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4', Status: 'Stream Stopped' },
  ))
  await o.snapshot('/Device/StreamReceive')
  const result = await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.deepEqual(result, { skipped: false })
})

test('restore() Rx — appelle logout() exactement une fois', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamReceive: { Streams: [{ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4', Status: 'Stream Stopped' }] } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await o.snapshot('/Device/StreamReceive')
  const countBefore = logoutCount
  await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.equal(logoutCount - countBefore, 1, 'restore() Rx doit appeler logout() exactement une fois')
})

test('restore() Rx — appelle logout() même si postSetPartial() rejette (finally)', async () => {
  let logoutCount = 0
  let throwOnPost = false
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({ Device: { StreamReceive: { Streams: [{ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4', Status: 'Stream Stopped' }] } } }),
    postSetPartial: async () => { if (throwOnPost) throw new Error('device unreachable'); return 0 },
    post: async () => ({}),
  } as unknown as NvxApiClient))
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
  const o = new Oracle(() => makeAudioClient(audioState, posted))
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
  const o = new Oracle(() =>
    useRx
      ? makeRxClient({ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.99.0.1', Status: 'Stream started' }, rxPosted)
      : makeTxClient({ RtspSessionName: 'TX-ORIG', Status: 'Stream Stopped' }, txPosted),
  )
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
  const o = new Oracle(() => makeTxClient({ RtspSessionName: 'ORIG', Status: 'Stream Stopped' }))
  const s = await o.readStream0()
  assert.equal(s.RtspSessionName, 'ORIG', 'readStream0 doit retourner Streams[0]')
})

test('readReceiveStream0() retourne Streams[0] de StreamReceive', async () => {
  const o = new Oracle(() => makeRxClient({ SessionInitiation: 'ByReceiver', Status: 'Stream started' }))
  const s = await o.readReceiveStream0()
  assert.equal(s.SessionInitiation, 'ByReceiver', 'readReceiveStream0 doit retourner Streams[0]')
})

// I-1 : chemins d'erreur wrappers — Streams absent ou vide
test('readStream0() throw quand Streams est vide', async () => {
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamTransmit: { Streams: [] } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  await assert.rejects(() => o.readStream0(), /Streams\[0\] absent/)
})

test('readReceiveStream0() throw quand StreamReceive Streams est vide', async () => {
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamReceive: { Streams: [] } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  await assert.rejects(() => o.readReceiveStream0(), /StreamReceive Streams\[0\] absent/)
})

test('captureBaseline() + restoreTx() — rejoue le nom capturé', async () => {
  // captureBaseline() = snapshot('/Device/StreamTransmit')
  // restoreTx()       = restore('/Device/StreamTransmit', txBuilder)
  const posted: unknown[] = []
  const o = new Oracle(() => makeTxClient(
    { RtspSessionName: 'CAP', MulticastAddress: '239.0.0.1', Status: 'Stream Stopped' },
    posted,
  ))
  await o.captureBaseline()
  await o.restoreTx()
  assert.ok(posted.some(b => JSON.stringify(b).includes('CAP')), 'restoreTx doit rejouer le nom capturé')
})

test('captureBaselineRx() + restoreRx() — rejoue le multicast capturé', async () => {
  // captureBaselineRx() = snapshot('/Device/StreamReceive')
  // restoreRx()         = restore('/Device/StreamReceive', rxBuilder)
  const posted: unknown[] = []
  const o = new Oracle(() => makeRxClient(
    { SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.0.0.4', Status: 'Stream Stopped' },
    posted,
  ))
  await o.captureBaselineRx()
  await o.restoreRx()
  assert.ok(posted.some(b => JSON.stringify(b).includes('239.0.0.4')), 'restoreRx doit rejouer le multicast capturé')
})

test('restoreTx() — {skipped:true} sans captureBaseline préalable', async () => {
  const o = new Oracle(() => makeTxClient({}))
  const result = await o.restoreTx()
  assert.deepEqual(result, { skipped: true })
})

test('restoreRx() — {skipped:true} sans captureBaselineRx préalable', async () => {
  const o = new Oracle(() => makeRxClient({}))
  const result = await o.restoreRx()
  assert.deepEqual(result, { skipped: true })
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 5b — Guard builders (M-2) — Red en attente du coder
//
// Les builders internes (txBuilder / rxBuilder) utilisent encore `?? {}` comme
// fallback quand Streams est absent. Le coder ajoutera un guard explicite qui
// throw si le subsystem n'a pas de clé Streams — empêchant un restore silencieux
// invalide (POST { Stop: true } sur un subsystem non-Streams).
//
// Ce test est Red jusqu'à l'ajout du guard dans oracle.ts.
// ══════════════════════════════════════════════════════════════════════════════

test('restoreTx() throw quand le snapshot ne contient pas de clé Streams [guard builder — Red]', async () => {
  // Arrange : fake retourne un subsystem sans .Streams (ex. réponse inattendue du device).
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamTransmit: { unexpectedKey: true } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  await o.captureBaseline()  // stocke { unexpectedKey: true } — snapshot réussit
  // Act + Assert : restoreTx() doit rejeter car txBuilder reçoit un subsystem sans Streams.
  // Actuellement : txBuilder fait `?? {}` → retourne corps silencieux → test FAIL (Red).
  // Après guard : txBuilder throw "Streams absent" → assert.rejects passe → Green.
  await assert.rejects(
    () => o.restoreTx(),
    /Streams/,
    'restoreTx() doit rejeter quand le subsystem n\'a pas de clé Streams',
  )
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 6 — setRxScenario (API préservée telle quelle)
// ══════════════════════════════════════════════════════════════════════════════

test('setRxScenario() appelle logout() exactement une fois après succès', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({}),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient))
  await o.setRxScenario('rx-negotiating')
  assert.equal(logoutCount, 1, 'setRxScenario() doit appeler logout() exactement une fois')
})

test('setRxScenario() appelle logout() même si post() rejette (finally)', async () => {
  let logoutCount = 0
  const o = new Oracle(() => ({
    login: async () => {},
    logout: async () => { logoutCount++ },
    get: async () => ({}),
    postSetPartial: async () => 0,
    post: async () => { throw new Error('scenario route absent') },
  } as unknown as NvxApiClient))
  await assert.rejects(() => o.setRxScenario('rx-negotiating'), /scenario route absent/)
  assert.equal(logoutCount, 1, 'setRxScenario() doit appeler logout() même si post() rejette')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 7 — Test d'architecture (régression)
// ══════════════════════════════════════════════════════════════════════════════

test('architecture — oracle.ts n\'importe aucun module de src/panels', () => {
  // co-évolution vague 1 — Green depuis ae417bb.
  // Régression guard : si un import src/panels réapparaît, ce test casse.
  const src = readFileSync(join(__dirname, 'oracle.ts'), 'utf8')
  assert.ok(
    !src.includes('src/panels'),
    'oracle.ts ne doit plus importer depuis src/panels — remplacer par un builder local',
  )
})
