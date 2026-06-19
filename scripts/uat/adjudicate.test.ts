import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyAdjudication } from './adjudicate.js'
import { writeRun } from './lib/report.js'
import type { RunResult } from './lib/case.js'

test('applyAdjudication remplace le statut des cas adjugés et réécrit le rapport', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'uat-adj-'))
  const run: RunResult = {
    startedAt: '2026-06-18T00:00:00.000Z', version: 'v0.4',
    verdicts: [
      { id: 'CFG-NOPASS', title: 'empty password', tier: 1, status: 'AMBIGUOUS', evidence: { note: 'non concluant' } },
      { id: 'INSTALL', title: 'module available', tier: 1, status: 'PASS', evidence: {} },
    ],
  }
  writeRun(dir, run)
  writeFileSync(path.join(dir, 'llm.json'), JSON.stringify([{ id: 'CFG-NOPASS', status: 'FAIL', reason: 'env ok, real defect' }]), 'utf8')

  applyAdjudication(dir, path.join(dir, 'llm.json'))

  const merged = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'))
  const cfg = merged.verdicts.find((v: { id: string }) => v.id === 'CFG-NOPASS')
  assert.equal(cfg.status, 'FAIL')
  assert.match(cfg.evidence.note, /LLM: FAIL/)
  rmSync(dir, { recursive: true, force: true })
})
