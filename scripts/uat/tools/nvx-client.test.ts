import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeClient } from './nvx-client.js'
import type { HarnessConfig } from '../lib/case.js'

const cfg = (over: Partial<HarnessConfig> = {}): HarnessConfig => ({
  nvxHost: '192.168.1.50', nvxPort: 443, nvxUser: 'admin', nvxPass: '',
  companionUrl: 'http://localhost:8000', ...over,
})

test('makeClient builds an NvxApiClient from harness config', () => {
  const client = makeClient(cfg({ nvxPass: 'secret' }))
  assert.ok(client)
  assert.equal(typeof client.login, 'function')
})
