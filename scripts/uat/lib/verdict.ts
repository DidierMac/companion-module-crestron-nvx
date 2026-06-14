export type VerdictStatus = 'PASS' | 'FAIL' | 'AMBIGUOUS' | 'HUMAN' | 'SKIP'
export type Tier = 0 | 1 | 2

export interface Evidence {
  expected?: unknown
  observed?: unknown
  deviceJson?: unknown
  companion?: unknown
  note?: string
}

export interface Verdict {
  id: string
  title: string
  tier: Tier
  status: VerdictStatus
  evidence: Evidence
}

const make =
  (status: VerdictStatus) =>
  (id: string, title: string, tier: Tier, evidence: Evidence = {}): Verdict => ({
    id,
    title,
    tier,
    status,
    evidence,
  })

export const pass = make('PASS')
export const fail = make('FAIL')
export const ambiguous = make('AMBIGUOUS')
export const human = make('HUMAN')
export const skip = make('SKIP')

/** PASS if `actual === expected`, else FAIL with both recorded as evidence. */
export function assertEqual(
  id: string,
  title: string,
  tier: Tier,
  actual: unknown,
  expected: unknown,
  extra: Evidence = {},
): Verdict {
  return actual === expected
    ? pass(id, title, tier, { ...extra, expected, observed: actual })
    : fail(id, title, tier, { ...extra, expected, observed: actual })
}
