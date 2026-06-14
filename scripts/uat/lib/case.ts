import type { Verdict, Tier } from './verdict.js'
import type { NvxApiClient } from '../../../src/api.js'

/** Phases map to docs/UAT.md ordering: auth gauntlet first, disruptive last. */
export type Phase = 'auth' | 'read' | 'write' | 'ui' | 'disruptive'

export interface HarnessConfig {
  nvxHost: string
  nvxPort: number
  nvxUser: string
  nvxPass: string // from NVX_PASS env; never logged in full
  companionUrl: string
  companionApiKey?: string
  tiers: Tier[] // which tiers to run (default [0,1,2])
}

export interface RunContext {
  config: HarnessConfig
  /** Optional client factory for tests (DI). Defaults to makeClient. */
  clientFactory?: (config: HarnessConfig) => NvxApiClient
}

export interface UatCase {
  id: string
  title: string
  tier: Tier
  phase: Phase
  /** True if the case needs a physical human action (always escalated). */
  human?: boolean
  run(ctx: RunContext): Promise<Verdict>
}

export interface RunResult {
  startedAt: string // ISO timestamp, injected by the orchestrator
  version: string
  verdicts: Verdict[]
}
