import type { Verdict } from '../lib/verdict.js'
import type { CompanionHttp } from '../tools/companion-http.js'
import type { CompanionLogs } from '../tools/companion-logs.js'
import type { Oracle } from '../tools/oracle.js'
import type { CompanionUi } from '../tools/chromium.js'

/** A Companion button location (grid coordinates), used to trigger module actions. */
export interface ButtonRef {
  page: number
  row: number
  col: number
}

export interface JourneyConfig {
  companionUrl: string
  container: string // docker container name for logs
  label: string // connection label under test
  nvxHost: string
  nvxPass: string // empty → lab-only steps SKIP
  /** Action id → button location. WRITE (USE) steps press these; unmapped → step SKIPs. */
  layout?: Record<string, ButtonRef>
}

export interface JourneyContext {
  config: JourneyConfig
  http: CompanionHttp
  logs: CompanionLogs
  oracle: Oracle
  ui: CompanionUi
  /** Bounded-wait primitive (real setTimeout in prod, instant in tests). */
  sleep: (ms: number) => Promise<void>
}

export interface JourneyStep {
  id: string
  title: string
  scope: 'local' | 'lab'
  run(ctx: JourneyContext): Promise<Verdict>
}
