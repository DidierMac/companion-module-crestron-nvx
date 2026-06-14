import type { Verdict, Tier } from './verdict.js'

export interface HarnessConfig {
  nvxHost: string
  nvxPort: number
  nvxUser: string
  nvxPass: string // from NVX_PASS env; never logged in full
  companionUrl: string
  companionApiKey?: string
  tiers: Tier[] // legacy field; the journey selects by step scope, not tiers
}

export interface RunResult {
  startedAt: string // ISO timestamp, injected by the orchestrator
  version: string
  verdicts: Verdict[]
}
