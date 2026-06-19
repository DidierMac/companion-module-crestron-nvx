/**
 * oracle.test.ts — Red phase (vague 1, Phase 3)
 *
 * Co-évolution test-first : ce fichier teste l'API CIBLE générique de l'oracle.
 * oracle.ts implémente encore l'ancienne API (readStream0 / captureBaseline / restoreRx…) ;
 * les tests échouent donc en phase Rouge pour la bonne raison : méthodes manquantes.
 *
 * Invariants comportementaux préservés :
 *   Tx  — snapshot → restore rejoue  name → multicast → {Start|Stop}  (même séquence qu'avant)
 *   Rx  — snapshot → restore rejoue  {SessionInitiation + URL|Multicast} → {Start|Stop}
 *   {skipped:true} sans snapshot, {skipped:false} avec snapshot
 *   logout() appelé dans finally après chaque méthode
 *
 * Nouvelles garanties :
 *   read/snapshot/restore acceptent N'IMPORTE QUEL endpoint + extracteur — pas hardcodé Streams[0]
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

// ── Types cible (API générique attendue après implémentation) ─────────────────

type ExtractFn = (json: unknown) => Record<string, unknown>
type BuildBodiesFn = (baseline: Record<string, unknown>) => unknown[]

/** Interface de l'oracle générique. Déclarée localement pour permettre la compilation
 *  du test avant que oracle.ts ne l'implémente (cast via unknown). */
interface OracleTarget {
  read(endpoint: string, extract: ExtractFn): Promise<Record<string, unknown>>
  snapshot(endpoint: string, extract: ExtractFn): Promise<void>
  restore(endpoint: string, buildBodies: BuildBodiesFn): Promise<{ skipped: boolean }>
  setRxScenario(scenario: string): Promise<void>
}

// ── Extracteurs (fournis par le SubsystemSpec, passés à read/snapshot) ────────

/** Extrait Streams[0] depuis /Device/StreamTransmit */
const extractTxStreams0: ExtractFn = (json) => {
  const j = json as { Device?: { StreamTransmit?: { Streams?: Array<Record<string, unknown>> } } }
  const s = j.Device?.StreamTransmit?.Streams?.[0]
  if (!s) throw new Error('Streams[0] absent')
  return s
}

/** Extrait Streams[0] depuis /Device/StreamReceive */
const extractRxStreams0: ExtractFn = (json) => {
  const j = json as { Device?: { StreamReceive?: { Streams?: Array<Record<string, unknown>> } } }
  const s = j.Device?.StreamReceive?.Streams?.[0]
  if (!s) throw new Error('StreamReceive Streams[0] absent')
  return s
}

/** Extrait l'objet Audio depuis AudioVideoInputOutput — chemin v0.4, NON-Streams.
 *  Prouve que l'oracle est générique et n'est pas couplé à Streams[0]. */
const extractAudio: ExtractFn = (json) => {
  const j = json as {
    Device?: { AudioVideoInputOutput?: { Outputs?: Array<{ Ports?: Array<{ Audio?: Record<string, unknown> }> }> } }
  }
  const audio = j?.Device?.AudioVideoInputOutput?.Outputs?.[0]?.Ports?.[0]?.Audio
  if (!audio) throw new Error('Audio absent')
  return audio
}

// ── Builders de restore (fournis par le SubsystemSpec, passés à restore) ──────
// Ces builders reproduisent EXACTEMENT la séquence de POST de l'ancienne API
// (restore() et restoreRx()) — invariant comportemental à préserver.

/** Builder Tx — reproduit la séquence de l'ancienne restore()
 *  POST 1 : name (si présent)
 *  POST 2 : multicast (si présent)
 *  POST 3 : {Start:true} ou {Stop:true} selon Status */
const buildTxBodies: BuildBodiesFn = (b) => {
  const bodies: unknown[] = []
  if (typeof b.RtspSessionName === 'string')
    bodies.push({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: b.RtspSessionName }] } } })
  if (typeof b.MulticastAddress === 'string')
    bodies.push({ Device: { StreamTransmit: { Streams: [{ MulticastAddress: b.MulticastAddress }] } } })
  bodies.push({ Device: { StreamTransmit: { Streams: [b.Status === 'Stream started' ? { Start: true } : { Stop: true }] } } })
  return bodies
}

/** Builder Rx — reproduit la séquence de l'ancienne restoreRx()
 *  POST 1 : {SessionInitiation + StreamLocation} (ByReceiver) ou {SessionInitiation + MulticastAddress}
 *  POST 2 : {Start:true} ou {Stop:true} selon Status */
