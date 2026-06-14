import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeRun } from '../lib/report.js'
import type { RunResult, HarnessConfig } from '../lib/case.js'
import type { Verdict } from '../lib/verdict.js'
import { CompanionHttp } from '../tools/companion-http.js'
import { CompanionLogs } from '../tools/companion-logs.js'
import { Oracle } from '../tools/oracle.js'
import { CompanionUi } from '../tools/chromium.js'
import { makeClient } from '../tiers/tier0-logic.js'
import { localSteps } from './steps-local.js'
import { labSteps } from './steps-lab.js'
import type { JourneyContext, JourneyConfig, JourneyStep } from './types.js'

export function loadJourneyConfig(env: NodeJS.ProcessEnv): JourneyConfig {
  return {
    companionUrl: env.COMPANION_URL ?? 'http://localhost:8000',
    container: env.COMPANION_CONTAINER ?? 'companion-nvx-companion-1',
    label: env.UAT_LABEL ?? 'nvx-uat',
    nvxHost: env.NVX_HOST ?? '192.0.2.1',
    nvxPass: env.NVX_PASS ?? '',
  }
}

export function buildContext(cfg: JourneyConfig): JourneyContext {
  const harness: HarnessConfig = {
    nvxHost: cfg.nvxHost,
    nvxPort: 443,
    nvxUser: 'admin',
    nvxPass: cfg.nvxPass,
    companionUrl: cfg.companionUrl,
    tiers: [0],
  }
  return {
    config: cfg,
    http: new CompanionHttp(cfg.companionUrl),
    logs: new CompanionLogs(cfg.container),
    oracle: new Oracle(() => makeClient(harness)),
    ui: new CompanionUi(cfg.companionUrl),
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}

export async function runJourney(steps: JourneyStep[], ctx: JourneyContext): Promise<Verdict[]> {
  const verdicts: Verdict[] = []
  for (const s of steps) {
    try {
      verdicts.push(await s.run(ctx))
    } catch (err) {
      verdicts.push({
        id: s.id,
        title: s.title,
        tier: 1,
        status: 'FAIL',
        evidence: { note: `threw: ${err instanceof Error ? err.message : String(err)}` },
      })
    }
  }
  return verdicts
}

async function main(): Promise<void> {
  const cfg = loadJourneyConfig(process.env)
  const ctx = buildContext(cfg)
  const steps = process.env.UAT_LAB === '1' ? [...localSteps, ...labSteps] : localSteps
  const verdicts = await runJourney(steps, ctx)
  const startedAt = new Date().toISOString()
  const run: RunResult = { startedAt, version: process.env.UAT_VERSION ?? 'journey', verdicts }
  const dir = path.join('docs/uat-runs', `${startedAt.slice(0, 10)}-journey`)
  writeRun(dir, run)
  const failed = verdicts.filter((v) => v.status === 'FAIL').length
  console.log(`UAT journey: ${verdicts.length} steps, ${failed} FAIL → ${dir}`)
  process.exitCode = failed > 0 ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
}
