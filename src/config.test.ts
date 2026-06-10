import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingCredential } from './config.js'
import type { ModuleConfig, ModuleSecrets } from './config.js'

const baseConfig: ModuleConfig = {
  host: '10.0.0.1',
  port: 443,
  username: 'admin',
  pollInterval: 2000,
  ignoreSelfSignedCert: true,
  verbose: false,
}

test('missingCredential() flags an empty password (spec §6 garde-fou)', () => {
  const secrets: ModuleSecrets = { password: '' }
  assert.equal(missingCredential(baseConfig, secrets), 'No password configured')
})

test('missingCredential() flags an empty host', () => {
  const secrets: ModuleSecrets = { password: 'x' }
  assert.equal(missingCredential({ ...baseConfig, host: '' }, secrets), 'No host configured')
})

test('missingCredential() returns null when host and password are present', () => {
  const secrets: ModuleSecrets = { password: 's3cr3t' }
  assert.equal(missingCredential(baseConfig, secrets), null)
})
