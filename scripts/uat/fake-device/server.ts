/**
 * Fake Crestron DM-NVX device for local UAT — replays REAL captured JSON
 * (docs/hardware-validation/raw/192.168.2.10, a DM-NVX-360 Transmitter) and mirrors the
 * auth + SetPartial contract from src/api.ts. Lets the FULL journey (auth gauntlet + v0.2
 * encoder USE + oracle + teardown) run locally, with no real device.
 *
 * ⚠️ This validates the harness wiring against our MODEL of the device, NOT the firmware.
 * It does not replace the real-device UAT gate.
 *
 * Run: FAKE_NVX_PASS=<pw> npm run uat:fake-device   (HTTPS on :8443)
 */
import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { scenarioToReceiveState, scenarioToTransmitState } from './scenarios.js'

const PORT = Number(process.env.FAKE_NVX_PORT ?? 8443)
const PASSWORD = process.env.FAKE_NVX_PASS ?? 'fake-pass'
const RAW_DIR = process.env.FAKE_NVX_RAW ?? 'docs/hardware-validation/raw/192.168.2.10'
const CERT_DIR = 'scripts/uat/fake-device/certs'

type Json = Record<string, unknown>

// ── Self-signed cert (generated once via openssl; module uses ignoreSelfSignedCert) ──
function ensureCert(): { key: Buffer; cert: Buffer } {
  const keyPath = path.join(CERT_DIR, 'key.pem')
  const certPath = path.join(CERT_DIR, 'cert.pem')
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    mkdirSync(CERT_DIR, { recursive: true })
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '3650', '-subj', '/CN=localhost'],
      { stdio: 'ignore' },
    )
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) }
}

/** Apply a CresNext StreamReceive SetPartial body to a target Streams[0] object. Exported for tests.
 *  @param scenario — RX scenario to apply on Start:true (default 'decoding' = non-regression). */
