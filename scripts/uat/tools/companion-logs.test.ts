import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CompanionLogs } from './companion-logs.js'

const SAMPLE = [
  '2026-06-14T16:51:50Z error Instance/Connection/nvx-uat [HTTP] Timeout: GET /userlogin.html',
  '2026-06-14T16:51:50Z error Instance/Connection/nvx-uat [CONN] Connection failed (192.0.2.1): NVX timeout',
  '2026-06-14T16:51:50Z info  Instance/Connection/other [POLL] tick',
].join('\n')

test('since filters by label and prefix', () => {
  const logs = new CompanionLogs('companion-uat', () => SAMPLE)
  const lines = logs.since({ ts: '2026-06-14T16:51:00Z' }, 'nvx-uat', '[CONN]')
  assert.equal(lines.length, 1)
  assert.match(lines[0], /NVX timeout/)
})

test('since without prefix returns all lines for the label', () => {
  const logs = new CompanionLogs('companion-uat', () => SAMPLE)
  const lines = logs.since({ ts: '2026-06-14T16:51:00Z' }, 'nvx-uat')
  assert.equal(lines.length, 2)
})

test('detect returns true when a matching line exists', () => {
  const logs = new CompanionLogs('companion-uat', () => SAMPLE)
  assert.equal(logs.detect({ ts: '2026-06-14T16:51:00Z' }, 'nvx-uat', /NVX timeout/), true)
  assert.equal(logs.detect({ ts: '2026-06-14T16:51:00Z' }, 'nvx-uat', /401|403/), false)
})

test('mark stamps an ISO timestamp with the Z suffix', () => {
  const logs = new CompanionLogs('companion-uat', () => SAMPLE)
  assert.match(logs.mark().ts, /Z$/)
})
