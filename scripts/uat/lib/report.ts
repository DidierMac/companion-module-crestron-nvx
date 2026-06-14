import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Verdict, VerdictStatus } from './verdict.js'
import type { RunResult } from './case.js'

const ESCALATED: VerdictStatus[] = ['FAIL', 'AMBIGUOUS', 'HUMAN']

const ICON: Record<VerdictStatus, string> = {
  PASS: '[x]',
  FAIL: '[!]',
  AMBIGUOUS: '[~]',
  HUMAN: '[H]',
  SKIP: '[-]',
}

function counts(verdicts: Verdict[]): Record<VerdictStatus, number> {
  const c: Record<VerdictStatus, number> = { PASS: 0, FAIL: 0, AMBIGUOUS: 0, HUMAN: 0, SKIP: 0 }
  for (const v of verdicts) c[v.status]++
  return c
}

export function renderMarkdown(run: RunResult): string {
  const c = counts(run.verdicts)
  const lines: string[] = []
  lines.push(`# UAT run — ${run.version}`)
  lines.push('')
  lines.push(`Started: ${run.startedAt}`)
  lines.push('')
  lines.push(
    `Totals — PASS ${c.PASS} · FAIL ${c.FAIL} · AMBIGUOUS ${c.AMBIGUOUS} · HUMAN ${c.HUMAN} · SKIP ${c.SKIP}`,
  )
  lines.push('')
  for (const v of run.verdicts) {
    lines.push(`### ${ICON[v.status]} ${v.id} · ${v.title} (tier ${v.tier})`)
    if (v.evidence.expected !== undefined) lines.push(`- expected: \`${JSON.stringify(v.evidence.expected)}\``)
    if (v.evidence.observed !== undefined) lines.push(`- observed: \`${JSON.stringify(v.evidence.observed)}\``)
    if (v.evidence.note) lines.push(`- note: ${v.evidence.note}`)
    lines.push('')
  }
  return lines.join('\n')
}

export interface EscalationPacket {
  version: string
  startedAt: string
  cases: Verdict[]
}

export function renderEscalation(run: RunResult): EscalationPacket {
  return {
    version: run.version,
    startedAt: run.startedAt,
    cases: run.verdicts.filter((v) => ESCALATED.includes(v.status)),
  }
}

/** Write report.md + escalation.json into `dir` (created if missing). */
export function writeRun(dir: string, run: RunResult): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'report.md'), renderMarkdown(run), 'utf8')
  writeFileSync(path.join(dir, 'escalation.json'), JSON.stringify(renderEscalation(run), null, 2), 'utf8')
}
