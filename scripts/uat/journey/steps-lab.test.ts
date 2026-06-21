import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labSteps } from './steps-lab.js'
import type { JourneyContext } from './types.js'
// M6 : HttpError n'existe pas encore dans companion-http.ts → ces tests échouent en phase RED.
// Une fois HttpError exporté, les deux tests ci-dessous (HTTP 500 propagé / HTTP 404 toléré)
// utilisent le typage fort au lieu du match de chaîne.
import { HttpError } from '../tools/companion-http.js'

function ctx(over: Partial<JourneyContext> = {}, nvxPass = ''): JourneyContext {
  const base = {
    config: {
      companionUrl: 'http://x:8000',
      container: 'c',
      label: 'nvx-uat',
      nvxHost: '192.0.2.1',
      nvxPass,
    },
    http: {
      findConnectionId: async () => 'abc',
      status: async () => ({ category: 'good', level: 'OK', message: '' }),
      enable: async () => {},
      disable: async () => {},
      restart: async () => {},
      getVariable: async () => '',
      press: async () => {},
    } as never,
    logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
    oracle: {
      // Méthodes génériques (post-migration vague 2c — stub entièrement générique)
      read: async () => ({ Streams: [{ RtspSessionName: 'X' }] }),
      snapshot: async () => {},
      restore: async () => ({ skipped: false }),
      setRxScenario: async () => {},
    } as never,
    ui: {
      open: async () => ({}),
      close: async () => {},
      moduleAvailable: async () => true,
      openConnectionConfig: async () => {},
      fillConfig: async () => {},
    } as never,
    sleep: async () => {},
  }
  return { ...base, ...over } as JourneyContext
}

test('all lab steps are scope:lab', () => {
  assert.ok(labSteps.length > 0)
  assert.ok(labSteps.every((s) => s.scope === 'lab'))
})

test('lab steps include the auth gauntlet ids', () => {
  const ids = labSteps.map((s) => s.id)
  assert.ok(ids.includes('CFG-WRONGPASS'))
  assert.ok(ids.includes('CFG-GOOD'))
})

test('lab steps include the v0.2 encoder USE ids', () => {
  const ids = labSteps.map((s) => s.id)
  for (const id of ['CAP', 'ENC-VARS', 'ENC-FEEDBACKS', 'ENC-NAME', 'ENC-MULTICAST', 'ENC-ENABLE', 'ENC-DISABLE'])
    assert.ok(ids.includes(id), `missing ${id}`)
})

