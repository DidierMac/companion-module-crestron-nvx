import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { UatCase, HarnessConfig, RunResult, RunContext } from './lib/case.js'
import type { Tier, Verdict } from './lib/verdict.js'
import { writeRun } from './lib/report.js'
import { authCases } from './cases/auth.js'
import { encoderCases } from './cases/encoder.js'

const PHASE_ORDER: Record<UatCase['phase'], number> = { auth: 0, read: 1, ui: 2, disruptive: 3 }

/** Stable sort by docs/UAT.md phase order (auth → read → ui → disruptive). */
export function orderCases(cases: UatCase[]): UatCase[] {
  return [...cases].sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase])
}

export function selectByTiers(cases: UatCase[], tiers: Tier[]): UatCase[] {
  return cases.filter((c) => tiers.includes(c.tier))
}

export function loadConfig(env: NodeJS.ProcessEnv): HarnessConfig {
  const tiers = (env.UAT_TIERS ?? '0,1,2')
    .split(',')
    .map((s) => Number(s.trim()) as Tier)
    .filter((n) => n === 0 || n === 1 || n === 2)
  return {
    nvxHost: env.NVX_HOST ?? '192.168.2.9',
    nvxPort: Number(env.NVX_PORT ?? '443'),
    nvxUser: env.NVX_USER ?? 'admin',
    nvxPass: env.NVX_PASS ?? '',
    companionUrl: env.COMPANION_URL ?? 'http://localhost:8000',
    companionApiKey: env.COMPANION_API_KEY,
    tiers,
  }
}

/** Run selected+ordered cases sequentially (sequential = lockout-safe). */
export async function runCases(cases: UatCase[], ctx: RunContext): Promise<Verdict[]> {
  const verdicts: Verdict[] = []
  for (const c of orderCases(selectByTiers(cases, ctx.config.tiers))) {
    try {
      verdicts.push(await c.run(ctx))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      verdicts.push({ id: c.id, title: c.title, tier: c.tier, status: 'FAIL', evidence: { note: `threw: ${msg}` } })
    }
  }
  return verdicts
}

// Registry populated by wave. Wave 2 adds Tier 0 cases.
export const allCases: UatCase[] = [...authCases, ...encoderCases]

async function main(): Promise<void> {
  const config = loadConfig(process.env)
  const ctx: RunContext = { config }
  const verdicts = await runCases(allCases, ctx)
  const startedAt = new Date().toISOString()
  const version = process.env.UAT_VERSION ?? 'dev'
  const run: RunResult = { startedAt, version, verdicts }
  const dir = path.join('docs/uat-runs', `${startedAt.slice(0, 10)}-${version}`)
  writeRun(dir, run)
  const failed = verdicts.filter((v) => v.status === 'FAIL').length
  console.log(`UAT ${version}: ${verdicts.length} cases, ${failed} FAIL → ${dir}`)
  process.exitCode = failed > 0 ? 1 : 0
}

// Only run main() when executed directly, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
}
