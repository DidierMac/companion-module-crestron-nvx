import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderCases, selectByTiers, runCases } from './run.js'
import type { UatCase } from './lib/case.js'

const stub = (id: string, tier: 0 | 1 | 2, phase: UatCase['phase']): UatCase => ({
  id,
  title: id,
  tier,
  phase,
  run: async () => ({ id, title: id, tier, status: 'PASS', evidence: {} }),
})

test('orderCases: auth first, disruptive last, reads/ui in the middle', () => {
  const cases = [stub('C2', 0, 'disruptive'), stub('B1', 1, 'read'), stub('A1', 0, 'auth'), stub('UI-01', 2, 'ui')]
  const ordered = orderCases(cases).map((c) => c.id)
  assert.deepEqual(ordered, ['A1', 'B1', 'UI-01', 'C2'])
})

test('selectByTiers keeps only requested tiers', () => {
  const cases = [stub('A1', 0, 'auth'), stub('B1', 1, 'read'), stub('UI-01', 2, 'ui')]
  assert.deepEqual(selectByTiers(cases, [0]).map((c) => c.id), ['A1'])
  assert.deepEqual(selectByTiers(cases, [0, 1]).map((c) => c.id).sort(), ['A1', 'B1'])
})

const fullCfg = { nvxHost: 'h', nvxPort: 443, nvxUser: 'admin', nvxPass: '', companionUrl: 'http://localhost:8000', tiers: [0 as 0] }

test('runCases catches a throwing case → FAIL, and continues', async () => {
  const boom: UatCase = { id: 'BOOM', title: 'boom', tier: 0, phase: 'read', run: async () => { throw new Error('kaboom') } }
  const verdicts = await runCases([boom, stub('AFTER', 0, 'disruptive')], { config: fullCfg })
  const b = verdicts.find((v) => v.id === 'BOOM')!
  assert.equal(b.status, 'FAIL')
  assert.match(String(b.evidence.note), /threw:/)
  assert.ok(verdicts.find((v) => v.id === 'AFTER')) // suivant exécuté quand même
})

test('orderCases preserves array order within a phase (lockout A1→A2→A3)', () => {
  const ordered = orderCases([stub('A1', 0, 'auth'), stub('A2', 0, 'auth'), stub('A3', 0, 'auth')])
  assert.deepEqual(ordered.map((c) => c.id), ['A1', 'A2', 'A3'])
})
