/**
 * subsystem.test.ts — Red phase (vague 2a) — runner générique SubsystemSpec
 *
 * Tous ces tests sont Red jusqu'à l'implémentation du stub par le coder.
 * Chaque test verrouille un comportement précis extrait de steps-lab.ts
 * (factories writeStep / writeStepRx / writeStepRxWithScenario, pollers, gardes).
 *
 * ── Comportements verrouillés ───────────────────────────────────────────────
 *
 * buildWriteStep(spec, writeCase) — garde ordonnée :
 *   1. requireDevice    → SKIP si nvxPass absent
 *   2. scenario+!isFake → SKIP si fake-only sur vrai device (AVANT rôle — critique)
 *   3. requireRole      → SKIP si device_role ≠ spec.role (note: device_role=…)
 *   4. bouton non mappé → SKIP
 *   5. si scenario      → setRxScenario() AVANT press() (ordre testé)
 *   6. press → pollExtract → PASS/FAIL
 *
 * pollExtract(ctx, spec, pred) :
 *   - oracle.read(spec.endpoint) → spec.extract(subsystem) → pred(extracted)
 *   - Retente jusqu'à pred satisfait, borné (POLL_ATTEMPTS)
 *
 * buildCapStep  : garde rôle (PASS si device_role = spec.role, SKIP sinon)
 *
 * buildVarsStep — 3 points critiques :
 *   (a) ready sur la 1ʳᵉ VarCheck seulement (polling gate)
 *   (b) str() coercion sur device(extracted) — non-string → ''
 *   (c) observed = { var: { companion, device } }, note = "N/N match"
 *
 * buildBaselineStep : oracle.snapshot(spec.endpoint), role-guardé
 * buildTeardownStep : oracle.restore(spec.endpoint, spec.buildBodies) + disable conditionnel
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWriteStep, buildCapStep, buildVarsStep, buildBaselineStep, buildTeardownStep } from './subsystem.js'
import type { SubsystemSpec, WriteCase } from './subsystem.js'
import type { JourneyContext } from './types.js'

// ── str() coercion (même logique que steps-lab.ts) ───────────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

// ── Types locaux ──────────────────────────────────────────────────────────────
type Json = Record<string, unknown>
type BuildBodiesFn = (subsystem: Json) => unknown[]

// ══════════════════════════════════════════════════════════════════════════════
// Spec fixtures minimaux
// ══════════════════════════════════════════════════════════════════════════════

/** Spec Transmitter minimal — endpoint StreamTransmit, extract = Streams[0] */
const txSpec: SubsystemSpec = {
  id: 'TX',
  role: 'Transmitter',
  endpoint: '/Device/StreamTransmit',
  extract: (sub) => (sub.Streams as Json[])?.[0] ?? {},
  buildBodies: (baseline) => {
    const b = (baseline.Streams as Json[])?.[0] ?? {}
    if (typeof b.Name === 'string')
      return [{ Device: { StreamTransmit: { Streams: [{ RtspSessionName: b.Name }] } } }]
    return []
  },
  writes: [],
  vars: [],
}

/** Spec Receiver minimal — endpoint StreamReceive, extract = Streams[0] */
const rxSpec: SubsystemSpec = {
  id: 'RX',
  role: 'Receiver',
  endpoint: '/Device/StreamReceive',
  extract: (sub) => (sub.Streams as Json[])?.[0] ?? {},
  buildBodies: () => [],
  writes: [],
  vars: [],
}

/** Spec Transmitter avec 2 VarChecks — 1ʳᵉ avec ready, 2ᵉ sans */
const txVarSpec: SubsystemSpec = {
  ...txSpec,
  vars: [
    { var: 'tx_stream_name', device: (e) => str(e.Name), ready: (v) => v !== '' },
    { var: 'tx_multicast', device: (e) => str(e.Addr) },  // pas de ready
  ],
}

/** Spec Tx avec un VarCheck dont device() retourne un number (test str()) */
const txNumericVarSpec: SubsystemSpec = {
  ...txSpec,
  extract: (sub) => (sub.Streams as Json[])?.[0] ?? {},
  vars: [
    { var: 'tx_volume', device: (e) => (e.Volume as unknown as string) },  // Volume=number → str()=''
  ],
}

/** WriteCase Tx basique (sans scénario) */
const txWc: WriteCase = {
  id: 'ENC-TEST',
  title: 'test write Tx',
  actionKey: 'enc_test_action',
  pred: (e) => e.Status === 'ok',
  expected: { Status: 'ok' },
}

/** WriteCase Rx basique (sans scénario) */
const rxWc: WriteCase = {
  id: 'DEC-TEST',
  title: 'test write Rx',
  actionKey: 'dec_test_action',
  pred: (e) => e.Status === 'ok',
  expected: { Status: 'ok' },
}

/** WriteCase Rx avec scénario */
const rxWcScenario: WriteCase = {
  id: 'DEC-SCENARIO',
  title: 'test write Rx avec scénario',
  actionKey: 'dec_test_action',
  scenario: 'negotiating',
  pred: (e) => e.CodecReady === false,
  expected: { CodecReady: false },
}

/** Layout avec les boutons des deux actionKeys de test */
const WITH_LAYOUT = {
  enc_test_action: { page: 1, row: 0, col: 0 },
  dec_test_action: { page: 1, row: 1, col: 0 },
}

// ══════════════════════════════════════════════════════════════════════════════
// Factory de contexte — stubs minimalistes calqués sur steps-lab.test.ts
// ══════════════════════════════════════════════════════════════════════════════

interface CtxOpts {
  nvxPass?: string
  isFake?: boolean
  layout?: Record<string, { page: number; row: number; col: number }>
  role?: string
  oracleRead?: (endpoint: string) => Promise<Json>
  oracleSnapshot?: (endpoint: string) => Promise<void>
  oracleRestore?: (endpoint: string, fn: BuildBodiesFn) => Promise<{ skipped: boolean }>
  oracleSetRxScenario?: (scenario: string) => Promise<void>
  getVariable?: (label: string, name: string) => Promise<string>
  press?: (page: number, row: number, col: number) => Promise<void>
  disable?: (connId: string) => Promise<void>
  findConnectionId?: () => Promise<string>
  sleep?: (ms: number) => Promise<void>
}

