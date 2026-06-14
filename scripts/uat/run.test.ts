import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderCases, selectByTiers } from './run.js'
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
