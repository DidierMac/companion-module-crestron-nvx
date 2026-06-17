import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadJourneyConfig } from './run-journey.js'

test('loadJourneyConfig — hors lab, NVX_USER absent → défaut admin toléré', () => {
  const cfg = loadJourneyConfig({ NVX_HOST: '192.0.2.1' })
  assert.equal(cfg.nvxUser, 'admin')
})

test('loadJourneyConfig — hors lab, NVX_USER présent → utilisé', () => {
  const cfg = loadJourneyConfig({ NVX_HOST: '192.0.2.1', NVX_USER: 'didier' })
  assert.equal(cfg.nvxUser, 'didier')
})

test('loadJourneyConfig — mode lab, NVX_USER présent → utilisé sans erreur', () => {
  const cfg = loadJourneyConfig({ UAT_LAB: '1', NVX_HOST: '10.0.0.10', NVX_USER: 'admin' })
  assert.equal(cfg.nvxUser, 'admin')
})

test('loadJourneyConfig — mode lab, NVX_USER absent → throw avec message explicite', () => {
  assert.throws(
    () => loadJourneyConfig({ UAT_LAB: '1', NVX_HOST: '10.0.0.10' }),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.ok(err.message.includes('NVX_USER'), `message manque NVX_USER : ${err.message}`)
      assert.ok(err.message.includes('lab'), `message manque 'lab' : ${err.message}`)
      return true
    },
  )
})
