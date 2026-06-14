import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Verdict, VerdictStatus } from './verdict.js'
import type { RunResult } from './case.js'

const ESCALATED: VerdictStatus[] = ['FAIL', 'AMBIGUOUS', 'HUMAN']

const SENSITIVE = /pass(word)?|secret|token|cookie|sessionid|authorization|api[_-]?key/i

/** Recursively mask values whose KEY looks sensitive, so secrets in evidence
 *  (device/Companion JSON dumps) never reach report.md or escalation.json. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? '***' : redact(v)
    }
    return out
  }
  return value
}

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
    const ev = redact(v.evidence) as typeof v.evidence
    lines.push(`### ${ICON[v.status]} ${v.id} · ${v.title} (tier ${v.tier})`)
    if (ev.expected !== undefined) lines.push(`- expected: \`${JSON.stringify(ev.expected)}\``)
    if (ev.observed !== undefined) lines.push(`- observed: \`${JSON.stringify(ev.observed)}\``)
    if (ev.note) lines.push(`- note: ${ev.note}`)
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
    cases: run.verdicts
      .filter((v) => ESCALATED.includes(v.status))
      .map((v) => ({ ...v, evidence: redact(v.evidence) as typeof v.evidence })),
  }
}

/** Write report.md + escalation.json into `dir` (created if missing). */
export function writeRun(dir: string, run: RunResult): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'report.md'), renderMarkdown(run), 'utf8')
  writeFileSync(path.join(dir, 'escalation.json'), JSON.stringify(renderEscalation(run), null, 2), 'utf8')
}
