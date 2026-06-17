import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeRun, resolveRunDir } from '../lib/report.js'
import type { RunResult, HarnessConfig } from '../lib/case.js'
import type { Verdict } from '../lib/verdict.js'
import { CompanionHttp } from '../tools/companion-http.js'
import { CompanionLogs } from '../tools/companion-logs.js'
import { Oracle } from '../tools/oracle.js'
import { CompanionUi } from '../tools/chromium.js'
import { makeClient } from '../tiers/tier0-logic.js'
import { ensureConnection } from '../tools/ensure-connection.js'
import { localSteps } from './steps-local.js'
import { labSteps } from './steps-lab.js'
import type { JourneyContext, JourneyConfig, JourneyStep, ButtonRef } from './types.js'

const LAYOUT_FILE = 'scripts/uat/fixtures/layout.json'

/** Load the button layout: UAT_LAYOUT env (JSON) wins, else the fixture file. `_`-keys dropped. */
export function loadLayout(env: NodeJS.ProcessEnv): Record<string, ButtonRef> | undefined {
  let raw: string | undefined = env.UAT_LAYOUT
  const fromEnv = !!raw
  if (!raw) {
    try {
      raw = readFileSync(LAYOUT_FILE, 'utf8')
    } catch {
      return undefined
    }
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const layout: Record<string, ButtonRef> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (k.startsWith('_')) continue
      layout[k] = v as ButtonRef
    }
    return layout
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    if (fromEnv) {
      throw new Error(`UAT_LAYOUT contains invalid JSON — parse failed: ${detail}`)
    }
    // Fixture file malformed — treat as absent (fixture is optional and may be stale).
    return undefined
  }
}

export function loadJourneyConfig(env: NodeJS.ProcessEnv): JourneyConfig {
  const isLab = env.UAT_LAB === '1'
  if (isLab && !env.NVX_USER) {
    throw new Error('NVX_USER required in lab mode — set it explicitly to avoid silently falling back to admin')
  }
  return {
    companionUrl: env.COMPANION_URL ?? 'http://localhost:8000',
    container: env.COMPANION_CONTAINER ?? 'companion-nvx-companion-1',
    label: env.UAT_LABEL ?? 'nvx-uat',
    nvxHost: env.NVX_HOST ?? '192.0.2.1',
    nvxPort: Number(env.NVX_PORT ?? 443),
    nvxUser: env.NVX_USER ?? 'admin',
    nvxPass: env.NVX_PASS ?? '',
    isFake: env.UAT_FAKE === '1',
    oracleHost: env.ORACLE_HOST,
    layout: loadLayout(env),
  }
}

export function buildContext(cfg: JourneyConfig): JourneyContext {
  const harness: HarnessConfig = {
    nvxHost: cfg.oracleHost ?? cfg.nvxHost, // oracle (host process) may reach the device differently
    nvxPort: cfg.nvxPort,
    nvxUser: cfg.nvxUser,
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

/** Delete any existing test connection, then create a fresh one fully configured and enabled. */
export async function ensureFreshConnection(ctx: JourneyContext): Promise<void> {
  const existing = await ctx.http.findConnectionId(ctx.config.label)
  const page = await ctx.ui.open()
  try {
    if (existing) await ctx.ui.deleteConnectionViaUi(page, existing)
    await ensureConnection(
      { http: ctx.http, ui: ctx.ui, page },
      ctx.config.label,
      { host: ctx.config.nvxHost, port: ctx.config.nvxPort, username: ctx.config.nvxUser, password: ctx.config.nvxPass },
    )
  } finally {
    await ctx.ui.close()
  }
}

/** Delete the test connection (exit cleanup), leaving a clean slate for the next run. */
export async function removeConnection(ctx: JourneyContext): Promise<void> {
  const id = await ctx.http.findConnectionId(ctx.config.label)
  if (!id) return
  const page = await ctx.ui.open()
  try {
    await ctx.ui.deleteConnectionViaUi(page, id)
  } finally {
    await ctx.ui.close()
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

/** Tag module pour le nom du dossier de run : `UAT_MODULE` explicite, sinon dérivé du
 *  label (`…-rx` → Rx, `…-tx` → Tx), sinon `journey` (run générique / mode local). */
export function deriveModule(env: NodeJS.ProcessEnv): string {
  if (env.UAT_MODULE) return env.UAT_MODULE
  const label = (env.UAT_LABEL ?? '').toLowerCase()
  if (/(^|[-_])rx$/.test(label) || label.includes('-rx')) return 'Rx'
  if (/(^|[-_])tx$/.test(label) || label.includes('-tx')) return 'Tx'
  return 'journey'
}

async function main(): Promise<void> {
  const cfg = loadJourneyConfig(process.env)
  const ctx = buildContext(cfg)

  const provision = process.env.UAT_PROVISION === '1'
  // Self-provision the test connection (delete-if-exists + create) unless UAT_KEEP=1.
  // UAT_PROVISION=1 → idempotent ensure (no delete) + implicit keep=true.
  let keep = process.env.UAT_KEEP === '1'
  if (provision) {
    keep = true
    const page = await ctx.ui.open()
    try {
      console.log(`[provision] ${cfg.label}: provisioning connection…`)
      await ensureConnection(
        { http: ctx.http, ui: ctx.ui, page },
        cfg.label,
        { host: cfg.nvxHost, port: cfg.nvxPort, username: cfg.nvxUser, password: cfg.nvxPass },
      )
      console.log(`[provision] ${cfg.label}: done`)
    } finally {
      await ctx.ui.close()
    }
  } else if (!keep) {
    await ensureFreshConnection(ctx)
  }

  const steps = process.env.UAT_LAB === '1' ? [...localSteps, ...labSteps] : localSteps
  const verdicts = await runJourney(steps, ctx)
  const startedAt = new Date().toISOString()
  const run: RunResult = { startedAt, version: process.env.UAT_VERSION ?? 'journey', verdicts }
  const moduleTag = deriveModule(process.env)
  const dir = resolveRunDir('docs/uat-runs', startedAt.slice(0, 10), moduleTag)
  writeRun(dir, run)

  // Exit cleanup: remove the test connection so the next run starts at zero (unless UAT_KEEP=1).
  if (!keep) await removeConnection(ctx)

  const failed = verdicts.filter((v) => v.status === 'FAIL').length
  console.log(`UAT journey: ${verdicts.length} steps, ${failed} FAIL → ${dir}`)
  process.exitCode = failed > 0 ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
}
