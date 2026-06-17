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
  nvxHost: string // device host as the MODULE reaches it (real IP, or host.docker.internal for the fake)
  nvxPort: number // device HTTPS port (443 real; 8443 for the local fake)
  nvxUser: string // device username (NVX_USER; defaults to 'admin' — the fake's account)
  nvxPass: string // empty → lab-only steps SKIP
  /** True when the oracle target is the local fake-device (supports /_control/scenario).
   *  False (default) on a real NVX — scenario-dependent steps SKIP instead of calling the route. */
  isFake?: boolean
  /** Device host as the ORACLE (host process) reaches it. Defaults to nvxHost; differs only for
   *  the local fake (module → host.docker.internal, oracle → 127.0.0.1). */
  oracleHost?: string
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
