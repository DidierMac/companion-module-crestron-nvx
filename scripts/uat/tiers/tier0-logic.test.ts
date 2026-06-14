import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasDevice, makeClient } from './tier0-logic.js'
import type { HarnessConfig } from '../lib/case.js'

const cfg = (over: Partial<HarnessConfig> = {}): HarnessConfig => ({
  nvxHost: '192.168.2.9', nvxPort: 443, nvxUser: 'admin', nvxPass: '',
  companionUrl: 'http://localhost:8000', tiers: [0], ...over,
})

test('hasDevice is false when password is empty', () => {
  assert.equal(hasDevice(cfg()), false)
})

test('hasDevice is true when host + password are set', () => {
  assert.equal(hasDevice(cfg({ nvxPass: 'secret' })), true)
})

test('makeClient builds an NvxApiClient from harness config', () => {
  const client = makeClient(cfg({ nvxPass: 'secret' }))
  assert.equal(typeof client.login, 'function')
  assert.equal(typeof client.get, 'function')
})
