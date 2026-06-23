/**
 * server.test.ts — caractérisation du fake NVX server (vague 3a — Red)
 *
 * Verrouille le comportement ACTUEL de handler via mock req/res.
 * PAS de vrai serveur HTTPS : chaque test pilote handler() directement.
 *
 * Red parce que createFakeDevice n'est pas encore exportée par server.ts.
 * Green quand le coder extrait le seam : createFakeDevice(config?) → { handler }.
 *
 * Mécanique Red :
 *   createFakeDevice = (server as Record)['createFakeDevice'] as CreateFakeDevice
 *   → undefined à l'exécution (tsc compile grâce au cast direct)
 *   → TypeError: createFakeDevice is not a function dans chaque test
 *
 * req = EventEmitter { url, method, headers } + émission data/end asynchrone (setImmediate)
 * res = capteur { statusCode, headers, body } résolvant une promesse sur res.end()
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as server from './server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Chemin absolu vers les raw captures — comportement réel à verrouiller
const RAW_DIR = path.resolve(__dirname, '../../../docs/hardware-validation/raw/192.168.2.10')
const PASSWORD = 'test-pass'

// ── Seam (pas encore exporté — Red vague 3a) ─────────────────────────────────

type Handler = (req: object, res: object) => void
type CreateFakeDevice = (config?: { rawDir?: string; password?: string }) => { handler: Handler }

// Cast direct : tsc compile, createFakeDevice === undefined à l'exécution.
const createFakeDevice = (server as Record<string, unknown>)['createFakeDevice'] as CreateFakeDevice

// ── Mock req / res ────────────────────────────────────────────────────────────

type MockReq = EventEmitter & { url: string; method: string; headers: Record<string, string> }

type ResResult = { statusCode: number; headers: Record<string, string>; body: string }

function makeReq(url: string, method = 'GET', body = '', headers: Record<string, string> = {}): MockReq {
  const req = new EventEmitter() as MockReq
  req.url = url
  req.method = method
  req.headers = headers
  // Pour les requêtes POST : émettre data+end après que readBody() ait posé ses listeners.
  if (method === 'POST') {
    setImmediate(() => {
      if (body) req.emit('data', Buffer.from(body))
      req.emit('end')
    })
  }
  return req
}

function makeRes(): { res: object; done: Promise<ResResult> } {
  let resolve!: (r: ResResult) => void
  const done = new Promise<ResResult>(r => { resolve = r })
  let statusCode = 200
  const headers: Record<string, string> = {}
  const res = {
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value },
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code
      if (hdrs) for (const [k, v] of Object.entries(hdrs)) headers[k.toLowerCase()] = v
    },
    end(b = '') { resolve({ statusCode, headers, body: b }) },
  }
  return { res, done }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// RAW Transmitter (.10, fakeRole=Transmitter) — instance par défaut
/** Crée une instance Transmitter fraîche — état isolé par test. */
function device() {
  return createFakeDevice({ rawDir: RAW_DIR, password: PASSWORD })
}

// RAW Receiver (.9, fakeRole=Receiver) — pour les tests de garde Rx
const RX_RAW_DIR = path.resolve(__dirname, '../../../docs/hardware-validation/raw/192.168.2.9')

/** Crée une instance Receiver fraîche (rawDir .9, DeviceMode=Receiver). */
function rxDevice() {
  return createFakeDevice({ rawDir: RX_RAW_DIR, password: PASSWORD })
}

async function httpGet(h: Handler, url: string, cookies = ''): Promise<ResResult> {
  const { res, done } = makeRes()
  h(makeReq(url, 'GET', '', cookies ? { cookie: cookies } : {}), res)
  return done
}

async function httpPost(h: Handler, url: string, body: string, cookies = ''): Promise<ResResult> {
  const { res, done } = makeRes()
  h(makeReq(url, 'POST', body, cookies ? { cookie: cookies } : {}), res)
  return done
}