test('CAP PASSes when device_role is Transmitter', async () => {
  const step = labSteps.find((s) => s.id === 'CAP')!
  const v = await step.run(
    ctx(
      {
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'ok' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => 'Transmitter',
          press: async () => {},
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'PASS')
})

test('a WRITE step SKIPs when its button is not mapped (device present, Transmitter, no layout)', async () => {
  const step = labSteps.find((s) => s.id === 'ENC-NAME')!
  const v = await step.run(ctxWithRole('Transmitter')) // config.layout undefined
  assert.equal(v.status, 'SKIP')
  assert.match(String(v.evidence.note), /layout|SETUP/i)
})

test('every lab step SKIPs without a device (empty nvxPass)', async () => {
  for (const s of labSteps) {
    const v = await s.run(ctx({}, ''))
    assert.equal(v.status, 'SKIP', `${s.id} should SKIP without device`)
  }
})

test('baseline precedes the USE block and teardown is last', () => {
  const ids = labSteps.map((s) => s.id)
  assert.ok(ids.indexOf('BASELINE') < ids.indexOf('CAP'), 'BASELINE before CAP')
  assert.equal(ids[ids.length - 1], 'TEARDOWN', 'TEARDOWN last')
})

test('BASELINE and TEARDOWN PASS with a device (Transmitter role)', async () => {
  const baseline = labSteps.find((s) => s.id === 'BASELINE')!
  const teardown = labSteps.find((s) => s.id === 'TEARDOWN')!
  // BASELINE reads StreamTransmit — must be a Transmitter.
  assert.equal((await baseline.run(ctxWithRole('Transmitter'))).status, 'PASS')
  assert.equal((await teardown.run(ctx({}, 'realpass'))).status, 'PASS')
})

test('TEARDOWN FAILs (reports) when restore throws', async () => {
  const teardown = labSteps.find((s) => s.id === 'TEARDOWN')!
  const v = await teardown.run(
    ctx(
      {
        oracle: {
          // post-migration : TEARDOWN appelle oracle.restore(endpoint, buildBodies)
          restore: async () => { throw new Error('device unreachable') },
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'FAIL')
  assert.match(String(v.evidence.note), /restore failed/i)
})

test('CFG-GOOD PASSes when status ok AND oracle reads a stream (with device)', async () => {
  const step = labSteps.find((s) => s.id === 'CFG-GOOD')!
  const v = await step.run(ctx({}, 'realpass'))
  assert.equal(v.status, 'PASS')
})

test('CFG-GOOD FAILs when the oracle cannot read a stream', async () => {
  const step = labSteps.find((s) => s.id === 'CFG-GOOD')!
  const v = await step.run(
    ctx(
      {
        oracle: {
          // post-migration : CFG-GOOD appelle oracle.read('/Device/StreamTransmit')
          read: async () => { throw new Error('no session') },
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'FAIL')
})

// ── Task 2: AMBIGUOUS — CFG-WRONGPASS / CFG-GOOD when condition not observable ─

test('CFG-WRONGPASS — log absent → AMBIGUOUS', async () => {
  // nvxPass set (no SKIP), logs.detect → false (auth cause not observed in logs), http.status → good
  const step = labSteps.find((s) => s.id === 'CFG-WRONGPASS')!
  const v = await step.run(
    ctx(
      {
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'good', level: 'OK', message: '' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => '',
          press: async () => {},
        } as never,
        logs: { mark: () => ({ ts: 't' }), detect: () => false } as never,
        ui: {
          open: async () => ({}),
          close: async () => {},
          moduleAvailable: async () => true,
          openConnectionConfig: async () => {},
          fillConfig: async () => {},
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'AMBIGUOUS')
})

test('CFG-WRONGPASS — warning + log présent → PASS', async () => {
  const step = labSteps.find((s) => s.id === 'CFG-WRONGPASS')!
  const v = await step.run(
    ctx(
      {
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'warning', level: 'Warning', message: '' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => '',
          press: async () => {},
        } as never,
        logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
        ui: {
          open: async () => ({}),
          close: async () => {},
          moduleAvailable: async () => true,
          openConnectionConfig: async () => {},
          fillConfig: async () => {},
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'PASS')
})

test('CFG-GOOD — catégorie jamais good → AMBIGUOUS (connexion non établie)', async () => {
  // pollStatusCategory never sees 'good' (http.status → { category:'error' })
  const step = labSteps.find((s) => s.id === 'CFG-GOOD')!
  const v = await step.run(
    ctx(
      {
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'error', level: 'Error', message: '' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => '',
          press: async () => {},
        } as never,
        logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
        oracle: {
          // post-migration : CFG-GOOD appelle oracle.read('/Device/StreamTransmit')
          read: async () => ({ Streams: [{ RtspSessionName: 'X' }] }),
          snapshot: async () => {},
          restore: async () => ({ skipped: false }),
          setRxScenario: async () => {},
        } as never,
        ui: {
          open: async () => ({}),
          close: async () => {},
          moduleAvailable: async () => true,
          openConnectionConfig: async () => {},
          fillConfig: async () => {},
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'AMBIGUOUS')
})

test('CFG-GOOD — good mais oracle échoue → FAIL (Q2: oracle-unreachable reste FAIL)', async () => {
  // http.status → good, oracle.read throws → FAIL (not AMBIGUOUS, per Q2)
  const step = labSteps.find((s) => s.id === 'CFG-GOOD')!
  const v = await step.run(
    ctx(
      {
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'good', level: 'OK', message: '' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => '',
          press: async () => {},
        } as never,
        oracle: {
          // post-migration : CFG-GOOD appelle oracle.read('/Device/StreamTransmit')
          read: async () => { throw new Error('oracle unreachable') },
          setRxScenario: async () => {},
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'FAIL')
})

test('CFG-WRONGPASS — sans device (noDevice) → SKIP (garde préservée)', async () => {
  // ctx.config.nvxPass = '' → noDevice guard must fire → SKIP
  const step = labSteps.find((s) => s.id === 'CFG-WRONGPASS')!
  const v = await step.run(ctx({}, ''))
  assert.equal(v.status, 'SKIP')
})

// ── Decoder steps ─────────────────────────────────────────────────────────────

test('lab steps include the decoder USE ids', () => {
  const ids = labSteps.map((s) => s.id)
  for (const id of ['DEC-CAP', 'BASELINE-RX', 'DEC-VARS', 'DEC-SOURCE-URL', 'DEC-SOURCE-MCAST', 'DEC-CONNECT', 'DEC-ENABLE', 'DEC-DISABLE', 'TEARDOWN-RX'])
    assert.ok(ids.includes(id), `missing ${id}`)
})

test('decoder steps come after encoder USE block and before TEARDOWN', () => {
  const ids = labSteps.map((s) => s.id)
  assert.ok(ids.indexOf('ENC-DISABLE') < ids.indexOf('DEC-CAP'), 'DEC-CAP after ENC-DISABLE')
  assert.ok(ids.indexOf('TEARDOWN-RX') < ids.indexOf('TEARDOWN'), 'TEARDOWN-RX before TEARDOWN')
})

test('DEC-CAP SKIPs (not FAILs) when device is a Transmitter', async () => {
  const step = labSteps.find((s) => s.id === 'DEC-CAP')!
  const v = await step.run(
    ctx(
      {
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'ok' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => 'Transmitter',
          press: async () => {},
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'SKIP')
})

test('DEC-CAP PASSes when device_role is Receiver', async () => {
  const step = labSteps.find((s) => s.id === 'DEC-CAP')!
  const v = await step.run(
    ctx(
      {
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'ok' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => 'Receiver',
          press: async () => {},
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'PASS')
})

test('a DEC WRITE step SKIPs when its button is not mapped (device present, Receiver, no layout)', async () => {
  const step = labSteps.find((s) => s.id === 'DEC-SOURCE-URL')!
  const v = await step.run(ctxWithRole('Receiver')) // config.layout undefined
  assert.equal(v.status, 'SKIP')
  assert.match(String(v.evidence.note), /layout|SETUP/i)
})

test('TEARDOWN-RX PASSes with a device', async () => {
  const step = labSteps.find((s) => s.id === 'TEARDOWN-RX')!
  assert.equal((await step.run(ctx({}, 'realpass'))).status, 'PASS')
})

test('TEARDOWN-RX FAILs when oracle.restore throws', async () => {
  const step = labSteps.find((s) => s.id === 'TEARDOWN-RX')!
  const v = await step.run(
    ctx(
      {
        oracle: {
          // post-migration : TEARDOWN-RX appelle oracle.restore(endpoint, buildBodies)
          restore: async () => { throw new Error('decoder unreachable') },
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'FAIL')
  assert.match(String(v.evidence.note), /decoder restore failed/i)
})

// ── CFG-WRONGPASS / CFG-GOOD propagate nvxUser ────────────────────────────────

test('CFG-WRONGPASS passes ctx.config.nvxUser (not "admin") to fillConfig', async () => {
  const step = labSteps.find((s) => s.id === 'CFG-WRONGPASS')!
  const captured: { username?: string }[] = []
  const v = await step.run(
    ctx(
      {
        config: {
          companionUrl: 'http://x:8000',
          container: 'c',
          label: 'nvx-uat',
          nvxHost: '192.0.2.1',
          nvxPort: 443,
          nvxUser: 'didier',
          nvxPass: 'realpass',
        },
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'warning', level: 'Warning', message: '' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => '',
          press: async () => {},
        } as never,
        logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
        ui: {
          open: async () => ({}),
          close: async () => {},
          moduleAvailable: async () => true,
          openConnectionConfig: async () => {},
          fillConfig: async (_page: unknown, fields: { username?: string }) => {
            captured.push(fields)
          },
        } as never,
      },
      'realpass',
    ),
  )
  assert.ok(captured.length > 0, 'fillConfig was not called')
  assert.equal(captured[0].username, 'didier', `expected 'didier', received '${captured[0].username}'`)
  assert.equal(v.status, 'PASS')
})

test('CFG-GOOD passes ctx.config.nvxUser (not "admin") to fillConfig', async () => {
  const step = labSteps.find((s) => s.id === 'CFG-GOOD')!
  const captured: { username?: string }[] = []
  await step.run(
    ctx(
      {
        config: {
          companionUrl: 'http://x:8000',
          container: 'c',
          label: 'nvx-uat',
          nvxHost: '192.0.2.1',
          nvxPort: 443,
          nvxUser: 'didier',
          nvxPass: 'realpass',
        },
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'good', level: 'OK', message: '' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => '',
          press: async () => {},
        } as never,
        logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
        oracle: {
          // post-migration : CFG-GOOD appelle oracle.read('/Device/StreamTransmit')
          read: async () => ({ Streams: [{ RtspSessionName: 'X' }] }),
        } as never,
        ui: {
          open: async () => ({}),
          close: async () => {},
          moduleAvailable: async () => true,
          openConnectionConfig: async () => {},
          fillConfig: async (_page: unknown, fields: { username?: string }) => {
            captured.push(fields)
          },
        } as never,
      },
      'realpass',
    ),
  )
  assert.ok(captured.length > 0, 'fillConfig was not called')
  assert.equal(captured[0].username, 'didier', `expected 'didier', received '${captured[0].username}'`)
})

// ── Role guards in writeStep / writeStepRx (bug #3) ──────────────────────────

/** ctx with device present and getVariable always returning `role` */
function ctxWithRole(role: string): JourneyContext {
  return ctx(
    {
      http: {
        findConnectionId: async () => 'abc',
        status: async () => ({ category: 'ok' }),
        enable: async () => {},
        disable: async () => {},
        restart: async () => {},
        getVariable: async () => role,
        press: async () => {},
      } as never,
    },
    'realpass',
  )
}

test('ENC-NAME (writeStep) SKIPs — not FAILs — when device_role is Receiver', async () => {
  const step = labSteps.find((s) => s.id === 'ENC-NAME')!
  // Provide a layout so the button IS mapped — role check must fire before pressMapped.
  const c = ctxWithRole('Receiver')
  c.config.layout = { set_stream_name: { page: 1, row: 0, col: 0 } }
  const v = await step.run(c)
  assert.equal(v.status, 'SKIP', 'ENC-NAME must SKIP on a Receiver, not FAIL')
})

test('DEC-SOURCE-URL (writeStepRx) SKIPs — not FAILs — when device_role is Transmitter', async () => {
  const step = labSteps.find((s) => s.id === 'DEC-SOURCE-URL')!
  // Provide a layout so the button IS mapped — role check must fire before pressMapped.
  const c = ctxWithRole('Transmitter')
  c.config.layout = { set_source_url: { page: 1, row: 0, col: 0 } }
  const v = await step.run(c)
  assert.equal(v.status, 'SKIP', 'DEC-SOURCE-URL must SKIP on a Transmitter, not FAIL')
})

// ── Task 6: scenario steps fake-only SKIP / role guards / honest teardown ────

/** ctx for a real device (isFake=false), Receiver role, with layout mapped */
function ctxRealReceiver(): JourneyContext {
  const c = ctx(
    {
      config: {
        companionUrl: 'http://x:8000',
        container: 'c',
        label: 'nvx-uat',
        nvxHost: '192.0.2.1',
        nvxPort: 443,
        nvxUser: 'admin',
        nvxPass: 'realpass',
        isFake: false,
      },
      http: {
        findConnectionId: async () => 'abc',
        status: async () => ({ category: 'ok' }),
        enable: async () => {},
        disable: async () => {},
        restart: async () => {},
        getVariable: async () => 'Receiver',
        press: async () => {},
      } as never,
    },
    'realpass',
  )
  c.config.layout = { dec_enable_stream: { page: 1, row: 0, col: 0 } }
  return c
}

test('DEC-NEGOTIATING SKIPs (not FAILs) when isFake is false (real device)', async () => {
  const step = labSteps.find((s) => s.id === 'DEC-NEGOTIATING')!
  const v = await step.run(ctxRealReceiver())
  assert.equal(v.status, 'SKIP', 'DEC-NEGOTIATING must SKIP on a real device (scenario route absent)')
  assert.match(String(v.evidence.note), /fake|scenario/i)
})

test('DEC-DECODING SKIPs (not FAILs) when isFake is false (real device)', async () => {
  const step = labSteps.find((s) => s.id === 'DEC-DECODING')!
  const v = await step.run(ctxRealReceiver())
  assert.equal(v.status, 'SKIP', 'DEC-DECODING must SKIP on a real device (scenario route absent)')
  assert.match(String(v.evidence.note), /fake|scenario/i)
})

test('DEC-NEGOTIATING SKIPs (not FAILs) when device_role is Transmitter', async () => {
  const step = labSteps.find((s) => s.id === 'DEC-NEGOTIATING')!
  // isFake=true so we isolate role guard from fake guard
  const c = ctx(
    {
      config: {
        companionUrl: 'http://x:8000',
        container: 'c',
        label: 'nvx-uat',
        nvxHost: '192.0.2.1',
        nvxPort: 8443,
        nvxUser: 'admin',
        nvxPass: 'realpass',
        isFake: true,
      },
      http: {
        findConnectionId: async () => 'abc',
        status: async () => ({ category: 'ok' }),
        enable: async () => {},
        disable: async () => {},
        restart: async () => {},
        getVariable: async () => 'Transmitter',
        press: async () => {},
      } as never,
    },
    'realpass',
  )
  c.config.layout = { dec_enable_stream: { page: 1, row: 0, col: 0 } }
  const v = await step.run(c)
  assert.equal(v.status, 'SKIP', 'DEC-NEGOTIATING must SKIP when device is a Transmitter')
})

test('BASELINE SKIPs (not FAILs) when device_role is Receiver', async () => {
  const step = labSteps.find((s) => s.id === 'BASELINE')!
  const v = await step.run(ctxWithRole('Receiver'))
  assert.equal(v.status, 'SKIP', 'BASELINE must SKIP on a Receiver (reads StreamTransmit)')
})

test('TEARDOWN-RX reports "no baselineRx" honestly when oracle.restore() signals no baseline was captured', async () => {
  const teardownRx = labSteps.find((s) => s.id === 'TEARDOWN-RX')!
  // oracle.restore() signals no baseline by returning { skipped: true } instead of throwing.
  const v = await teardownRx.run(
    ctx(
      {
        oracle: {
          // post-migration : TEARDOWN-RX appelle oracle.restore(endpoint, buildBodies)
          restore: async () => ({ skipped: true }),
        } as never,
      },
      'realpass',
    ),
  )
  // Must NOT claim "device restored" when nothing was restored.
  assert.equal(v.status, 'PASS', 'TEARDOWN-RX should still PASS (best-effort)')
  assert.ok(
    !String(v.evidence.note).toLowerCase().includes('baseline re-applied'),
    `TEARDOWN-RX claimed "baseline re-applied" but no baselineRx was captured. note="${v.evidence.note}"`,
  )
  assert.match(String(v.evidence.note), /no baselin/i, 'TEARDOWN-RX note doit signaler l\'absence de baseline')
})

test('TEARDOWN reports "no baseline" honestly when restore() signals no baseline was captured', async () => {
  const teardown = labSteps.find((s) => s.id === 'TEARDOWN')!
  // Oracle.restore() signals no baseline by returning { skipped: true } instead of throwing.
  const v = await teardown.run(
    ctx(
      {
        oracle: {
          // post-migration : TEARDOWN appelle oracle.restore(endpoint, buildBodies)
          restore: async () => ({ skipped: true }),
        } as never,
      },
      'realpass',
    ),
  )
  // Must NOT claim "device restored" when nothing was restored.
  assert.equal(v.status, 'PASS', 'TEARDOWN should still PASS (best-effort)')
  assert.ok(
    !String(v.evidence.note).toLowerCase().includes('device restored'),
    `TEARDOWN claimed "device restored" but no baseline was captured. note="${v.evidence.note}"`,
  )
})

// ── Task 7: decoder actionKeys must be present in the default layout fixture ──

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadLayout(): Record<string, unknown> {
  const fixturePath = path.join(__dirname, '../fixtures/layout.json')
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>
}

const DECODER_ACTION_KEYS = [
  'set_source_url',
  'set_source_multicast',
  'connect_to_stream',
  'dec_enable_stream',
  'dec_disable_stream',
] as const

test('default layout fixture maps every decoder actionKey (no SKIP-silent on Receiver)', () => {
  const layout = loadLayout()
  for (const key of DECODER_ACTION_KEYS) {
    const loc = layout[key]
    assert.ok(loc !== undefined, `layout.json is missing decoder key '${key}' → DEC steps SKIP silently (button not found)`)
  }
})

// ── Task 8: readVar — erreur réseau (non-404) ne doit pas être avalée silencieusement ──

test('readVar: erreur réseau (HTTP 500) propagée — step FAIL avec threw, pas SKIP silencieux', async () => {
  // getVariable lance HttpError 500 (erreur réseau / serveur) sur toutes les tentatives.
  // readVar NE doit PAS capter cela silencieusement et retourner ''.
  // Seul HTTP 404 (variable non encore enregistrée) est toléré — pas 500.
  // Le step CAP reçoit l'erreur et runJourney la convertit en FAIL.
  // Pour tester sans runJourney, on vérifie que step.run() rejette.
  const step = labSteps.find((s) => s.id === 'CAP')!
  const networkError = new HttpError('getVariable nvx-uat.device_role → HTTP 500', 500)
  const c = ctx(
    {
      http: {
        findConnectionId: async () => 'abc',
        status: async () => ({ category: 'ok' }),
        enable: async () => {},
        disable: async () => {},
        restart: async () => {},
        getVariable: async () => { throw networkError },
        press: async () => {},
      } as never,
    },
    'realpass',
  )
  // Le step doit propager l'erreur (rejet de la promesse) — pas retourner SKIP/PASS.
  await assert.rejects(
    () => step.run(c),
    (err: unknown) => {
      assert.ok(err instanceof Error, `attendu Error, reçu ${typeof err}`)
      assert.ok(
        err.message.includes('500') || err.message.includes('HTTP'),
        `message doit mentionner HTTP/500, reçu : "${err.message}"`,
      )
      return true
    },
  )
})

test('readVar: 404 (variable pas encore définie) toujours toléré — step SKIP nominal', async () => {
  // getVariable lance HttpError 404 (variable pas encore définie) — comportement transitoire normal.
  // readVar DOIT capter ce cas (HttpError typé avec status===404) et continuer le polling.
  // Après toutes les tentatives, retourne '' → step CAP → role '' → SKIP (pas Transmitter).
  const step = labSteps.find((s) => s.id === 'CAP')!
  const notFound = new HttpError('getVariable nvx-uat.device_role → HTTP 404', 404)
  let callCount = 0
  const c = ctx(
    {
      http: {
        findConnectionId: async () => 'abc',
        status: async () => ({ category: 'ok' }),
        enable: async () => {},
        disable: async () => {},
        restart: async () => {},
        getVariable: async () => { callCount++; throw notFound },
        press: async () => {},
      } as never,
      sleep: async () => {}, // pas de vrai délai
    },
    'realpass',
  )
  // Doit terminer sans rejet (le 404 est toléré) et retourner SKIP (rôle jamais = Transmitter).
  const v = await step.run(c)
  assert.equal(v.status, 'SKIP', 'CAP doit SKIP si la variable reste indisponible après tous les polls')
  assert.ok(callCount > 1, `polling attendu (plusieurs appels), reçu ${callCount}`)
})

test('default layout fixture decoder buttons have no coordinate collision with encoder buttons', () => {
  const layout = loadLayout()
  const seen = new Map<string, string>()
  for (const [key, loc] of Object.entries(layout)) {
    if (key.startsWith('_')) continue
    const { page, row, col } = loc as { page: number; row: number; col: number }
    const coord = `${page}:${row}:${col}`
    const prior = seen.get(coord)
    assert.ok(!prior, `Coordinate collision at ${coord} between '${prior}' and '${key}'`)
    seen.set(coord, key)
  }
})

// ── Task 9: verrou bout-en-bout — le username configuré ne descend jamais à 'admin' ──
//
// Ce test est un verrou de non-régression pour la classe entière des steps de configuration.
// Il exécute TOUS les steps (lab + local) qui appellent fillConfig avec nvxUser='didier'
// et asserte qu'AUCUN username transmis n'est 'admin'.
//
// Valeur de détection : si quelqu'un réintroduit `username: 'admin'` en dur dans un step
// existant ou futur, ce test casse — même si les tests individuels par step n'existent pas encore.

import { localSteps } from './steps-local.js'

test('verrou bout-en-bout: aucun step ne transmet username=admin quand nvxUser=didier', async () => {
  // Accumulateur partagé : toutes les fillConfig appelées pendant ce test
  const allCaptured: Array<{ stepId: string; username: string | undefined }> = []

  // Spy fillConfig commun : capture (stepId, username) à chaque appel.
  // Le stepId courant est injecté via closure lors de chaque exécution.
  let currentStepId = '?'
  const spyFillConfig = async (_page: unknown, fields: { username?: string }): Promise<void> => {
    allCaptured.push({ stepId: currentStepId, username: fields.username })
  }

  // Config de base avec nvxUser='didier' (jamais 'admin').
  const didierConfig = {
    companionUrl: 'http://x:8000',
    container: 'c',
    label: 'nvx-uat',
    nvxHost: '192.0.2.1',
    nvxPort: 443,
    nvxUser: 'didier',
    nvxPass: 'realpass',
  }

  // Factory de contexte : même spy fillConfig injecté, http/logs/oracle minimaux pour que
  // les steps "passent" sans device réel (on veut juste capturer fillConfig, pas la valeur retour).
  const makeCtx = (): JourneyContext => ({
    config: { ...didierConfig },
    http: {
      findConnectionId: async () => 'abc',
      status: async () => ({ category: 'good', level: 'OK', message: '' }),
      enable: async () => {},
      disable: async () => {},
      restart: async () => {},
      getVariable: async () => '',
      press: async () => {},
    } as never,
    logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
    oracle: {
      // Méthodes génériques (post-migration vague 2c — stub entièrement générique)
      read: async () => ({ Streams: [{ RtspSessionName: 'X' }] }),
      snapshot: async () => {},
      restore: async () => ({ skipped: false }),
      setRxScenario: async () => {},
    } as never,
    ui: {
      open: async () => ({}),
      close: async () => {},
      moduleAvailable: async () => true,
      openConnectionConfig: async () => {},
      fillConfig: spyFillConfig,
    } as never,
    sleep: async () => {},
  })

  // Exécuter tous les steps lab + local. On capture fillConfig pour chacun.
  // On tolère les rejets (step SKIP, FAIL…) — on veut seulement intercepter les appels fillConfig.
  const allSteps = [...labSteps, ...localSteps]
  for (const step of allSteps) {
    currentStepId = step.id
    try {
      await step.run(makeCtx())
    } catch {
      // Rejet toléré : ce test ne porte que sur le username transmis, pas sur le verdict.
    }
  }

  // Le verrou : chaque appel fillConfig qui transmet un username doit utiliser 'didier'.
  // Si aucun step n'a appelé fillConfig, le verrou devient aveugle — on l'exige explicitement.
  assert.ok(
    allCaptured.length > 0,
    'Aucun step n\'a appelé fillConfig — le verrou est aveugle. Ajouter les steps de config ou revoir la logique.',
  )

  const adminCalls = allCaptured.filter((c) => c.username === 'admin')
  assert.equal(
    adminCalls.length,
    0,
    `${adminCalls.length} step(s) ont transmis username='admin' au lieu de 'didier' : ` +
    adminCalls.map((c) => `${c.stepId}(username=${c.username})`).join(', '),
  )

  // Vérification positive : au moins un step a transmis le bon username ('didier').
  const didierCalls = allCaptured.filter((c) => c.username === 'didier')
  assert.ok(
    didierCalls.length > 0,
    `Aucun step n'a transmis username='didier'. Steps capturés : ` +
    allCaptured.map((c) => `${c.stepId}(username=${c.username ?? 'undefined'})`).join(', '),
  )
})