function makeCtx(opts: CtxOpts = {}): JourneyContext {
  return {
    config: {
      companionUrl: 'http://x:8000',
      container: 'c',
      label: 'nvx-uat',
      nvxHost: '192.0.2.1',
      nvxPort: 443,
      nvxUser: 'admin',
      nvxPass: opts.nvxPass ?? 'realpass',
      isFake: opts.isFake,
      layout: opts.layout,
    },
    http: {
      findConnectionId: opts.findConnectionId ?? (async () => 'conn-abc'),
      status: async () => ({ category: 'good', level: 'OK', message: '' }),
      enable: async () => {},
      disable: opts.disable ?? (async () => {}),
      restart: async () => {},
      getVariable: opts.getVariable ?? (async (_label: string, name: string) => {
        if (name === 'device_role') return opts.role ?? 'Transmitter'
        return ''
      }),
      press: opts.press ?? (async () => {}),
    } as never,
    logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
    oracle: {
      read: opts.oracleRead ?? (async () => ({ Streams: [{ Status: 'ok' }] })),
      snapshot: opts.oracleSnapshot ?? (async () => {}),
      restore: opts.oracleRestore ?? (async () => ({ skipped: false })),
      setRxScenario: opts.oracleSetRxScenario ?? (async () => {}),
    } as never,
    ui: {
      open: async () => ({}),
      close: async () => {},
      moduleAvailable: async () => true,
      openConnectionConfig: async () => {},
      fillConfig: async () => {},
    } as never,
    sleep: opts.sleep ?? (async () => {}),
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 1 — buildWriteStep : gardes Transmitter (sans scénario)
// ══════════════════════════════════════════════════════════════════════════════

test('buildWriteStep Tx — requireDevice → SKIP quand nvxPass absent', async () => {
  const step = buildWriteStep(txSpec, txWc)
  const v = await step.run(makeCtx({ nvxPass: '' }))
  assert.equal(v.status, 'SKIP')
  assert.match(String(v.evidence.note), /NVX_PASS|no device/i)
})

test('buildWriteStep Tx — requireRole → SKIP quand device_role=Receiver (note: device_role=Receiver)', async () => {
  const step = buildWriteStep(txSpec, txWc)
  const v = await step.run(makeCtx({ role: 'Receiver', layout: WITH_LAYOUT }))
  assert.equal(v.status, 'SKIP', 'ENC step doit SKIP sur un Receiver, même avec layout mappé')
  assert.match(String(v.evidence.note), /device_role=Receiver/)
})

test('buildWriteStep Tx — role check AVANT button check (role=Receiver + layout mappé → SKIP role, pas SKIP button)', async () => {
  // Si le role check passait après le button check, le message serait "button unmapped"
  // sur un ctx sans layout → mais ici layout est mappé. On vérifie que la note mentionne le rôle.
  const step = buildWriteStep(txSpec, txWc)
  const c = makeCtx({ role: 'Receiver', layout: WITH_LAYOUT })
  const v = await step.run(c)
  assert.equal(v.status, 'SKIP')
  assert.match(String(v.evidence.note), /device_role/)
  assert.doesNotMatch(String(v.evidence.note), /layout|SETUP/i)
})

test('buildWriteStep Tx — bouton non mappé → SKIP (note: layout/SETUP)', async () => {
  const step = buildWriteStep(txSpec, txWc)
  // Pas de layout → button unmapped
  const v = await step.run(makeCtx({ role: 'Transmitter' }))
  assert.equal(v.status, 'SKIP')
  assert.match(String(v.evidence.note), /layout|SETUP/i)
})

test('buildWriteStep Tx — tous les gardes passent + pred=true → PASS', async () => {
  const step = buildWriteStep(txSpec, { ...txWc, pred: (e) => e.Status === 'ok' })
  const v = await step.run(makeCtx({
    role: 'Transmitter',
    layout: WITH_LAYOUT,
    oracleRead: async () => ({ Streams: [{ Status: 'ok' }] }),
  }))
  assert.equal(v.status, 'PASS')
})

test('buildWriteStep Tx — pred=false après POLL_ATTEMPTS → FAIL avec observed=last snapshot', async () => {
  const step = buildWriteStep(txSpec, { ...txWc, pred: () => false })
  const v = await step.run(makeCtx({
    role: 'Transmitter',
    layout: WITH_LAYOUT,
    oracleRead: async () => ({ Streams: [{ Status: 'wrong' }] }),
    sleep: async () => {},
  }))
  assert.equal(v.status, 'FAIL')
  // Le snapshot observé doit être présent dans l'évidence
  const obs = v.evidence.observed ?? v.evidence.deviceJson
  assert.ok(obs !== undefined, 'FAIL doit contenir le dernier snapshot dans evidence')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 2 — buildWriteStep : gardes Receiver sans scénario
// ══════════════════════════════════════════════════════════════════════════════

test('buildWriteStep Rx — requireRole → SKIP quand device_role=Transmitter', async () => {
  const step = buildWriteStep(rxSpec, rxWc)
  const v = await step.run(makeCtx({ role: 'Transmitter', layout: WITH_LAYOUT }))
  assert.equal(v.status, 'SKIP', 'DEC step doit SKIP sur un Transmitter')
  assert.match(String(v.evidence.note), /device_role=Transmitter/)
})

test('buildWriteStep Rx — bouton non mappé → SKIP', async () => {
  const step = buildWriteStep(rxSpec, rxWc)
  const v = await step.run(makeCtx({ role: 'Receiver' }))
  assert.equal(v.status, 'SKIP')
  assert.match(String(v.evidence.note), /layout|SETUP/i)
})

test('buildWriteStep Rx — tous les gardes passent + pred=true → PASS', async () => {
  const step = buildWriteStep(rxSpec, { ...rxWc, pred: (e) => e.Status === 'ok' })
  const v = await step.run(makeCtx({
    role: 'Receiver',
    layout: WITH_LAYOUT,
    oracleRead: async () => ({ Streams: [{ Status: 'ok' }] }),
  }))
  assert.equal(v.status, 'PASS')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 3 — buildWriteStep : ordre des gardes avec scénario (CRITIQUE)
// ══════════════════════════════════════════════════════════════════════════════

test('buildWriteStep scénario + !isFake → SKIP fake-only (AVANT role check — garde 2 < garde 3)', async () => {
  // Preuve de l'ordre : isFake=false, rôle=Receiver (correct), layout mappé.
  // La garde "fake-only" (2) doit s'activer AVANT la garde de rôle (3).
  // Si l'ordre était inversé, le rôle passerait et la garde isFake ne serait jamais testée ici.
  const step = buildWriteStep(rxSpec, rxWcScenario)
  const v = await step.run(makeCtx({
    isFake: false,
    role: 'Receiver',   // rôle correct — si la garde 2 est absente, le step passerait à la garde 3
    layout: WITH_LAYOUT,
  }))
  assert.equal(v.status, 'SKIP')
  assert.match(String(v.evidence.note), /fake|scenario/i)
  // NE doit PAS mentionner "device_role" (la garde de rôle n'a pas dû s'activer)
  assert.doesNotMatch(String(v.evidence.note), /device_role/)
})

test('buildWriteStep scénario + isFake + mauvais rôle → SKIP rôle (garde 3, après garde 2)', async () => {
  // isFake=true → garde 2 passe ; role=Transmitter → garde 3 active.
  // Preuve que garde 2 (isFake) est vérifiée AVANT garde 3 (rôle) : isFake=true ici.
  const step = buildWriteStep(rxSpec, rxWcScenario)
  const v = await step.run(makeCtx({
    isFake: true,
    role: 'Transmitter',  // mauvais rôle
    layout: WITH_LAYOUT,
  }))
  assert.equal(v.status, 'SKIP')
  assert.match(String(v.evidence.note), /device_role=Transmitter/)
})

test('buildWriteStep scénario + isFake + bon rôle + bouton non mappé → SKIP button (garde 4)', async () => {
  const step = buildWriteStep(rxSpec, rxWcScenario)
  const v = await step.run(makeCtx({
    isFake: true,
    role: 'Receiver',
    // pas de layout → button unmapped
  }))
  assert.equal(v.status, 'SKIP')
  assert.match(String(v.evidence.note), /layout|SETUP/i)
})

test('buildWriteStep scénario + isFake + tous les gardes passent → PASS', async () => {
  const step = buildWriteStep(rxSpec, {
    ...rxWcScenario,
    pred: (e) => e.CodecReady === false,
  })
  const v = await step.run(makeCtx({
    isFake: true,
    role: 'Receiver',
    layout: WITH_LAYOUT,
    oracleRead: async () => ({ Streams: [{ CodecReady: false }] }),
  }))
  assert.equal(v.status, 'PASS')
})

test('buildWriteStep scénario : setRxScenario() appelé AVANT press() — ordre verrouillé', async () => {
  // L'ORDRE est le comportement critique : fake applique le scénario sur la prochaine commande Start.
  // Si press() arrive avant setRxScenario(), le fake applique le mauvais état.
  const callLog: string[] = []
  const step = buildWriteStep(rxSpec, {
    ...rxWcScenario,
    pred: (e) => e.CodecReady === false,
  })
  await step.run(makeCtx({
    isFake: true,
    role: 'Receiver',
    layout: WITH_LAYOUT,
    oracleRead: async () => ({ Streams: [{ CodecReady: false }] }),
    oracleSetRxScenario: async () => { callLog.push('scenario') },
    press: async () => { callLog.push('press') },
  }))
  assert.ok(callLog.includes('scenario'), 'setRxScenario() doit être appelé')
  assert.ok(callLog.includes('press'), 'press() doit être appelé')
  assert.ok(
    callLog.indexOf('scenario') < callLog.indexOf('press'),
    `setRxScenario() doit être appelé AVANT press() — ordre reçu : [${callLog.join(', ')}]`,
  )
})

test('buildWriteStep scénario + isFake + pred=false → FAIL', async () => {
  const step = buildWriteStep(rxSpec, { ...rxWcScenario, pred: () => false })
  const v = await step.run(makeCtx({
    isFake: true,
    role: 'Receiver',
    layout: WITH_LAYOUT,
    oracleRead: async () => ({ Streams: [{ CodecReady: true }] }),
    sleep: async () => {},
  }))
  assert.equal(v.status, 'FAIL')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 4 — pollExtract (via buildWriteStep)
// ══════════════════════════════════════════════════════════════════════════════

test('pollExtract — oracle.read retourne le subsystem brut → spec.extract drill dans Streams[0]', async () => {
  // Preuve que le runner appelle oracle.read(endpoint) puis spec.extract(subsystem)
  // et NOT oracle.readStream0() directement — découplage du wrapper legacy.
  let readEndpointCalled: string | undefined
  const step = buildWriteStep(
    {
      ...txSpec,
      extract: (sub) => {
        // Si le runner passe Device[lastSegment] brut : sub = { Streams: [{…}] }
        // Si le runner avait appelé readStream0() : sub serait déjà { Name:'X' }
        return (sub.Streams as Json[])?.[0] ?? {}
      },
    },
    { ...txWc, pred: (e) => e.Name === 'X' },
  )
  await step.run(makeCtx({
    role: 'Transmitter',
    layout: WITH_LAYOUT,
    oracleRead: async (endpoint) => {
      readEndpointCalled = endpoint
      return { Streams: [{ Name: 'X' }] }  // subsystem brut, pas Streams[0] directement
    },
  }))
  assert.equal(readEndpointCalled, '/Device/StreamTransmit', 'oracle.read doit être appelé avec spec.endpoint')
})

test('pollExtract — retente jusqu\'à pred satisfait (pred false → true sur 2ᵉ poll)', async () => {
  let readCount = 0
  const step = buildWriteStep(txSpec, {
    ...txWc,
    pred: (e) => e.Name === 'OK',
  })
  const v = await step.run(makeCtx({
    role: 'Transmitter',
    layout: WITH_LAYOUT,
    oracleRead: async () => {
      readCount++
      return { Streams: [{ Name: readCount >= 2 ? 'OK' : 'WRONG' }] }
    },
    sleep: async () => {},
  }))
  assert.equal(v.status, 'PASS')
  assert.ok(readCount >= 2, `pollExtract doit retenter — readCount=${readCount}`)
})

test('pollExtract — borné quand pred toujours false → FAIL, pas boucle infinie', async () => {
  let readCount = 0
  const step = buildWriteStep(txSpec, { ...txWc, pred: () => false })
  const v = await step.run(makeCtx({
    role: 'Transmitter',
    layout: WITH_LAYOUT,
    oracleRead: async () => { readCount++; return { Streams: [{ Status: 'wrong' }] } },
    sleep: async () => {},
  }))
  assert.equal(v.status, 'FAIL', 'doit retourner FAIL quand pred reste false après POLL_ATTEMPTS')
  assert.ok(readCount > 1, 'pollExtract doit avoir tenté plusieurs fois')
  assert.ok(readCount <= 20, `pollExtract doit être borné — readCount=${readCount}`)
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 5 — buildCapStep
// ══════════════════════════════════════════════════════════════════════════════

test('buildCapStep — noDevice → SKIP', async () => {
  const step = buildCapStep(txSpec, { id: 'CAP', title: 'cap' })
  const v = await step.run(makeCtx({ nvxPass: '' }))
  assert.equal(v.status, 'SKIP')
})

test('buildCapStep — spec.role=Transmitter + device_role=Transmitter → PASS', async () => {
  const step = buildCapStep(txSpec, { id: 'CAP', title: 'cap' })
  const v = await step.run(makeCtx({ role: 'Transmitter' }))
  assert.equal(v.status, 'PASS', 'CAP doit PASS quand le rôle correspond')
})

test('buildCapStep — spec.role=Transmitter + device_role=Receiver → SKIP (pas FAIL)', async () => {
  const step = buildCapStep(txSpec, { id: 'CAP', title: 'cap' })
  const v = await step.run(makeCtx({ role: 'Receiver' }))
  assert.equal(v.status, 'SKIP', 'CAP Tx doit SKIP sur Receiver, pas FAIL')
})

test('buildCapStep — spec.role=Receiver + device_role=Receiver → PASS', async () => {
  const step = buildCapStep(rxSpec, { id: 'DEC-CAP', title: 'dec-cap' })
  const v = await step.run(makeCtx({ role: 'Receiver' }))
  assert.equal(v.status, 'PASS')
})

test('buildCapStep — spec.role=Receiver + device_role=Transmitter → SKIP', async () => {
  const step = buildCapStep(rxSpec, { id: 'DEC-CAP', title: 'dec-cap' })
  const v = await step.run(makeCtx({ role: 'Transmitter' }))
  assert.equal(v.status, 'SKIP', 'CAP Rx doit SKIP sur Transmitter, pas FAIL')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 6 — buildVarsStep (RISQUE HAUT)
// ══════════════════════════════════════════════════════════════════════════════

test('buildVarsStep — noDevice → SKIP', async () => {
  const step = buildVarsStep(txVarSpec, { id: 'VARS', title: 'vars' })
  const v = await step.run(makeCtx({ nvxPass: '' }))
  assert.equal(v.status, 'SKIP')
})

test('buildVarsStep — mauvais rôle → SKIP', async () => {
  const step = buildVarsStep(txVarSpec, { id: 'VARS', title: 'vars' })
  const v = await step.run(makeCtx({ role: 'Receiver' }))
  assert.equal(v.status, 'SKIP')
})

test('buildVarsStep — (a) ready sur 1ʳᵉ VarCheck seulement — les autres sont immédiats', async () => {
  // txVarSpec.vars[0] a ready=(v)=>v!=='' → polled jusqu'à non-vide.
  // txVarSpec.vars[1] n'a PAS de ready → getVariable appelé une seule fois.
  const calls: Record<string, number> = {}
  const step = buildVarsStep(txVarSpec, { id: 'VARS', title: 'vars' })
  const v = await step.run(makeCtx({
    role: 'Transmitter',
    oracleRead: async () => ({ Streams: [{ Name: 'VALUE', Addr: 'MCAST' }] }),
    getVariable: async (_label: string, name: string) => {
      calls[name] = (calls[name] ?? 0) + 1
      if (name === 'device_role') return 'Transmitter'
      if (name === 'tx_stream_name') return calls[name] === 1 ? '' : 'VALUE'  // 1er appel vide → poll
      if (name === 'tx_multicast') return 'MCAST'  // immédiat
      return ''
    },
    sleep: async () => {},
  }))
  assert.equal(v.status, 'PASS')
  assert.ok(
    (calls['tx_stream_name'] ?? 0) >= 2,
    `tx_stream_name (avec ready) doit être polled ≥2 fois — calls=${calls['tx_stream_name']}`,
  )
  assert.equal(
    calls['tx_multicast'] ?? 0,
    1,
    `tx_multicast (sans ready) ne doit être lu qu'une fois — calls=${calls['tx_multicast']}`,
  )
})

test('buildVarsStep — (b) str() coercion — device() retourne number → device=\'\'', async () => {
  // txNumericVarSpec.vars[0].device retourne e.Volume qui vaut 50 (number).
  // str(50) = '' car 50 n'est pas une string. Companion retourne '50'.
  // → mismatch { companion:'50', device:'' }
  const step = buildVarsStep(txNumericVarSpec, { id: 'VARS', title: 'vars str' })
  const v = await step.run(makeCtx({
    role: 'Transmitter',
    oracleRead: async () => ({ Streams: [{ Volume: 50 }] }),  // Volume = number
    getVariable: async (_l: string, name: string) => {
      if (name === 'device_role') return 'Transmitter'
      if (name === 'tx_volume') return '50'  // Companion a '50'
      return ''
    },
  }))
  assert.equal(v.status, 'FAIL', 'str(50) = "" ≠ "50" → doit être FAIL')
  const obs = v.evidence.observed as Record<string, { companion: string; device: string }>
  assert.ok('tx_volume' in obs, 'observed doit contenir tx_volume')
  assert.equal(obs['tx_volume'].companion, '50', 'companion doit valoir "50"')
  assert.equal(obs['tx_volume'].device, '', 'device doit valoir "" (str() coerce number → "")')
})

test('buildVarsStep — (c) toutes variables matchent → PASS avec note "N/N match"', async () => {
  const step = buildVarsStep(txVarSpec, { id: 'VARS', title: 'vars all match' })
  const v = await step.run(makeCtx({
    role: 'Transmitter',
    oracleRead: async () => ({ Streams: [{ Name: 'STREAM', Addr: '239.1.1.1' }] }),
    getVariable: async (_l: string, name: string) => {
      if (name === 'device_role') return 'Transmitter'
      if (name === 'tx_stream_name') return 'STREAM'
      if (name === 'tx_multicast') return '239.1.1.1'
      return ''
    },
    sleep: async () => {},
  }))
  assert.equal(v.status, 'PASS')
  // Note format : "N/N match" (N = spec.vars.length = 2)
  assert.match(String(v.evidence.note), /2\/2 match/, 'note doit indiquer "2/2 match" (N/N match)')
})

test('buildVarsStep — (c) mismatch → FAIL, observed = { var: { companion, device } }', async () => {
  const step = buildVarsStep(txVarSpec, { id: 'VARS', title: 'vars mismatch' })
  const v = await step.run(makeCtx({
    role: 'Transmitter',
    oracleRead: async () => ({ Streams: [{ Name: 'DEVICE-NAME', Addr: '239.1.1.1' }] }),
    getVariable: async (_l: string, name: string) => {
      if (name === 'device_role') return 'Transmitter'
      if (name === 'tx_stream_name') return 'COMPANION-NAME'   // ≠ 'DEVICE-NAME'
      if (name === 'tx_multicast') return '239.1.1.1'          // match
      return ''
    },
  }))
  assert.equal(v.status, 'FAIL', 'FAIL attendu sur mismatch tx_stream_name')
  const obs = v.evidence.observed as Record<string, { companion: string; device: string }>
  assert.ok('tx_stream_name' in obs, 'observed doit contenir tx_stream_name (le var en mismatch)')
  assert.equal(obs['tx_stream_name'].companion, 'COMPANION-NAME', 'companion = valeur Companion')
  assert.equal(obs['tx_stream_name'].device, 'DEVICE-NAME', 'device = valeur oracle')
  // tx_multicast ne doit PAS être dans observed (il match)
  assert.ok(!('tx_multicast' in obs), 'observed ne doit pas contenir les vars qui matchent')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 7 — buildBaselineStep
// ══════════════════════════════════════════════════════════════════════════════

test('buildBaselineStep — noDevice → SKIP', async () => {
  const step = buildBaselineStep(txSpec, { id: 'BASELINE', title: 'baseline' })
  const v = await step.run(makeCtx({ nvxPass: '' }))
  assert.equal(v.status, 'SKIP')
})

test('buildBaselineStep — mauvais rôle → SKIP (BASELINE-RX SKIP si Transmitter)', async () => {
  const step = buildBaselineStep(rxSpec, { id: 'BASELINE-RX', title: 'baseline rx' })
  const v = await step.run(makeCtx({ role: 'Transmitter' }))
  assert.equal(v.status, 'SKIP', 'BASELINE-RX doit SKIP si le device est un Transmitter')
})

test('buildBaselineStep — oracle.snapshot(spec.endpoint) appelé → PASS', async () => {
  let snapshotEndpoint: string | undefined
  const step = buildBaselineStep(txSpec, { id: 'BASELINE', title: 'baseline' })
  const v = await step.run(makeCtx({
    role: 'Transmitter',
    oracleSnapshot: async (endpoint) => { snapshotEndpoint = endpoint },
  }))
  assert.equal(v.status, 'PASS')
  assert.equal(snapshotEndpoint, '/Device/StreamTransmit', 'snapshot doit utiliser spec.endpoint')
})

test('buildBaselineStep — oracle.snapshot() throws → FAIL', async () => {
  const step = buildBaselineStep(txSpec, { id: 'BASELINE', title: 'baseline' })
  const v = await step.run(makeCtx({
    role: 'Transmitter',
    oracleSnapshot: async () => { throw new Error('device unreachable') },
  }))
  assert.equal(v.status, 'FAIL')
})

test('buildBaselineStep — note SKIP rôle NUE quand skipNote absent (comportement Rx legacy)', async () => {
  // Sans skipNote, le note du SKIP-role doit être NUE : "device_role=${role}" (pas de suffixe).
  // Comportement BASELINE-RX : pas de suffixe — juste la note de rôle.
  // Red si l'implémentation dérive un suffixe depuis spec.endpoint.
  const step = buildBaselineStep(rxSpec, { id: 'BASELINE-RX', title: 'baseline rx' })
  const v = await step.run(makeCtx({ role: 'Transmitter' }))
  assert.equal(v.status, 'SKIP')
  assert.equal(v.evidence.note, 'device_role=Transmitter',
    'note SKIP doit être NUE (pas "— StreamReceive absent on Transmitter") quand skipNote absent')
})

test('buildBaselineStep — note SKIP rôle = device_role+skipNote quand skipNote fourni (comportement Tx legacy)', async () => {
  // Avec skipNote fourni, le note est COMPOSITE : "device_role=${role} ${skipNote}".
  // Comportement BASELINE Tx : skipNote='— StreamTransmit absent on Receiver'.
  const skipNote = '— StreamTransmit absent on Receiver'
  const step = buildBaselineStep(txSpec, { id: 'BASELINE', title: 'baseline', skipNote })
  const v = await step.run(makeCtx({ role: 'Receiver' }))
  assert.equal(v.status, 'SKIP')
  assert.equal(v.evidence.note, `device_role=Receiver ${skipNote}`,
    'note SKIP doit être composite (device_role + skipNote) quand skipNote fourni')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 8 — buildTeardownStep
// ══════════════════════════════════════════════════════════════════════════════

test('buildTeardownStep — noDevice → SKIP', async () => {
  const step = buildTeardownStep(txSpec, { id: 'TEARDOWN', title: 'teardown' })
  const v = await step.run(makeCtx({ nvxPass: '' }))
  assert.equal(v.status, 'SKIP')
})

test('buildTeardownStep — oracle.restore(spec.endpoint, spec.buildBodies) appelé → PASS', async () => {
  let restoreEndpoint: string | undefined
  let restoreBuilderCalled = false
  const step = buildTeardownStep(txSpec, { id: 'TEARDOWN', title: 'teardown' })
  const v = await step.run(makeCtx({
    oracleRestore: async (endpoint, buildBodies) => {
      restoreEndpoint = endpoint
      // Vérifie que c'est bien spec.buildBodies passé (appel avec un subsystem quelconque)
      restoreBuilderCalled = typeof buildBodies === 'function'
      return { skipped: false }
    },
  }))
  assert.equal(v.status, 'PASS')
  assert.equal(restoreEndpoint, '/Device/StreamTransmit', 'restore doit utiliser spec.endpoint')
  assert.ok(restoreBuilderCalled, 'restore doit recevoir spec.buildBodies comme BuildBodiesFn')
})

test('buildTeardownStep — restore retourne {skipped:true} → PASS, note signale "no baseline"', async () => {
  const step = buildTeardownStep(txSpec, { id: 'TEARDOWN', title: 'teardown' })
  const v = await step.run(makeCtx({
    oracleRestore: async () => ({ skipped: true }),
  }))
  assert.equal(v.status, 'PASS', 'TEARDOWN doit PASS même si skipped (best-effort)')
  const note = String(v.evidence.note).toLowerCase()
  assert.ok(
    !note.includes('device restored') && !note.includes('restored'),
    `TEARDOWN ne doit PAS prétendre avoir restauré quand skipped=true — note="${v.evidence.note}"`,
  )
})

test('buildTeardownStep — oracle.restore throws → FAIL', async () => {
  const step = buildTeardownStep(txSpec, { id: 'TEARDOWN', title: 'teardown' })
  const v = await step.run(makeCtx({
    oracleRestore: async () => { throw new Error('device unreachable') },
  }))
  assert.equal(v.status, 'FAIL')
})

test('buildTeardownStep — disableConnection:true → oracle.restore PUIS http.disable (ordre)', async () => {
  // Vérifie que disable est appelé APRÈS restore, et seulement si disableConnection=true.
  const log: string[] = []
  const step = buildTeardownStep(txSpec, { id: 'TEARDOWN', title: 'teardown', disableConnection: true })
  const v = await step.run(makeCtx({
    oracleRestore: async () => { log.push('restore'); return { skipped: false } },
    disable: async () => { log.push('disable') },
  }))
  assert.equal(v.status, 'PASS')
  assert.ok(log.includes('restore'), 'oracle.restore doit être appelé')
  assert.ok(log.includes('disable'), 'http.disable doit être appelé si disableConnection:true')
  assert.ok(log.indexOf('restore') < log.indexOf('disable'), 'restore doit précéder disable')
})

test('buildTeardownStep — disableConnection:false → http.disable PAS appelé', async () => {
  let disableCalled = false
  const step = buildTeardownStep(txSpec, { id: 'TEARDOWN-RX', title: 'teardown rx', disableConnection: false })
  const v = await step.run(makeCtx({
    disable: async () => { disableCalled = true },
  }))
  assert.equal(v.status, 'PASS')
  assert.ok(!disableCalled, 'http.disable ne doit PAS être appelé si disableConnection:false')
})

test('buildTeardownStep — restore échoue + disableConnection:true → disable tenté INCONDITIONNELLEMENT (legacy)', async () => {
  // Comportement legacy (steps-lab.ts l.509-530) : le disable est INCONDITIONNEL.
  // Même si oracle.restore() throw, http.disable doit être appelé ET la note doit être composite.
  // Red si l'implémentation conditionne sur `if (ok && disableConnection)`.
  let disableCalled = false
  const failNote = 'restore failed'
  const step = buildTeardownStep(txSpec, {
    id: 'TEARDOWN',
    title: 'teardown',
    disableConnection: true,
    failNote,
  })
  const v = await step.run(makeCtx({
    oracleRestore: async () => { throw new Error('device unreachable') },
    disable: async () => { disableCalled = true },
  }))
  assert.equal(v.status, 'FAIL', 'statut FAIL quand restore échoue')
  assert.ok(disableCalled, 'http.disable doit être tenté MEME si restore échoue (disable inconditionnel)')
  assert.match(String(v.evidence.note ?? ''), /^restore failed: .*; connection disabled$/,
    'note composite : restore failed → ; connection disabled (même en cas d\'échec restore)')
})

// ══════════════════════════════════════════════════════════════════════════════
// Section 9 — Titres legacy EXACTS (décision A — vague 2a)
//
// Ces tests passent `titles` aux builders et vérifient JourneyStep.title
// ainsi que Verdict.title pour chaque issue (pass/fail/skipRole/noDevice).
// Red phase actuelle : builders lèvent "not implemented".
// Red phase post-Green-basique : builders ignorent le param `titles` → mismatch.
// ══════════════════════════════════════════════════════════════════════════════

// ── CAP Tx ───────────────────────────────────────────────────────────────────

test('buildCapStep Tx — titres legacy EXACTS via param titles (Red décision A)', async () => {
  const titles = {
    step: 'encoder panel active (device_role = Transmitter)',
    pass: 'encoder panel active (role=Transmitter)',
    skipRole: 'encoder journey (device is not a Transmitter)',
    noDevice: 'capability (no device)',
  }
  const step = buildCapStep(txSpec, { id: 'CAP', title: titles.step, titles })

  assert.equal(step.title, titles.step, 'JourneyStep.title doit utiliser titles.step')

  const vNoDevice = await step.run(makeCtx({ nvxPass: '' }))
  assert.equal(vNoDevice.title, titles.noDevice, 'Verdict.title noDevice doit utiliser titles.noDevice')

  const vSkip = await step.run(makeCtx({ role: 'Receiver' }))
  assert.equal(vSkip.title, titles.skipRole, 'Verdict.title skipRole doit utiliser titles.skipRole')

  const vPass = await step.run(makeCtx({ role: 'Transmitter' }))
  assert.equal(vPass.title, titles.pass, 'Verdict.title PASS doit utiliser titles.pass')
})

// ── CAP Rx ───────────────────────────────────────────────────────────────────

test('buildCapStep Rx — titres legacy EXACTS via param titles (Red décision A)', async () => {
  const titles = {
    step: 'decoder panel active (device_role = Receiver)',
    pass: 'decoder panel active (role=Receiver)',
    skipRole: 'decoder panel (device is not a Receiver)',
    noDevice: 'decoder capability (no device)',
  }
  const step = buildCapStep(rxSpec, { id: 'DEC-CAP', title: titles.step, titles })

  assert.equal(step.title, titles.step)

  const vNoDevice = await step.run(makeCtx({ nvxPass: '' }))
  assert.equal(vNoDevice.title, titles.noDevice)

  const vSkip = await step.run(makeCtx({ role: 'Transmitter' }))
  assert.equal(vSkip.title, titles.skipRole)

  const vPass = await step.run(makeCtx({ role: 'Receiver' }))
  assert.equal(vPass.title, titles.pass)
})

// ── VARS Tx ──────────────────────────────────────────────────────────────────

test('buildVarsStep Tx — titres legacy EXACTS via param titles (Red décision A)', async () => {
  const titles = {
    step: 'encoder variables (REST) == device (oracle)',
    pass: 'companion variables == device',
    fail: 'variable/device mismatch',
    skipRole: 'encoder vars (device is not a Transmitter)',
    noDevice: 'variables (no device)',
  }
  const step = buildVarsStep(txVarSpec, { id: 'ENC-VARS', title: titles.step, titles })

  assert.equal(step.title, titles.step)

  const vNoDevice = await step.run(makeCtx({ nvxPass: '' }))
  assert.equal(vNoDevice.title, titles.noDevice)

  const vSkip = await step.run(makeCtx({ role: 'Receiver' }))
  assert.equal(vSkip.title, titles.skipRole)

  const vPass = await step.run(makeCtx({
    role: 'Transmitter',
    oracleRead: async () => ({ Streams: [{ Name: 'S', Addr: 'M' }] }),
    getVariable: async (_l: string, name: string) => {
      if (name === 'device_role') return 'Transmitter'
      if (name === 'tx_stream_name') return 'S'
      if (name === 'tx_multicast') return 'M'
      return ''
    },
    sleep: async () => {},
  }))
  assert.equal(vPass.title, titles.pass)

  const vFail = await step.run(makeCtx({
    role: 'Transmitter',
    oracleRead: async () => ({ Streams: [{ Name: 'DEVICE', Addr: 'M' }] }),
    getVariable: async (_l: string, name: string) => {
      if (name === 'device_role') return 'Transmitter'
      if (name === 'tx_stream_name') return 'COMPANION'  // mismatch
      if (name === 'tx_multicast') return 'M'
      return ''
    },
  }))
  assert.equal(vFail.title, titles.fail)
})

// ── VARS Rx ──────────────────────────────────────────────────────────────────

test('buildVarsStep Rx — titres legacy EXACTS via param titles (Red décision A)', async () => {
  const rxVarSpec: SubsystemSpec = {
    ...rxSpec,
    vars: [
      { var: 'rx_url', device: (e) => str(e.Url) },
    ],
  }
  const titles = {
    step: 'decoder variables (REST) == device (oracle)',
    pass: 'companion decoder variables == device',
    fail: 'decoder variable/device mismatch',
    skipRole: 'decoder variables (device is not a Receiver)',
    noDevice: 'decoder variables (no device)',
  }
  const step = buildVarsStep(rxVarSpec, { id: 'DEC-VARS', title: titles.step, titles })

  assert.equal(step.title, titles.step)

  const vNoDevice = await step.run(makeCtx({ nvxPass: '' }))
  assert.equal(vNoDevice.title, titles.noDevice)

  const vSkip = await step.run(makeCtx({ role: 'Transmitter' }))
  assert.equal(vSkip.title, titles.skipRole)

  const vPass = await step.run(makeCtx({
    role: 'Receiver',
    oracleRead: async () => ({ Streams: [{ Url: 'rtsp://x' }] }),
    getVariable: async (_l: string, name: string) => {
      if (name === 'device_role') return 'Receiver'
      if (name === 'rx_url') return 'rtsp://x'
      return ''
    },
  }))
  assert.equal(vPass.title, titles.pass)

  const vFail = await step.run(makeCtx({
    role: 'Receiver',
    oracleRead: async () => ({ Streams: [{ Url: 'rtsp://device' }] }),
    getVariable: async (_l: string, name: string) => {
      if (name === 'device_role') return 'Receiver'
      if (name === 'rx_url') return 'rtsp://companion'  // mismatch
      return ''
    },
  }))
  assert.equal(vFail.title, titles.fail)
})

// ── BASELINE Tx ──────────────────────────────────────────────────────────────

test('buildBaselineStep Tx — titres + passNote + skipNote legacy EXACTS (Red décision A)', async () => {
  const titles = {
    step: 'capture device baseline (Streams[0])',
    pass: 'baseline captured',
    fail: 'baseline capture failed',
    skipRole: 'baseline (device is not a Transmitter)',
    noDevice: 'baseline (no device)',
  }
  const passNote = 'stored for TEARDOWN restore'
  const skipNote = '— StreamTransmit absent on Receiver'
  const step = buildBaselineStep(txSpec, { id: 'BASELINE', title: titles.step, passNote, skipNote, titles })

  assert.equal(step.title, titles.step)

  const vNoDevice = await step.run(makeCtx({ nvxPass: '' }))
  assert.equal(vNoDevice.title, titles.noDevice)

  const vSkipRole = await step.run(makeCtx({ role: 'Receiver' }))
  assert.equal(vSkipRole.title, titles.skipRole)
  // skipNote Tx : note COMPOSITE exacte = "device_role=Receiver <skipNote>"
  assert.equal(vSkipRole.evidence.note, `device_role=Receiver ${skipNote}`,
    'note SKIP Tx doit être composite exacte : device_role=Receiver — StreamTransmit absent on Receiver')

  const vPass = await step.run(makeCtx({
    role: 'Transmitter',
    oracleSnapshot: async () => {},
  }))
  assert.equal(vPass.title, titles.pass)
  assert.equal(vPass.evidence.note, passNote, 'passNote doit apparaître dans evidence.note du PASS')

  const vFail = await step.run(makeCtx({
    role: 'Transmitter',
    oracleSnapshot: async () => { throw new Error('unreachable') },
  }))
  assert.equal(vFail.title, titles.fail)
})

// ── BASELINE Rx ──────────────────────────────────────────────────────────────

test('buildBaselineStep Rx — titres + passNote legacy EXACTS (Red décision A)', async () => {
  const titles = {
    step: 'capture decoder baseline (StreamReceive Streams[0])',
    pass: 'decoder baseline captured',
    fail: 'decoder baseline capture failed',
    skipRole: 'baseline-rx (device is not a Receiver)',
    noDevice: 'baseline-rx (no device)',
  }
  const passNote = 'stored for TEARDOWN-RX restore'
  const step = buildBaselineStep(rxSpec, { id: 'BASELINE-RX', title: titles.step, passNote, titles })

  assert.equal(step.title, titles.step)

  const vNoDevice = await step.run(makeCtx({ nvxPass: '' }))
  assert.equal(vNoDevice.title, titles.noDevice)

  const vSkipRole = await step.run(makeCtx({ role: 'Transmitter' }))
  assert.equal(vSkipRole.title, titles.skipRole)
  // Baseline Rx : sans skipNote → note NUE (pas de suffixe)
  assert.equal(vSkipRole.evidence.note, 'device_role=Transmitter',
    'note SKIP Rx doit être NUE : "device_role=Transmitter" (pas de suffixe endpoint)')

  const vPass = await step.run(makeCtx({
    role: 'Receiver',
    oracleSnapshot: async () => {},
  }))
  assert.equal(vPass.title, titles.pass)
  assert.equal(vPass.evidence.note, passNote, 'passNote Rx doit apparaître dans evidence.note du PASS')

  const vFail = await step.run(makeCtx({
    role: 'Receiver',
    oracleSnapshot: async () => { throw new Error('unreachable') },
  }))
  assert.equal(vFail.title, titles.fail)
})

// ── TEARDOWN Tx ──────────────────────────────────────────────────────────────

test('buildTeardownStep Tx — titres + notes legacy EXACTS (Red décision A)', async () => {
  const titles = {
    step: 'restore device + disable connection',
    pass: 'teardown complete',
    fail: 'teardown incomplete',
    noDevice: 'teardown (no device)',
  }
  const restoredNote = 'device restored'
  const skippedNote = 'no baseline (SKIP capture) — nothing restored'
  const failNote = 'restore failed'
  const step = buildTeardownStep(txSpec, {
    id: 'TEARDOWN',
    title: titles.step,
    disableConnection: true,
    restoredNote,
    skippedNote,
    failNote,
    titles,
  })

  assert.equal(step.title, titles.step)

  const vNoDevice = await step.run(makeCtx({ nvxPass: '' }))
  assert.equal(vNoDevice.title, titles.noDevice)

  const vPassRestored = await step.run(makeCtx({
    oracleRestore: async () => ({ skipped: false }),
  }))
  assert.equal(vPassRestored.title, titles.pass)
  // Comportement legacy : note COMPOSITE quand disableConnection=true et disable réussit
  assert.equal(vPassRestored.evidence.note, `${restoredNote}; connection disabled`,
    'note PASS restore = restoredNote + "; connection disabled" (disable inconditionnel)')

  const vPassSkipped = await step.run(makeCtx({
    oracleRestore: async () => ({ skipped: true }),
  }))
  assert.equal(vPassSkipped.title, titles.pass)
  assert.equal(vPassSkipped.evidence.note, `${skippedNote}; connection disabled`,
    'note PASS skipped = skippedNote + "; connection disabled" (disable inconditionnel)')

  const vFail = await step.run(makeCtx({
    oracleRestore: async () => { throw new Error('device unreachable') },
  }))
  assert.equal(vFail.title, titles.fail)
  // restore échoue + disable tenté quand même → note composite avec les deux
  assert.match(String(vFail.evidence.note ?? ''), /^restore failed: .*; connection disabled$/,
    'note FAIL = "restore failed: <msg>; connection disabled" (disable inconditionnel même en échec restore)')
})

// ── TEARDOWN Rx ──────────────────────────────────────────────────────────────

test('buildTeardownStep Rx — titres + notes legacy EXACTS (Red décision A)', async () => {
  const titles = {
    step: 'restore decoder (StreamReceive) to baseline',
    pass: 'teardown-rx complete',
    fail: 'decoder restore failed',
    noDevice: 'teardown-rx (no device)',
  }
  const restoredNote = 'StreamReceive baseline re-applied'
  const skippedNote = 'no baselineRx (SKIP capture) — nothing restored'
  const failNote = 'decoder restore failed'
  const step = buildTeardownStep(rxSpec, {
    id: 'TEARDOWN-RX',
    title: titles.step,
    disableConnection: false,
    restoredNote,
    skippedNote,
    failNote,
    titles,
  })

  assert.equal(step.title, titles.step)

  const vNoDevice = await step.run(makeCtx({ nvxPass: '' }))
  assert.equal(vNoDevice.title, titles.noDevice)

  const vPassRestored = await step.run(makeCtx({
    oracleRestore: async () => ({ skipped: false }),
  }))
  assert.equal(vPassRestored.title, titles.pass)
  assert.equal(vPassRestored.evidence.note, restoredNote)

  const vPassSkipped = await step.run(makeCtx({
    oracleRestore: async () => ({ skipped: true }),
  }))
  assert.equal(vPassSkipped.title, titles.pass)
  assert.equal(vPassSkipped.evidence.note, skippedNote)

  const vFail = await step.run(makeCtx({
    oracleRestore: async () => { throw new Error('rx unreachable') },
  }))
  assert.equal(vFail.title, titles.fail)
  assert.match(String(vFail.evidence.note ?? ''), new RegExp(`^${failNote}:`), `evidence.note doit commencer par "${failNote}:"`)
})
