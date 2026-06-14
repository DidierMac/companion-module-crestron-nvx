import type { EscalationPacket } from './report.js'
import type { Verdict, VerdictStatus } from './verdict.js'

/** An LLM adjudication for one escalated case. */
export interface LlmVerdict {
  id: string
  status: VerdictStatus
  reason?: string
}

/**
 * Build a prompt asking an LLM to adjudicate the escalated (FAIL/AMBIGUOUS/HUMAN) cases from
 * an EscalationPacket. The LLM sees only the redacted evidence and must reply as JSON.
 */
export function buildEscalationPrompt(packet: EscalationPacket): string {
  const lines: string[] = []
  lines.push(`You are adjudicating UAT results for "${packet.version}" (started ${packet.startedAt}).`)
  lines.push('For each case, decide a FINAL status based ONLY on the evidence:')
  lines.push('- PASS — the evidence shows the expected behaviour.')
  lines.push('- FAIL — the evidence shows a real defect.')
  lines.push('- HUMAN — the evidence is insufficient; a person must check.')
  lines.push('Reply as JSON: [{ "id": "...", "status": "PASS|FAIL|HUMAN", "reason": "..." }]')
  lines.push('')
  for (const c of packet.cases) {
    lines.push(`## ${c.id} — ${c.title} (current: ${c.status})`)
    lines.push('```json')
    lines.push(JSON.stringify(c.evidence, null, 2))
    lines.push('```')
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Merge LLM adjudications into the original verdicts, by id. An original verdict with a matching
 * LLM entry takes the LLM status (note annotated); others are kept unchanged. LLM entries with no
 * matching id are ignored.
 */
export function mergeVerdicts(original: Verdict[], llm: LlmVerdict[]): Verdict[] {
  const byId = new Map(llm.map((l) => [l.id, l]))
  return original.map((v) => {
    const l = byId.get(v.id)
    if (!l) return v
    const llmNote = `LLM: ${l.status}${l.reason ? ` — ${l.reason}` : ''}`
    const note = [v.evidence.note, llmNote].filter(Boolean).join(' | ')
    return { ...v, status: l.status, evidence: { ...v.evidence, note } }
  })
}
