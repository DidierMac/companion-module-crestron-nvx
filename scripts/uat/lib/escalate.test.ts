import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEscalationPrompt, mergeVerdicts } from './escalate.js'
import type { EscalationPacket } from './report.js'
import type { Verdict } from './verdict.js'

const packet: EscalationPacket = {
  version: 'journey',
  startedAt: '2026-06-14T00:00:00Z',
  cases: [
    { id: 'CFG-GOOD', title: 'connected', tier: 1, status: 'AMBIGUOUS', evidence: { observed: { category: 'unknown' } } },
  ],
}

test('buildEscalationPrompt includes the case id, evidence, and a JSON reply format', () => {
  const prompt = buildEscalationPrompt(packet)
  assert.match(prompt, /CFG-GOOD/)
  assert.match(prompt, /"category": "unknown"/)
  assert.match(prompt, /PASS\|FAIL\|HUMAN/)
})

test('mergeVerdicts replaces status by id and annotates the note', () => {
  const original: Verdict[] = [
    { id: 'CFG-GOOD', title: 'connected', tier: 1, status: 'AMBIGUOUS', evidence: { note: 'orig' } },
    { id: 'INSTALL', title: 'module', tier: 1, status: 'PASS', evidence: {} },
  ]
  const merged = mergeVerdicts(original, [{ id: 'CFG-GOOD', status: 'PASS', reason: 'evidence ok' }])
  const good = merged.find((v) => v.id === 'CFG-GOOD')!
  assert.equal(good.status, 'PASS')
  assert.match(String(good.evidence.note), /orig/)
  assert.match(String(good.evidence.note), /LLM: PASS — evidence ok/)
  // untouched verdict stays as-is
  assert.equal(merged.find((v) => v.id === 'INSTALL')!.status, 'PASS')
})

test('mergeVerdicts ignores LLM entries with no matching id', () => {
  const original: Verdict[] = [{ id: 'A', title: 'a', tier: 1, status: 'FAIL', evidence: {} }]
  const merged = mergeVerdicts(original, [{ id: 'GHOST', status: 'PASS' }])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].status, 'FAIL')
})

test('buildEscalationPrompt inclut les cas AMBIGUOUS et demande un JSON', () => {
  const packet: EscalationPacket = {
    version: 'v0.4', startedAt: '2026-06-18T00:00:00.000Z',
    cases: [
      { id: 'CFG-NOPASS', title: 'empty password → BadConfig', tier: 1 as const, status: 'AMBIGUOUS' as const, evidence: { note: 'cause non observée' } },
    ],
  }
  const prompt = buildEscalationPrompt(packet)
  assert.match(prompt, /CFG-NOPASS/)
  assert.match(prompt, /current: AMBIGUOUS/)
  assert.match(prompt, /Reply as JSON/)
})
