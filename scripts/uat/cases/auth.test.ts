import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authA1, authCases } from './auth.js'
import type { RunContext } from '../lib/case.js'

const ctx = (nvxPass: string): RunContext => ({
  config: { nvxHost: '192.168.2.9', nvxPort: 443, nvxUser: 'admin', nvxPass, companionUrl: 'http://localhost:8000', tiers: [0] },
})

test('A1 (empty password) → PASS via the pure BadConfig guard, no network', async () => {
  // A1 uses missingCredential() from src/config.ts — empty password = BadConfig, zero network.
  const v = await authA1.run(ctx('')) // empty pass is exactly the A1 condition
  assert.equal(v.id, 'A1')
  assert.equal(v.status, 'PASS')
})

test('authCases are tagged auth phase, tier 0, in order A1,A2,A3', () => {
  assert.deepEqual(authCases.map((c) => c.id), ['A1', 'A2', 'A3'])
  assert.ok(authCases.every((c) => c.phase === 'auth' && c.tier === 0))
})
