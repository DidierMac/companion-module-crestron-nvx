import { writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { Verdict, VerdictStatus, Evidence } from './verdict.js'
import type { RunResult } from './case.js'

const ESCALATED: VerdictStatus[] = ['FAIL', 'AMBIGUOUS', 'HUMAN']

const SENSITIVE = /pass(word)?|secret|token|cookie|sessionid|authorization|api[_-]?key/i

/** Recursively mask values whose KEY looks sensitive, so secrets in evidence
 *  (device/Companion JSON dumps) never reach report.md or escalation.json.
 *  ⚠️ Masque par CLÉ uniquement (pass/token/cookie/…). Un secret apparaissant
 *  comme VALEUR sous une clé non sensible (ex. dans une string `note`) n'est
 *  PAS masqué — la non-fuite repose alors sur la discipline amont (api.ts
 *  n'interpole jamais de secret dans ses messages d'erreur). */
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

const MAX_OBSERVED = 200

/** JSON compact, tronqué au-delà de MAX_OBSERVED — l'évidence complète vit dans details.json. */
function compactJson(value: unknown): string {
  const s = JSON.stringify(value)
  return s.length > MAX_OBSERVED
    ? `${s.slice(0, MAX_OBSERVED)}… (truncated — full evidence in details.json)`
    : s
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
    lines.push(`### ${ICON[v.status]} ${v.id} · ${v.title}`)
    if (ev.expected !== undefined) lines.push(`- expected: \`${JSON.stringify(ev.expected)}\``)
    if (ev.observed !== undefined) lines.push(`- observed: \`${compactJson(ev.observed)}\``)
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

export interface DetailRecord {
  id: string
  status: VerdictStatus
  evidence: Evidence
}

/** Évidence complète (redactée) de TOUS les verdicts — l'artefact détaillé que le .md résume. */
export function renderDetails(run: RunResult): DetailRecord[] {
  return run.verdicts.map((v) => ({
    id: v.id,
    status: v.status,
    evidence: redact(v.evidence) as Evidence,
  }))
}

/** Résout le prochain dossier de run : `<baseDir>/<date>#<NN>-<moduleTag>`.
 *  NN s'incrémente par jour (01→99), tous modules confondus, pour préserver l'ordre
 *  chronologique des runs (RX puis TX d'un même créneau → #01 puis #02). Le premier
 *  run d'un jour démarre à 01 (baseDir absent ou aucun dossier du jour → max=0 → 01). */
export function resolveRunDir(baseDir: string, date: string, moduleTag: string): string {
  let max = 0
  try {
    for (const name of readdirSync(baseDir)) {
      const m = name.match(new RegExp(`^${date}#(\\d{2})-`))
      if (m) max = Math.max(max, Number(m[1]))
    }
  } catch {
    /* baseDir absent → premier run du jour */
  }
  const nn = String(max + 1).padStart(2, '0')
  return path.join(baseDir, `${date}#${nn}-${moduleTag}`)
}

/** Write report.md + escalation.json + details.json into `dir` (created if missing). */
export function writeRun(dir: string, run: RunResult): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'report.md'), renderMarkdown(run), 'utf8')
  writeFileSync(path.join(dir, 'escalation.json'), JSON.stringify(renderEscalation(run), null, 2), 'utf8')
  writeFileSync(path.join(dir, 'details.json'), JSON.stringify(renderDetails(run), null, 2), 'utf8')
}