const buildRxBodies: BuildBodiesFn = (b) => {
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

/** Builder Audio — chemin v0.4, non-Streams : re-poste l'objet Audio capturé. */
const buildAudioBodies: BuildBodiesFn = (b) => [
  { Device: { AudioVideoInputOutput: { Outputs: [{ Ports: [{ Audio: b }] }] } } },
]

// ── Factories de clients fake ─────────────────────────────────────────────────

function makeTxClient(stream0: Record<string, unknown>, posted?: unknown[]) {
  return {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamTransmit: { Streams: [stream0] } } }),
    postSetPartial: async (b: unknown) => { posted?.push(b); return 0 },
    post: async () => ({}),
  } as unknown as NvxApiClient
}

function makeRxClient(stream0: Record<string, unknown>, posted?: unknown[]) {
  return {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamReceive: { Streams: [stream0] } } }),
    postSetPartial: async (b: unknown) => { posted?.push(b); return 0 },
    post: async () => ({}),
  } as unknown as NvxApiClient
}

function makeAudioClient(audio: Record<string, unknown>, posted?: unknown[]) {
  return {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { AudioVideoInputOutput: { Outputs: [{ Ports: [{ Audio: audio }] }] } } }),
    postSetPartial: async (b: unknown) => { posted?.push(b); return 0 },
    post: async () => ({}),
  } as unknown as NvxApiClient
}

