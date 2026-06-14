import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pass, fail, ambiguous, human, skip, assertEqual } from './verdict.js'

test('pass builds a PASS verdict', () => {
  const v = pass('A3', 'good login', 0, { note: 'HTTP 200' })
  assert.equal(v.status, 'PASS')
  assert.equal(v.id, 'A3')
  assert.equal(v.tier, 0)
  assert.equal(v.evidence.note, 'HTTP 200')
})

test('fail carries expected vs observed evidence', () => {
  const v = fail('ENC-01', 'stream name', 0, { expected: 'X', observed: 'Y' })
  assert.equal(v.status, 'FAIL')
  assert.equal(v.evidence.expected, 'X')
  assert.equal(v.evidence.observed, 'Y')
})

test('ambiguous / human / skip set their status', () => {
  assert.equal(ambiguous('ENC-02', 'inferred POST', 0, {}).status, 'AMBIGUOUS')
  assert.equal(human('C1', 'physical drop', 0, {}).status, 'HUMAN')
  assert.equal(skip('CAP-01', 'device is Receiver', 1, {}).status, 'SKIP')
})

test('assertEqual → PASS on strict equality', () => {
  const v = assertEqual('B2', 'firmware', 1, '7.1.5259.00090', '7.1.5259.00090')
  assert.equal(v.status, 'PASS')
})

test('assertEqual → FAIL with evidence on mismatch', () => {
  const v = assertEqual('B2', 'firmware', 1, '7.0.0', '7.1.5259.00090')
  assert.equal(v.status, 'FAIL')
  assert.equal(v.evidence.expected, '7.1.5259.00090')
  assert.equal(v.evidence.observed, '7.0.0')
})
