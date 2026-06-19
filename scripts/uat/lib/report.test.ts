import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderMarkdown, renderEscalation, renderDetails, resolveRunDir, writeRun } from './report.js'
import { pass, fail, human } from './verdict.js'
import type { RunResult } from './case.js'

const run: RunResult = {
  startedAt: '2026-06-14T10:00:00.000Z',
  version: 'v0.2',
  verdicts: [
    pass('A3', 'good login', 0, { note: 'HTTP 200' }),
    fail('ENC-01', 'stream name', 0, { expected: 'X', observed: 'Y' }),
    human('C1', 'physical drop', 0, {}),
  ],
}

test('renderMarkdown includes a header, counts, and one row per verdict', () => {
  const md = renderMarkdown(run)
  assert.match(md, /v0\.2/)
  assert.match(md, /PASS.*1/s)
  assert.match(md, /A3/)
  assert.match(md, /ENC-01/)
  assert.match(md, /C1/)
})

test('renderEscalation keeps only FAIL/AMBIGUOUS/HUMAN with full evidence', () => {
  const pkt = renderEscalation(run)
  assert.equal(pkt.cases.length, 2) // ENC-01 (FAIL) + C1 (HUMAN); A3 PASS excluded
  const ids = pkt.cases.map((c) => c.id).sort()
  assert.deepEqual(ids, ['C1', 'ENC-01'])
  const enc = pkt.cases.find((c) => c.id === 'ENC-01')!
  assert.equal(enc.evidence.expected, 'X')
  assert.equal(enc.evidence.observed, 'Y')
})

test('resolveRunDir: premier run du jour démarre à #01', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'uat-runs-'))
  try {
    assert.equal(resolveRunDir(base, '2026-06-17', 'Rx'), path.join(base, '2026-06-17#01-Rx'))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('resolveRunDir: incrémente par jour, tous modules confondus, autres jours ignorés', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'uat-runs-'))
  try {
    mkdirSync(path.join(base, '2026-06-17#01-Rx'))
    mkdirSync(path.join(base, '2026-06-17#02-Tx'))
    mkdirSync(path.join(base, '2026-06-16#09-Rx')) // autre jour → ignoré
    assert.equal(resolveRunDir(base, '2026-06-17', 'Tx'), path.join(base, '2026-06-17#03-Tx'))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('resolveRunDir: baseDir absent → #01 (pas de crash)', () => {
  const missing = path.join(os.tmpdir(), 'uat-runs-absent-xyz-123')
  assert.equal(resolveRunDir(missing, '2026-06-17', 'journey'), path.join(missing, '2026-06-17#01-journey'))
})

test('redaction: secrets in evidence never reach md or json', () => {
  const leaky: RunResult = {
    startedAt: '2026-06-14T10:00:00.000Z', version: 'v0.2',
    verdicts: [fail('X', 'leak', 0, { observed: { password: 'hunter2', token: 'abc', host: '1.2.3.4' } })],
  }
  const md = renderMarkdown(leaky)
  const pkt = JSON.stringify(renderEscalation(leaky))
  assert.doesNotMatch(md, /hunter2|abc/)
  assert.doesNotMatch(pkt, /hunter2|abc/)
  assert.match(pkt, /1\.2\.3\.4/) // non-sensitive value preserved
})

test('renderMarkdown ne mentionne plus le tier', () => {
  const md = renderMarkdown(run)
  assert.doesNotMatch(md, /tier/i)
})

test('renderMarkdown tronque un observed volumineux et renvoie vers details.json', () => {
  const big = { blob: 'x'.repeat(500) }
  const r: RunResult = {
    startedAt: '2026-06-18T10:00:00.000Z', version: 'v0.4',
    verdicts: [fail('B1', 'big observed', 1, { observed: big })],
  }
  const md = renderMarkdown(r)
  assert.match(md, /truncated — full evidence in details\.json/)
  assert.ok(md.length < JSON.stringify(big).length + 400) // pas de dump intégral
})

test('writeRun écrit run.json contenant le RunResult complet', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'uat-run-'))
  writeRun(dir, run) // `run` = fixture existante en tête du fichier
  const reloaded = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'))
  assert.equal(reloaded.version, run.version)
  assert.equal(reloaded.verdicts.length, run.verdicts.length)
  rmSync(dir, { recursive: true, force: true })
})

test('renderDetails renvoie chaque verdict avec son évidence redactée', () => {
  const r: RunResult = {
    startedAt: '2026-06-18T10:00:00.000Z', version: 'v0.4',
    verdicts: [pass('P1', 'ok', 1, { observed: { sessionid: 'leak-me', value: 42 } })],
  }
  const details = renderDetails(r)
  assert.equal(details.length, 1)
  assert.equal(details[0].id, 'P1')
  assert.equal((details[0].evidence.observed as Record<string, unknown>).sessionid, '***')
  assert.equal((details[0].evidence.observed as Record<string, unknown>).value, 42)
})