export function applyReceiveSetPartial(body: Json, target: Json, scenario = 'decoding'): void {
  const sr = (body.Device as Json | undefined)?.StreamReceive as Json | undefined
  const streams = sr?.Streams
  if (!Array.isArray(streams)) return
  for (const props of streams as Json[]) {
    if (!props || Object.keys(props).length === 0) continue
    for (const [k, v] of Object.entries(props)) {
      if (k === 'Start' && v === true) {
        // MODEL of decode, not firmware: apply the named scenario (default='decoding' preserves non-regression).
        Object.assign(target, scenarioToReceiveState(scenario))
      } else if (k === 'Stop' && v === true) {
        target.Status = 'Stream Stopped'
        target.CodecReady = false
        target.HorizontalResolution = 0
        target.VerticalResolution = 0
        target.FramesPerSecond = 0
        target.NumVideoPacketsRcvd = 0
      } else {
        target[k] = v
      }
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

/** Crée une instance isolée du fake NVX : état mutable en closure, handler HTTP retourné.
 *  `config.rawDir`   : dossier des captures raw (défaut = RAW_DIR env/constant).
 *  `config.password` : mot de passe auth (défaut = PASSWORD env/constant).
 *  Chaque appel retourne une instance avec son propre état — isolation par test garantie. */
export function createFakeDevice(
  config: { rawDir?: string; password?: string } = {},
): { handler: (req: IncomingMessage, res: import('node:http').ServerResponse) => void } {
  const rawDir = config.rawDir ?? RAW_DIR
  const password = config.password ?? PASSWORD

  function loadSub(name: string): Json {
    return JSON.parse(readFileSync(path.join(rawDir, `Device_${name}.json`), 'utf8')) as Json
  }

  // ── Instance state (mutable, isolated per createFakeDevice() call) ──────────

  // Current RX/TX scenarios — set via POST /_control/scenario. Defaults preserve non-regression.
  let currentRxScenario = 'decoding'
  let currentTxScenario = 'stopped'

  // Mutable StreamTransmit state (SetPartial writes land here; GET reflects them).
  const streamTransmit = loadSub('StreamTransmit')

  // Mutable StreamReceive state for the Receiver profile. Loaded if the RAW exposes it
  // (try/catch: a pure encoder like the E30 .11 has none → stays null).
  let streamReceive: Json | null = null
  try { streamReceive = loadSub('StreamReceive') } catch { streamReceive = null }

  function receiveStream0(): Json | null {
    const sr = (streamReceive?.Device as Json | undefined)?.StreamReceive as Json | undefined
    const streams = sr?.Streams
    return Array.isArray(streams) && streams.length > 0 ? (streams[0] as Json) : null
  }

  function stream0(): Json {
    const dev = streamTransmit.Device as Json
    const st = dev.StreamTransmit as Json
    const streams = st.Streams as Json[]
    return streams[0]
  }

  /** Apply a CresNext SetPartial body to the in-memory StreamTransmit state. */
  function applySetPartial(body: Json): void {
    const device = body.Device as Json | undefined
    const st = device?.StreamTransmit as Json | undefined
    const streams = st?.Streams
    if (!Array.isArray(streams)) return
    const target = stream0()
    for (const props of streams as Json[]) {
      if (!props || Object.keys(props).length === 0) continue
      for (const [k, v] of Object.entries(props)) {
        if (k === 'Start' && v === true) target.Status = 'Stream started'
        else if (k === 'Stop' && v === true) target.Status = 'Stream Stopped'
        else target[k] = v
      }
    }
  }

  // ── Mono-role derivation (fail-fast at construction) ────────────────────────

  /** Lit DeviceSpecific.DeviceMode dans le RAW et retourne le rôle de cette instance.
   *  Throw immédiatement si DeviceMode est absent ou invalide — le fake NVX est strictement
   *  mono-rôle (Transmitter OU Receiver), jamais bi-rôle. */
  function deriveFakeRole(): 'Transmitter' | 'Receiver' {
    const ds = loadSub('DeviceSpecific')
    const mode = ((ds.Device as Json | undefined)?.DeviceSpecific as Json | undefined)?.DeviceMode
    if (mode === 'Transmitter' || mode === 'Receiver') return mode
    throw new Error('fake: DeviceSpecific.DeviceMode absent/invalide — rôle indéterminable')
  }

  const fakeRole = deriveFakeRole()

  // ── Subsystem routing table ──────────────────────────────────────────────────

  interface SubsystemEntry {
    /** Retourne l'objet subsystem servi (ou null si absent — ex. RX sur config TX pure). */
    state: () => Json | null
    /** Applique un SetPartial sur l'état mutable de l'instance. */
    apply: (body: Json) => void
    /** Rôle auquel ce subsystem appartient — consommé en 3c pour la garde mono-rôle. */
    role: 'Transmitter' | 'Receiver'
  }

  const SUBSYSTEMS: Record<string, SubsystemEntry> = {
    StreamTransmit: {
      state: () => streamTransmit,
      apply: applySetPartial,
      role: 'Transmitter',
    },
    StreamReceive: {
      state: () => streamReceive,
      apply: (b) => {
        if (!streamReceive) return
        const t = receiveStream0()
        if (t) applyReceiveSetPartial(b, t, currentRxScenario)
      },
      role: 'Receiver',
    },
  }

  // ── HTTP handler (closes over instance state above) ──────────────────────────

  const handler = (req: IncomingMessage, res: import('node:http').ServerResponse) => {
    void (async () => {
      const url = req.url ?? ''
      const method = req.method ?? 'GET'
      const sub = url.split('?')[0]
      const body = method === 'POST' ? await readBody(req) : ''

      // ── Auth: GET TRACKID, POST credentials ──
      if (sub === '/userlogin.html' && method === 'GET') {
        res.setHeader('Set-Cookie', 'TRACKID=faketrack; Path=/')
        res.writeHead(200, { 'Content-Type': 'text/html' })
        return res.end('<html>login</html>')
      }
      if (sub === '/userlogin.html' && method === 'POST') {
        const passwd = new URLSearchParams(body).get('passwd') ?? ''
        if (passwd === password) {
          res.setHeader('Set-Cookie', 'AUTHID=ok; Path=/')
          res.writeHead(200, { 'Content-Type': 'text/html' })
          return res.end('OK')
        }
        res.writeHead(401)
        return res.end('Unauthorized')
      }
      if (sub === '/logout') {
        res.writeHead(200)
        return res.end('bye')
      }

      // ── Control API: POST /_control/scenario — set current RX/TX scenario (no auth required) ──
      if (sub === '/_control/scenario' && method === 'POST') {
        try {
          const parsed = JSON.parse(body) as { role?: string; scenario?: string }
          const scenario = parsed.scenario ?? ''
          const role = parsed.role ?? 'rx'
          // Validate — scenarioToReceiveState/Transmit throw on unknown name.
          if (role === 'tx') {
            scenarioToTransmitState(scenario)
            currentTxScenario = scenario
          } else {
            const rxState = scenarioToReceiveState(scenario)
            currentRxScenario = scenario
            // Apply immediately to the live StreamReceive state so the oracle sees it
            // without waiting for a subsequent Start command (needed when stream is already started).
            const t = receiveStream0()
            if (t) Object.assign(t, rxState)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ ok: true, scenario }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
        }
      }

      // ── Writes: POST /Device SetPartial → route by subsystem key (no session guard) ──
      if (sub === '/Device' && method === 'POST') {
        try {
          const parsed = JSON.parse(body) as Json
          const dev = parsed.Device as Json | undefined
          const name = Object.keys(SUBSYSTEMS).find(k => k in (dev ?? {}))
          if (name && SUBSYSTEMS[name].role !== fakeRole) {
            // Garde mono-rôle : POST vers le subsystem du rôle opposé → 404.
            res.writeHead(404)
            return res.end(`${name} absent on ${fakeRole}`)
          }
          if (name) {
            SUBSYSTEMS[name].apply(parsed)
          } else {
            applySetPartial(parsed)
          }
        } catch {
          /* ignore malformed */
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ Actions: [{ Results: [{ StatusId: 0 }] }] }))
      }

      // ── Reads: GET /Device/<Subsystem> (session required) ──
      if (sub.startsWith('/Device/') && method === 'GET') {
        if (!(req.headers.cookie ?? '').includes('AUTHID=ok')) {
          res.writeHead(401)
          return res.end('no session')
        }
        const name = sub.slice('/Device/'.length)
        // Garde mono-rôle : un subsystem rolebound absent du rôle courant → 404 distinct.
        if (name in SUBSYSTEMS && SUBSYSTEMS[name].role !== fakeRole) {
          res.writeHead(404)
          return res.end(`${name} absent on ${fakeRole}`)
        }
        // Table pour les subsystems mutables ; loadSub en fallback pour les read-only (DeviceInfo…).
        let json: Json | null = SUBSYSTEMS[name]?.state() ?? null
        if (!json) {
          try { json = loadSub(name) } catch { json = null }
        }
        if (!json) {
          res.writeHead(404)
          return res.end('unknown subsystem')
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify(json))
      }

      res.writeHead(404)
      res.end('not found')
    })()
  }

  return { handler }
}

function start(): void {
  const { key, cert } = ensureCert()
  const { handler } = createFakeDevice({ password: PASSWORD, rawDir: RAW_DIR })
  const server = https.createServer({ key, cert }, handler)
  server.listen(PORT, () => {
    console.log(`fake NVX on https://0.0.0.0:${PORT} — RAW=${RAW_DIR} — auth password via FAKE_NVX_PASS`)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start()