/** Lit Device.StreamTransmit.Streams[0] via GET authentifié. */
async function getStream0(h: Handler): Promise<Record<string, unknown>> {
  const r = await httpGet(h, '/Device/StreamTransmit', 'AUTHID=ok')
  const json = JSON.parse(r.body) as Record<string, unknown>
  const st = (json.Device as Record<string, unknown>)?.StreamTransmit as Record<string, unknown>
  return ((st?.Streams as Array<Record<string, unknown>>) ?? [])[0] ?? {}
}

/** Lit Device.StreamReceive.Streams[0] via GET authentifié. */
async function getReceiveStream0(h: Handler): Promise<Record<string, unknown>> {
  const r = await httpGet(h, '/Device/StreamReceive', 'AUTHID=ok')
  if (r.statusCode !== 200) throw new Error(`GET /Device/StreamReceive → ${r.statusCode}: ${r.body}`)
  const json = JSON.parse(r.body) as Record<string, unknown>
  const sr = (json.Device as Record<string, unknown>)?.StreamReceive as Record<string, unknown>
  return ((sr?.Streams as Array<Record<string, unknown>>) ?? [])[0] ?? {}
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 1 — Auth
// ══════════════════════════════════════════════════════════════════════════════

test('GET /userlogin.html → 200 + Set-Cookie TRACKID + body HTML', async () => {
  const { handler } = device()
  const r = await httpGet(handler, '/userlogin.html')
  assert.equal(r.statusCode, 200)
  assert.ok(r.headers['set-cookie']?.includes('TRACKID='), 'doit poser un cookie TRACKID')
  assert.ok(r.body.length > 0, 'doit retourner un body HTML non-vide')
})

test('POST /userlogin.html bon password → 200 + Set-Cookie AUTHID=ok', async () => {
  const { handler } = device()
  const r = await httpPost(handler, '/userlogin.html', `passwd=${PASSWORD}`)
  assert.equal(r.statusCode, 200)
  assert.ok(r.headers['set-cookie']?.includes('AUTHID=ok'), 'doit poser AUTHID=ok')
})

test('POST /userlogin.html mauvais password → 401', async () => {
  const { handler } = device()
  const r = await httpPost(handler, '/userlogin.html', 'passwd=wrong-password')
  assert.equal(r.statusCode, 401)
})

test('GET /logout → 200 + "bye" sans auth requis', async () => {
  const { handler } = device()
  const r = await httpGet(handler, '/logout')
  assert.equal(r.statusCode, 200)
  assert.ok(r.body.includes('bye'), 'body doit contenir "bye"')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 2 — Session guard (GET /Device/* nécessite AUTHID=ok)
// ══════════════════════════════════════════════════════════════════════════════

test('GET /Device/StreamTransmit sans cookie → 401 + "no session"', async () => {
  const { handler } = device()
  const r = await httpGet(handler, '/Device/StreamTransmit')
  assert.equal(r.statusCode, 401)
  assert.ok(r.body.includes('no session'), 'body doit contenir "no session"')
})

test('GET /Device/StreamTransmit avec AUTHID=ok → 200 + JSON', async () => {
  const { handler } = device()
  const r = await httpGet(handler, '/Device/StreamTransmit', 'AUTHID=ok')
  assert.equal(r.statusCode, 200)
  assert.doesNotThrow(() => JSON.parse(r.body), 'doit retourner du JSON valide')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 3 — Routage GET
// ══════════════════════════════════════════════════════════════════════════════

test('GET /Device/StreamTransmit → JSON contient Device.StreamTransmit.Streams (tableau non-vide)', async () => {
  const { handler } = device()
  const r = await httpGet(handler, '/Device/StreamTransmit', 'AUTHID=ok')
  const json = JSON.parse(r.body) as Record<string, unknown>
  const st = (json.Device as Record<string, unknown>)?.StreamTransmit as Record<string, unknown>
  const streams = st?.Streams
  assert.ok(Array.isArray(streams) && streams.length > 0, 'Device.StreamTransmit.Streams doit être un tableau non-vide')
})

test('GET /Device/DeviceInfo (subsystem raw fichier) → 200 + JSON parsable', async () => {
  const { handler } = device()
  const r = await httpGet(handler, '/Device/DeviceInfo', 'AUTHID=ok')
  assert.equal(r.statusCode, 200)
  assert.doesNotThrow(() => JSON.parse(r.body), 'DeviceInfo doit retourner du JSON valide depuis le fichier raw')
})

test('GET /Device/UnknownSubsystemXXX → 404', async () => {
  const { handler } = device()
  const r = await httpGet(handler, '/Device/UnknownSubsystemXXX', 'AUTHID=ok')
  assert.equal(r.statusCode, 404)
})

test('POST /Device ne nécessite PAS AUTHID (pas de session guard sur les writes)', async () => {
  // Comportement actuel à verrouiller : POST /Device répond 200 sans cookie
  const { handler } = device()
  const body = JSON.stringify({ Device: { StreamTransmit: { Streams: [{}] } } })
  const r = await httpPost(handler, '/Device', body)  // pas de cookie
  assert.equal(r.statusCode, 200, 'POST /Device doit répondre 200 même sans AUTHID')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 4 — POST SetPartial StreamTransmit (état mutable reflété par GET)
// ══════════════════════════════════════════════════════════════════════════════

test('POST /Device → répond 200 + JSON Actions[0].Results[0].StatusId === 0', async () => {
  const { handler } = device()
  const r = await httpPost(handler, '/Device', JSON.stringify({ Device: { StreamTransmit: { Streams: [{}] } } }))
  assert.equal(r.statusCode, 200)
  const json = JSON.parse(r.body) as Record<string, unknown>
  const results = (json?.Actions as Array<Record<string, unknown>>)?.[0]?.Results as Array<Record<string, unknown>>
  assert.equal(results?.[0]?.StatusId, 0, 'StatusId doit être 0 (CresNext contract)')
})

test('POST /Device {RtspSessionName:"TEST-123"} → GET suivant reflète TEST-123', async () => {
  const { handler } = device()
  await httpPost(handler, '/Device', JSON.stringify({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'TEST-123' }] } } }))
  const s = await getStream0(handler)
  assert.equal(s.RtspSessionName, 'TEST-123', 'RtspSessionName doit être reflété dans le GET suivant')
})

test('POST /Device {Start:true} → Status "Stream started"', async () => {
  const { handler } = device()
  await httpPost(handler, '/Device', JSON.stringify({ Device: { StreamTransmit: { Streams: [{ Start: true }] } } }))
  const s = await getStream0(handler)
  assert.equal(s.Status, 'Stream started')
})

test('POST /Device {Stop:true} → Status "Stream Stopped"', async () => {
  const { handler } = device()
  await httpPost(handler, '/Device', JSON.stringify({ Device: { StreamTransmit: { Streams: [{ Stop: true }] } } }))
  const s = await getStream0(handler)
  assert.equal(s.Status, 'Stream Stopped')
})

test('POST /Device JSON malformé → 200 silencieux (erreur parse ignorée)', async () => {
  // server.ts : try { JSON.parse(...) } catch { /* ignore malformed */ }
  // → le 200 + CresNext body est quand même retourné
  const { handler } = device()
  const r = await httpPost(handler, '/Device', 'NOT-JSON')
  assert.equal(r.statusCode, 200, 'JSON malformé doit être ignoré silencieusement (200 CresNext)')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 5 — Garde mono-rôle (3c — remplace le bi-rôle 3a)
//
// deriveFakeRole() lit DeviceSpecific.DeviceMode → 'Transmitter'|'Receiver'.
// SUBSYSTEMS rolebound : GET ET POST → 404 si rôle opposé (corps "${name} absent on ${fakeRole}").
// Subsystems role-agnostiques (DeviceInfo, DeviceSpecific…) : JAMAIS gardés → 200.
// Fail-fast : DeviceMode absent/invalide → throw à la construction.
//
// device()   = Tx (.10, DeviceMode=Transmitter) — StreamReceive gardé
// rxDevice() = Rx (.9,  DeviceMode=Receiver)   — StreamTransmit gardé
// ══════════════════════════════════════════════════════════════════════════════

// ── Garde Tx (fakeRole=Transmitter) : StreamReceive → 404 ────────────────────

test('GET /Device/StreamReceive sur Tx → 404 (StreamReceive absent on Transmitter)', async () => {
  const { handler } = device()
  const r = await httpGet(handler, '/Device/StreamReceive', 'AUTHID=ok')
  assert.equal(r.statusCode, 404)
  assert.ok(r.body.includes('absent on Transmitter'),
    `body doit contenir "absent on Transmitter", got: "${r.body}"`)
})

test('POST /Device StreamReceive sur Tx → 404 (garde mono-rôle en GET et POST)', async () => {
  const { handler } = device()
  const r = await httpPost(handler, '/Device',
    JSON.stringify({ Device: { StreamReceive: { Streams: [{ Stop: true }] } } }))
  assert.equal(r.statusCode, 404)
  assert.ok(r.body.includes('absent on Transmitter'),
    `body doit contenir "absent on Transmitter", got: "${r.body}"`)
})

// ── Garde Rx (fakeRole=Receiver) : StreamTransmit → 404 ──────────────────────

test('GET /Device/StreamTransmit sur Rx → 404 (StreamTransmit absent on Receiver)', async () => {
  const { handler } = rxDevice()
  const r = await httpGet(handler, '/Device/StreamTransmit', 'AUTHID=ok')
  assert.equal(r.statusCode, 404)
  assert.ok(r.body.includes('absent on Receiver'),
    `body doit contenir "absent on Receiver", got: "${r.body}"`)
})

test('POST /Device StreamTransmit sur Rx → 404 (garde mono-rôle en GET et POST)', async () => {
  const { handler } = rxDevice()
  const r = await httpPost(handler, '/Device',
    JSON.stringify({ Device: { StreamTransmit: { Streams: [{ Start: true }] } } }))
  assert.equal(r.statusCode, 404)
  assert.ok(r.body.includes('absent on Receiver'),
    `body doit contenir "absent on Receiver", got: "${r.body}"`)
})

// ── 404 garde DISTINCT de 404 unknown subsystem ───────────────────────────────

test('404 garde (absent on X) DISTINCT du 404 "unknown subsystem" — corps différents', async () => {
  const { handler } = device()  // Tx : StreamReceive est le subsystem gardé
  const guardR = await httpGet(handler, '/Device/StreamReceive', 'AUTHID=ok')   // 404 garde
  const unknownR = await httpGet(handler, '/Device/UnknownXXXYYY', 'AUTHID=ok') // 404 inconnu
  assert.equal(guardR.statusCode, 404)
  assert.equal(unknownR.statusCode, 404)
  assert.ok(guardR.body.includes('absent on'),
    `corps garde doit contenir "absent on", got: "${guardR.body}"`)
  assert.ok(unknownR.body.includes('unknown subsystem'),
    `corps inconnu doit contenir "unknown subsystem", got: "${unknownR.body}"`)
  assert.notEqual(guardR.body, unknownR.body, 'les deux 404 doivent avoir des corps distincts')
})

// ── Role-agnostique : DeviceInfo → 200 quel que soit le rôle ─────────────────

test('GET /Device/DeviceInfo → 200 sur Tx ET sur Rx (jamais gardé — role-agnostique)', async () => {
  const { handler: txH } = device()
  const { handler: rxH } = rxDevice()
  const rTx = await httpGet(txH, '/Device/DeviceInfo', 'AUTHID=ok')
  const rRx = await httpGet(rxH, '/Device/DeviceInfo', 'AUTHID=ok')
  assert.equal(rTx.statusCode, 200, 'DeviceInfo sur Tx doit être 200')
  assert.equal(rRx.statusCode, 200, 'DeviceInfo sur Rx doit être 200')
})

// ── Fail-fast : DeviceMode absent/invalide → throw à la construction ──────────

test('createFakeDevice → throw si DeviceSpecific.DeviceMode absent (fail-fast)', () => {
  // Fixture temporaire : StreamTransmit OK mais DeviceSpecific sans DeviceMode
  const dir = mkdtempSync(path.join(tmpdir(), 'fake-test-'))
  try {
    writeFileSync(path.join(dir, 'Device_StreamTransmit.json'),
      JSON.stringify({ Device: { StreamTransmit: { Streams: [{}] } } }))
    writeFileSync(path.join(dir, 'Device_DeviceSpecific.json'),
      JSON.stringify({ Device: { DeviceSpecific: {} } }))  // DeviceMode absent
    assert.throws(
      () => createFakeDevice({ rawDir: dir }),
      (err: Error) => /DeviceMode|absent|invalide/i.test(err.message),
      'createFakeDevice doit throw si DeviceMode est absent du RAW',
    )
  } finally {
    rmSync(dir, { recursive: true })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 6 — Control API POST /_control/scenario
// ══════════════════════════════════════════════════════════════════════════════

test('POST /_control/scenario {role:"rx",scenario:"negotiating"} → 200 + {ok:true, scenario:"negotiating"}', async () => {
  const { handler } = device()
  const r = await httpPost(handler, '/_control/scenario', JSON.stringify({ role: 'rx', scenario: 'negotiating' }))
  assert.equal(r.statusCode, 200)
  const json = JSON.parse(r.body) as { ok: boolean; scenario: string }
  assert.equal(json.ok, true)
  assert.equal(json.scenario, 'negotiating')
})

test('POST /_control/scenario scénario inconnu → 400 + {ok:false}', async () => {
  const { handler } = device()
  const r = await httpPost(handler, '/_control/scenario', JSON.stringify({ role: 'rx', scenario: 'unknown-xyz' }))
  assert.equal(r.statusCode, 400)
  const json = JSON.parse(r.body) as { ok: boolean }
  assert.equal(json.ok, false)
})

test('POST /_control/scenario {role:"rx",scenario:"negotiating"} applique immédiatement à StreamReceive', async () => {
  // Comportement actuel : Object.assign(receiveStream0(), scenarioToReceiveState(scenario))
  // sans attendre un Start — nécessaire quand le stream est déjà démarré.
  //
  // NOTE (3c) : on utilise rxDevice() et non device() — après la garde mono-rôle,
  // GET /Device/StreamReceive sur un Tx → 404 (StreamReceive absent on Transmitter).
  // Ce test accède à StreamReceive via getReceiveStream0() → doit être un Receiver.
  const { handler } = rxDevice()
  // D'abord Start pour avoir CodecReady:true (decoding par défaut)
  await httpPost(handler, '/Device', JSON.stringify({ Device: { StreamReceive: { Streams: [{ Start: true }] } } }))
  // Changer de scénario → appliqué immédiatement
  await httpPost(handler, '/_control/scenario', JSON.stringify({ role: 'rx', scenario: 'negotiating' }))
  const s = await getReceiveStream0(handler)
  assert.equal(s.CodecReady, false, 'negotiating doit être appliqué immédiatement → CodecReady:false')
})

test('POST /_control/scenario ne requiert pas AUTHID (pas de session guard)', async () => {
  const { handler } = device()
  const r = await httpPost(handler, '/_control/scenario', JSON.stringify({ role: 'rx', scenario: 'decoding' }))
  assert.equal(r.statusCode, 200, '/_control/scenario doit répondre 200 sans AUTHID cookie')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 7 — Fallback
// ══════════════════════════════════════════════════════════════════════════════

test('URL inconnue → 404 + "not found"', async () => {
  const { handler } = device()
  const r = await httpGet(handler, '/unknown/route/xyz')
  assert.equal(r.statusCode, 404)
  assert.ok(r.body.includes('not found'), 'body doit contenir "not found"')
})
