import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyProfile, PROFILES } from './profiles.js'

test("sans UAT_PROFILE, l'env est renvoyé tel quel", () => {
  const env = { FOO: 'bar' }
  assert.equal(applyProfile(env), env)
})

test("le profil fake fournit les flags structurels manquants", () => {
  const out = applyProfile({ UAT_PROFILE: 'fake', NVX_PASS: 'test123' })
  assert.equal(out.UAT_FAKE, '1')
  assert.equal(out.UAT_LAB, '1')
  assert.equal(out.NVX_PORT, '8443')
})

test("l'env explicite l'emporte sur le défaut du profil", () => {
  const out = applyProfile({ UAT_PROFILE: 'fake', NVX_PORT: '9000' })
  assert.equal(out.NVX_PORT, '9000')
})

test("le profil lab ne code AUCUNE coordonnée device (host/pass restent à l'env)", () => {
  assert.equal(PROFILES.lab.NVX_HOST, undefined)
  assert.equal(PROFILES.lab.NVX_PASS, undefined)
  assert.equal(PROFILES.lab.UAT_LAB, '1')
})

test("un profil inconnu jette", () => {
  assert.throws(() => applyProfile({ UAT_PROFILE: 'nope' }), /Unknown UAT_PROFILE/)
})