/** Raccourci : cast oracle vers l'interface cible pour les appels de tests. */
function asTarget(o: Oracle): OracleTarget {
  return o as unknown as OracleTarget
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 1 — read(endpoint, extract) : transport générique
// ══════════════════════════════════════════════════════════════════════════════

test('read() extrait Streams[0] via extracteur Tx (chemin canonique)', async () => {
  const o = asTarget(new Oracle(() => makeTxClient({ RtspSessionName: 'MYSTREAM', Status: 'Stream started' })))
  const s = await o.read('/Device/StreamTransmit', extractTxStreams0)
  assert.equal(s.RtspSessionName, 'MYSTREAM')
})

test('read() extrait Streams[0] via extracteur Rx', async () => {
  const o = asTarget(new Oracle(() => makeRxClient({ SessionInitiation: 'Multicast via RTSP', Status: 'Stream Stopped' })))
  const s = await o.read('/Device/StreamReceive', extractRxStreams0)
  assert.equal(s.SessionInitiation, 'Multicast via RTSP')
})

test('read() extrait un objet NON-Streams — généricité audio v0.4 prouvée', async () => {
  // Ce test prouve que l'oracle n'est PAS couplé à Streams[0] :
  // un extracteur arbitraire (chemin audio v0.4) fonctionne sans modifier oracle.ts.
  const o = asTarget(new Oracle(() => makeAudioClient({ Volume: -20, Muted: false })))
  const audio = await o.read('/Device/AudioVideoInputOutput', extractAudio)
  assert.equal(audio.Volume, -20)
  assert.equal(audio.Muted, false)
})

test('read() propage l\'exception de l\'extracteur quand Streams[0] est absent', async () => {
  const client = {
    login: async () => {},
    logout: async () => {},
    get: async () => ({ Device: { StreamTransmit: { Streams: [] } } }),
    postSetPartial: async () => 0,
    post: async () => ({}),
  } as unknown as NvxApiClient
  const o = asTarget(new Oracle(() => client))
  await assert.rejects(() => o.read('/Device/StreamTransmit', extractTxStreams0), /Streams\[0\] absent/)
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
  await o.read('/Device/StreamTransmit', extractTxStreams0)
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
  await assert.rejects(() => o.read('/Device/StreamTransmit', extractTxStreams0), /device unreachable/)
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
  await o.snapshot('/Device/StreamTransmit', extractTxStreams0)
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
  await o.snapshot('/Device/StreamTransmit', extractTxStreams0)
  await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.deepEqual(posted[2], { Device: { StreamTransmit: { Streams: [{ Start: true }] } } })
})

test('snapshot+restore Tx — omet POST name si RtspSessionName absent du snapshot', async () => {
  const posted: unknown[] = []
  const o = asTarget(new Oracle(() => makeTxClient(
    { MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' },  // pas de RtspSessionName
    posted,
  )))
  await o.snapshot('/Device/StreamTransmit', extractTxStreams0)
  await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.equal(posted.length, 2, 'sans RtspSessionName : 2 POST seulement (multicast + state)')
  assert.deepEqual(posted[0], { Device: { StreamTransmit: { Streams: [{ MulticastAddress: '239.1.1.1' }] } } })
})

test('restore() Tx — retourne {skipped:true} sans snapshot préalable', async () => {
  const o = asTarget(new Oracle(() => makeTxClient({})))
  const result = await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.deepEqual(result, { skipped: true }, 'restore() doit signaler l\'absence de baseline')
})

test('restore() Tx — retourne {skipped:false} avec snapshot préalable', async () => {
  const o = asTarget(new Oracle(() => makeTxClient({ RtspSessionName: 'X', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' })))
  await o.snapshot('/Device/StreamTransmit', extractTxStreams0)
  const result = await o.restore('/Device/StreamTransmit', buildTxBodies)
  assert.deepEqual(result, { skipped: false }, 'restore() doit signaler que le baseline a été appliqué')
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
  await o.snapshot('/Device/StreamTransmit', extractTxStreams0)
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
  await o.snapshot('/Device/StreamTransmit', extractTxStreams0)
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
  await o.snapshot('/Device/StreamReceive', extractRxStreams0)
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
  await o.snapshot('/Device/StreamReceive', extractRxStreams0)
  await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.deepEqual(posted[0], { Device: { StreamReceive: { Streams: [{ SessionInitiation: 'ByReceiver', StreamLocation: 'rtsp://10.0.0.9:554/live.sdp' }] } } })
  assert.deepEqual(posted[1], { Device: { StreamReceive: { Streams: [{ Start: true }] } } })
})

test('restore() Rx — retourne {skipped:true} sans snapshot préalable', async () => {
  const o = asTarget(new Oracle(() => makeRxClient({})))
  const result = await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.deepEqual(result, { skipped: true }, 'restore() Rx doit signaler l\'absence de baselineRx')
})

test('restore() Rx — retourne {skipped:false} avec snapshot préalable', async () => {
  const o = asTarget(new Oracle(() => makeRxClient(
    { SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.1.1.4', Status: 'Stream Stopped' },
  )))
  await o.snapshot('/Device/StreamReceive', extractRxStreams0)
  const result = await o.restore('/Device/StreamReceive', buildRxBodies)
  assert.deepEqual(result, { skipped: false }, 'restore() Rx doit signaler que le baselineRx a été appliqué')
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
  await o.snapshot('/Device/StreamReceive', extractRxStreams0)
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
  await o.snapshot('/Device/StreamReceive', extractRxStreams0)
  const countBefore = logoutCount
  throwOnPost = true
  await assert.rejects(() => o.restore('/Device/StreamReceive', buildRxBodies), /device unreachable/)
  assert.equal(logoutCount - countBefore, 1, 'restore() Rx doit appeler logout() même si postSetPartial() rejette')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 4 — Généricité non-Streams (preuve que l'audio v0.4 branche sans toucher oracle.ts)
// ══════════════════════════════════════════════════════════════════════════════

test('snapshot+restore non-Streams — reposte exactement les bodies fournis par le builder audio', async () => {
  const posted: unknown[] = []
  const audioState = { Volume: -30, Muted: true }
  const o = asTarget(new Oracle(() => makeAudioClient(audioState, posted)))
  await o.snapshot('/Device/AudioVideoInputOutput', extractAudio)
  await o.restore('/Device/AudioVideoInputOutput', buildAudioBodies)
  assert.equal(posted.length, 1, 'le builder audio produit 1 seul POST')
  assert.deepEqual(
    posted[0],
    { Device: { AudioVideoInputOutput: { Outputs: [{ Ports: [{ Audio: audioState }] }] } } },
  )
})

test('deux snapshots indépendants — Tx et Rx isolés par clé endpoint', async () => {
  // Vérifie que snapshot/restore kèye le baseline par endpoint (pas de collision Tx/Rx).
  const txPosted: unknown[] = []
  const rxPosted: unknown[] = []

  let useRx = false
  const o = asTarget(new Oracle(() =>
    useRx
      ? makeRxClient({ SessionInitiation: 'Multicast via RTSP', MulticastAddress: '239.99.0.1', Status: 'Stream started' }, rxPosted)
      : makeTxClient({ RtspSessionName: 'TX-ORIG', Status: 'Stream Stopped' }, txPosted),
  ))

  await o.snapshot('/Device/StreamTransmit', extractTxStreams0)
  useRx = true
  await o.snapshot('/Device/StreamReceive', extractRxStreams0)
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
// Section 5 — setRxScenario (API préservée telle quelle)
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
// Section 6 — Test d'architecture (régression)
// ══════════════════════════════════════════════════════════════════════════════

test('architecture — oracle.ts n\'importe aucun module de src/panels', () => {
  // Après l'implémentation, oracle.ts doit utiliser un builder local (streamsSetBody)
  // à la place de streamTransmitBody/streamReceiveBody importés depuis src/panels.
  // Ce test échoue en phase Rouge car oracle.ts a encore ces 2 imports.
  const src = readFileSync(join(__dirname, 'oracle.ts'), 'utf8')
  assert.ok(
    !src.includes('src/panels'),
    'oracle.ts ne doit plus importer depuis src/panels — les builders streamTransmitBody/streamReceiveBody doivent être remplacés par un builder local',
  )
})
