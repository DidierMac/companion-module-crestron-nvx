import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encoderCases } from './encoder.js'

test('encoder cases are tier 0 with expected ids and phases', () => {
  const ids = encoderCases.map((c) => c.id)
  assert.deepEqual(ids, ['ENC-01', 'ENC-02', 'ENC-03', 'ENC-05', 'C2', 'C3'])
  const byId = Object.fromEntries(encoderCases.map((c) => [c.id, c]))
  assert.equal(byId['C2'].phase, 'disruptive')
  assert.equal(byId['C3'].phase, 'disruptive')
  assert.equal(byId['ENC-01'].phase, 'read')
  assert.ok(encoderCases.every((c) => c.tier === 0))
})

test('device cases SKIP when no device configured', async () => {
  const ctx = { config: { nvxHost: '192.168.2.9', nvxPort: 443, nvxUser: 'admin', nvxPass: '', companionUrl: '', tiers: [0 as 0] } }
  const enc01 = encoderCases.find((c) => c.id === 'ENC-01')!
  const v = await enc01.run(ctx as never)
  assert.equal(v.status, 'SKIP')
})
