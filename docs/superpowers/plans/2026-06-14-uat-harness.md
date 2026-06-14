# UAT Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fast, deterministic, scriptable UAT harness for the Crestron NVX Companion module that runs the `docs/UAT.md` scenarios across three tiers (Node logic, Companion API, Playwright UI) and escalates the residue (FAIL/AMBIGUOUS/HUMAN) to the `uat-runner` LLM.

**Architecture:** A dedicated orchestrator (`scripts/uat/run.ts`, no `node:test`) sequences cases in the non-negotiable `docs/UAT.md` order. Each case is a function returning a `Verdict`. Tier 0 drives `NvxApiClient` directly against the device; Tier 1 drives Companion's HTTP API + Satellite TCP; Tier 2 drives Playwright (library). The run emits `report.md` (human) + `escalation.json` (machine, for the LLM). The harness itself is TDD-unit-tested with `node:test`.

**Tech Stack:** TypeScript strict, Node 22, `node:test` via `scripts/ts-resolver.mjs`, native `node:net`/`fetch`, `playwright` (library, Wave 4 devDependency). Reuses `src/api.ts` + `src/config.ts` unchanged.

**Reference spec:** `docs/superpowers/specs/2026-06-14-uat-harness-design.md` (commit d56a7bc).

---

## File Structure

**New (Wave 1):**
- `scripts/uat/lib/verdict.ts` — `Verdict`, `VerdictStatus`, evidence type; constructors (`pass`/`fail`/`ambiguous`/`human`/`skip`) + `assertEqual` helper.
- `scripts/uat/lib/report.ts` — `renderMarkdown`, `renderEscalation`, `writeRun` (emits `report.md` + `escalation.json`).
- `scripts/uat/lib/case.ts` — `UatCase` interface + `RunContext` + `RunResult` types.
- `scripts/uat/run.ts` — orchestrator: load env config, build case registry, run in UAT.md order, write report.
- Tests: `scripts/uat/lib/verdict.test.ts`, `scripts/uat/lib/report.test.ts`.

**New (Wave 2):**
- `scripts/uat/tiers/tier0-logic.ts` — helpers to drive `NvxApiClient` + device GET cross-check.
- `scripts/uat/cases/auth.ts` — A1/A2/A3 cases.
- `scripts/uat/cases/encoder.ts` — ENC-01/02/03/05, C2, C3 cases.
- Tests: `scripts/uat/cases/auth.test.ts`, `scripts/uat/cases/encoder.test.ts`.

**New (Wave 3):**
- `scripts/uat/lib/companion-http.ts` — HTTP client for `/api/...`.
- `scripts/uat/lib/satellite-client.ts` — TCP Satellite client + `KEY-STATE` parser.
- `scripts/uat/cases/companion.ts` — CAP-01, ENC-06, B1–B3 cases.
- `uat/layout.json` — committed, secret-free button-map + connection label.
- `uat/companion-page.companionconfig` — committed Companion page export.
- `docs/uat-runs/SETUP.md` — one-time operator runbook.
- `scripts/uat/fixtures/satellite-frames/` — captured real Satellite frames (discovery output).
- Tests: `scripts/uat/lib/companion-http.test.ts`, `scripts/uat/lib/satellite-client.test.ts`.

**New (Wave 4):**
- `scripts/uat/tiers/tier2-ui.ts` — Playwright config-form cases UI-01..06.
- `scripts/uat/lib/escalate.ts` — feed `escalation.json` to `uat-runner`, merge verdicts.

**Modified:**
- `package.json` — add `uat` / `uat:tier0` scripts (Wave 1); add `playwright` devDependency (Wave 4); extend the test glob to include `scripts/uat/**/*.test.ts` (Wave 1).

**Test command (harness unit tests):** `npm test` — the glob must cover `scripts/uat/**/*.test.ts` (see Task 1). The `pretest` hook (`tsc -p tsconfig.json --noEmit`) typechecks everything, so `tsconfig.json` must `include` `scripts/` (verify in Task 1).

---

## Wave 1 — Foundation (zero-install, zero-device)

### Task 1: Wire the test runner + typecheck for `scripts/uat/`

**Files:**
- Modify: `package.json` (test glob + uat scripts)
- Modify: `tsconfig.json` (ensure `scripts/` is in `include`)

- [ ] **Step 1: Confirm tsconfig includes scripts**

Run: `node -e "const c=require('./tsconfig.json'); console.log(JSON.stringify(c.include||c.files||'no-include'))"`
Expected: prints the `include` array. If `scripts/` (or `scripts/**/*`) is absent, add it so the `pretest` typecheck covers the new files. If the project uses no `include` (compiles everything), no change needed — note which case applies.

- [ ] **Step 2: Extend the test glob + add uat scripts**

In `package.json` `scripts`, change `test` to also match the harness tests, and add the uat entry points:

```json
"test": "node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs --test src/*.test.ts src/**/*.test.ts scripts/uat/**/*.test.ts",
"uat": "node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs scripts/uat/run.ts",
"uat:tier0": "UAT_TIERS=0 node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs scripts/uat/run.ts",
```

- [ ] **Step 3: Verify existing tests still pass**

Run: `npm test`
Expected: pretest typecheck PASS + existing 44 tests PASS; the new glob matches zero harness tests for now (fine).

- [ ] **Step 4: Commit**

```bash
git add package.json tsconfig.json
git commit -m "chore(uat): wire test glob + uat run scripts for scripts/uat"
```

---

### Task 2: Verdict model

**Files:**
- Create: `scripts/uat/lib/verdict.ts`
- Test: `scripts/uat/lib/verdict.test.ts`

- [ ] **Step 1: Write the failing test**

`scripts/uat/lib/verdict.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pass, fail, ambiguous, human, skip, assertEqual } from './verdict.js'

test('pass builds a PASS verdict', () => {
  const v = pass('A3', 'good login', 0, { note: 'HTTP 200' })
  assert.equal(v.status, 'PASS')
  assert.equal(v.id, 'A3')
  assert.equal(v.tier, 0)
  assert.equal(v.evidence.note, 'HTTP 200')
})

test('fail carries expected vs observed evidence', () => {
  const v = fail('ENC-01', 'stream name', 0, { expected: 'X', observed: 'Y' })
  assert.equal(v.status, 'FAIL')
  assert.equal(v.evidence.expected, 'X')
  assert.equal(v.evidence.observed, 'Y')
})

test('ambiguous / human / skip set their status', () => {
  assert.equal(ambiguous('ENC-02', 'inferred POST', 0, {}).status, 'AMBIGUOUS')
  assert.equal(human('C1', 'physical drop', 0, {}).status, 'HUMAN')
  assert.equal(skip('CAP-01', 'device is Receiver', 1, {}).status, 'SKIP')
})

test('assertEqual → PASS on strict equality', () => {
  const v = assertEqual('B2', 'firmware', 1, '7.1.5259.00090', '7.1.5259.00090')
  assert.equal(v.status, 'PASS')
})

test('assertEqual → FAIL with evidence on mismatch', () => {
  const v = assertEqual('B2', 'firmware', 1, '7.0.0', '7.1.5259.00090')
  assert.equal(v.status, 'FAIL')
  assert.equal(v.evidence.expected, '7.1.5259.00090')
  assert.equal(v.evidence.observed, '7.0.0')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './verdict.js'`.

- [ ] **Step 3: Write the implementation**

`scripts/uat/lib/verdict.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/uat/lib/verdict.ts scripts/uat/lib/verdict.test.ts
git commit -m "feat(uat): verdict model (PASS/FAIL/AMBIGUOUS/HUMAN/SKIP) + assertEqual"
```

---

### Task 3: Case + run types

**Files:**
- Create: `scripts/uat/lib/case.ts`

- [ ] **Step 1: Write the types**

`scripts/uat/lib/case.ts`:

```ts
import type { Verdict, Tier } from './verdict.js'

/** Phases map to docs/UAT.md ordering: auth gauntlet first, disruptive last. */
export type Phase = 'auth' | 'read' | 'ui' | 'disruptive'

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
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build && npm test`
Expected: build PASS, tests still PASS (pure types, no runtime test).

- [ ] **Step 3: Commit**

```bash
git add scripts/uat/lib/case.ts
git commit -m "feat(uat): UatCase + RunContext + RunResult contracts"
```

---

### Task 4: Report emitters (report.md + escalation.json)

**Files:**
- Create: `scripts/uat/lib/report.ts`
- Test: `scripts/uat/lib/report.test.ts`

- [ ] **Step 1: Write the failing test**

`scripts/uat/lib/report.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown, renderEscalation } from './report.js'
import { pass, fail, human } from './verdict.js'
import type { RunResult } from './case.js'

const run: RunResult = {
  startedAt: '2026-06-14T10:00:00.000Z',
  version: 'v0.2',
  verdicts: [
    pass('A3', 'good login', 0, { note: 'HTTP 200' }),
    fail('ENC-01', 'stream name', 0, { expected: 'X', observed: 'Y' }),
    human('C1', 'physical drop', 0, {}),
  ],
}

test('renderMarkdown includes a header, counts, and one row per verdict', () => {
  const md = renderMarkdown(run)
  assert.match(md, /v0\.2/)
  assert.match(md, /PASS.*1/s)
  assert.match(md, /A3/)
  assert.match(md, /ENC-01/)
  assert.match(md, /C1/)
})

test('renderEscalation keeps only FAIL/AMBIGUOUS/HUMAN with full evidence', () => {
  const pkt = renderEscalation(run)
  assert.equal(pkt.cases.length, 2) // ENC-01 (FAIL) + C1 (HUMAN); A3 PASS excluded
  const ids = pkt.cases.map((c) => c.id).sort()
  assert.deepEqual(ids, ['C1', 'ENC-01'])
  const enc = pkt.cases.find((c) => c.id === 'ENC-01')!
  assert.equal(enc.evidence.expected, 'X')
  assert.equal(enc.evidence.observed, 'Y')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './report.js'`.

- [ ] **Step 3: Write the implementation**

`scripts/uat/lib/report.ts`:

```ts
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Verdict, VerdictStatus } from './verdict.js'
import type { RunResult } from './case.js'

const ESCALATED: VerdictStatus[] = ['FAIL', 'AMBIGUOUS', 'HUMAN']

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
    lines.push(`### ${ICON[v.status]} ${v.id} · ${v.title} (tier ${v.tier})`)
    if (v.evidence.expected !== undefined) lines.push(`- expected: \`${JSON.stringify(v.evidence.expected)}\``)
    if (v.evidence.observed !== undefined) lines.push(`- observed: \`${JSON.stringify(v.evidence.observed)}\``)
    if (v.evidence.note) lines.push(`- note: ${v.evidence.note}`)
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
    cases: run.verdicts.filter((v) => ESCALATED.includes(v.status)),
  }
}

/** Write report.md + escalation.json into `dir` (created if missing). */
export function writeRun(dir: string, run: RunResult): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'report.md'), renderMarkdown(run), 'utf8')
  writeFileSync(path.join(dir, 'escalation.json'), JSON.stringify(renderEscalation(run), null, 2), 'utf8')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/uat/lib/report.ts scripts/uat/lib/report.test.ts
git commit -m "feat(uat): report emitters — report.md + escalation.json (FAIL/AMBIGUOUS/HUMAN)"
```

---

### Task 5: Orchestrator skeleton

**Files:**
- Create: `scripts/uat/run.ts`
- Test: `scripts/uat/run.test.ts`

- [ ] **Step 1: Write the failing test**

`scripts/uat/run.test.ts` — test the pure ordering + selection logic (not the side-effecting main):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderCases, selectByTiers } from './run.js'
import type { UatCase } from './lib/case.js'

const stub = (id: string, tier: 0 | 1 | 2, phase: UatCase['phase']): UatCase => ({
  id,
  title: id,
  tier,
  phase,
  run: async () => ({ id, title: id, tier, status: 'PASS', evidence: {} }),
})

test('orderCases: auth first, disruptive last, reads/ui in the middle', () => {
  const cases = [stub('C2', 0, 'disruptive'), stub('B1', 1, 'read'), stub('A1', 0, 'auth'), stub('UI-01', 2, 'ui')]
  const ordered = orderCases(cases).map((c) => c.id)
  assert.deepEqual(ordered, ['A1', 'B1', 'UI-01', 'C2'])
})

test('selectByTiers keeps only requested tiers', () => {
  const cases = [stub('A1', 0, 'auth'), stub('B1', 1, 'read'), stub('UI-01', 2, 'ui')]
  assert.deepEqual(selectByTiers(cases, [0]).map((c) => c.id), ['A1'])
  assert.deepEqual(selectByTiers(cases, [0, 1]).map((c) => c.id).sort(), ['A1', 'B1'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './run.js'`.

- [ ] **Step 3: Write the implementation**

`scripts/uat/run.ts`:

```ts
import path from 'node:path'
import type { UatCase, HarnessConfig, RunResult, RunContext } from './lib/case.js'
import type { Tier, Verdict } from './lib/verdict.js'
import { writeRun } from './lib/report.js'

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

// The registry is populated as waves land. Empty in Wave 1.
export const allCases: UatCase[] = []

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
if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
```

> Note on `new Date().toISOString()`: this runs only in `main()` (real execution), never in the pure tested functions — so tests stay deterministic.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (orderCases + selectByTiers tested; `main` is guarded by the `import.meta.url` check).

- [ ] **Step 5: Smoke-run the empty orchestrator**

Run: `npm run uat`
Expected: prints `UAT dev: 0 cases, 0 FAIL → docs/uat-runs/2026-...-dev` and writes an (empty) report.md + escalation.json there. Confirm the files exist, then `git clean -nd docs/uat-runs/` to see what was created (do NOT commit run artifacts — see Step 6).

- [ ] **Step 6: Ignore run artifacts + commit**

Add `docs/uat-runs/*/` run outputs to `.gitignore` (keep `docs/uat-runs/SETUP.md` tracked — added in Wave 3):

```
# UAT run artifacts (generated)
docs/uat-runs/*/
```

```bash
git add scripts/uat/run.ts scripts/uat/run.test.ts .gitignore
git commit -m "feat(uat): orchestrator skeleton — ordering, tier selection, env config, report emit"
```

---

## Wave 2 — Tier 0 (logic, zero-install)

> Tier 0 drives `NvxApiClient` directly. Device-dependent cases read `ctx.config` (NVX_HOST/NVX_PASS). When `nvxPass` is empty, device cases return `SKIP` (no device available) rather than failing — so the suite is runnable offline in CI for its pure parts.

### Task 6: Tier 0 device helper

**Files:**
- Create: `scripts/uat/tiers/tier0-logic.ts`
- Test: `scripts/uat/tiers/tier0-logic.test.ts`

- [ ] **Step 1: Write the failing test**

`scripts/uat/tiers/tier0-logic.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasDevice, makeClient } from './tier0-logic.js'
import type { HarnessConfig } from '../lib/case.js'

const cfg = (over: Partial<HarnessConfig> = {}): HarnessConfig => ({
  nvxHost: '192.168.2.9', nvxPort: 443, nvxUser: 'admin', nvxPass: '',
  companionUrl: 'http://localhost:8000', tiers: [0], ...over,
})

test('hasDevice is false when password is empty', () => {
  assert.equal(hasDevice(cfg()), false)
})

test('hasDevice is true when host + password are set', () => {
  assert.equal(hasDevice(cfg({ nvxPass: 'secret' })), true)
})

test('makeClient builds an NvxApiClient from harness config', () => {
  const client = makeClient(cfg({ nvxPass: 'secret' }))
  assert.equal(typeof client.login, 'function')
  assert.equal(typeof client.get, 'function')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './tier0-logic.js'`.

- [ ] **Step 3: Write the implementation**

`scripts/uat/tiers/tier0-logic.ts`. (Reuse `NvxApiClient`'s real constructor signature — VERIFY it against `src/api.ts` before writing; the snippet below assumes `new NvxApiClient(config, secrets, logger)` as used in `scripts/capture-nvx.ts`. If the signature differs, match the actual one.)

```ts
import { NvxApiClient } from '../../../src/api.js'
import { ModuleLogger } from '../../../src/logger.js'
import type { ModuleConfig, ModuleSecrets } from '../../../src/config.js'
import type { HarnessConfig } from '../lib/case.js'

export function hasDevice(config: HarnessConfig): boolean {
  return Boolean(config.nvxHost) && Boolean(config.nvxPass)
}

/** Build an NvxApiClient from harness config. Mirrors scripts/capture-nvx.ts wiring. */
export function makeClient(config: HarnessConfig, opts: { password?: string } = {}): NvxApiClient {
  const moduleConfig: ModuleConfig = {
    host: config.nvxHost,
    port: config.nvxPort,
    username: config.nvxUser,
    pollInterval: 2000,
    ignoreSelfSignedCert: true,
    verbose: false,
  }
  const secrets: ModuleSecrets = { password: opts.password ?? config.nvxPass }
  const logger = new ModuleLogger(() => {}, () => false) // silent; adjust to real ModuleLogger ctor
  return new NvxApiClient(moduleConfig, secrets, logger.child('[UAT]'))
}
```

> ⚠️ **Verify before implementing:** open `src/api.ts` and `src/logger.ts` and match the REAL constructor signatures of `NvxApiClient` and `ModuleLogger` (and `getConfigFields`/`ModuleLogger.child`). `scripts/capture-nvx.ts` already wires these correctly — copy its exact pattern. Do not invent ctor shapes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/uat/tiers/tier0-logic.ts scripts/uat/tiers/tier0-logic.test.ts
git commit -m "feat(uat): tier0 device helper — hasDevice + makeClient (reuses NvxApiClient)"
```

---

### Task 7: Auth-gauntlet cases (A1/A2/A3)

**Files:**
- Create: `scripts/uat/cases/auth.ts`
- Test: `scripts/uat/cases/auth.test.ts`

> **Lockout discipline (non-negotiable):** A2 performs EXACTLY ONE bad login and NEVER retries. The harness must not loop. A1 fires NO network call (BadConfig is a pure guard). A3 performs one good login (resets the device failure counter). Order is enforced by phase `auth` + array position.

- [ ] **Step 1: Write the failing test**

`scripts/uat/cases/auth.test.ts` — test A1 (pure, no network) deterministically; A2/A3 are device-gated and asserted structurally:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authA1, authCases } from './auth.js'
import type { RunContext } from '../lib/case.js'

const ctx = (nvxPass: string): RunContext => ({
  config: { nvxHost: '192.168.2.9', nvxPort: 443, nvxUser: 'admin', nvxPass, companionUrl: 'http://localhost:8000', tiers: [0] },
})

test('A1 (empty password) → PASS via the pure BadConfig guard, no network', async () => {
  // A1 uses missingCredential() from src/config.ts — empty password = BadConfig, zero network.
  const v = await authA1.run(ctx('')) // empty pass is exactly the A1 condition
  assert.equal(v.id, 'A1')
  assert.equal(v.status, 'PASS')
})

test('authCases are tagged auth phase, tier 0, in order A1,A2,A3', () => {
  assert.deepEqual(authCases.map((c) => c.id), ['A1', 'A2', 'A3'])
  assert.ok(authCases.every((c) => c.phase === 'auth' && c.tier === 0))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './auth.js'`.

- [ ] **Step 3: Write the implementation**

`scripts/uat/cases/auth.ts`. A1 reuses `missingCredential` from `src/config.ts` (the real BadConfig guard) — proving the *code's* guard, no network. A2/A3 hit the device only when `hasDevice`.

```ts
import { missingCredential, type ModuleConfig, type ModuleSecrets } from '../../../src/config.js'
import { NvxAuthError } from '../../../src/api.js'
import { hasDevice, makeClient } from '../tiers/tier0-logic.js'
import { pass, fail, skip } from '../lib/verdict.js'
import type { UatCase } from '../lib/case.js'

export const authA1: UatCase = {
  id: 'A1', title: 'AUTH-EMPTY → BadConfig, no network', tier: 0, phase: 'auth',
  run: async (ctx) => {
    const config: ModuleConfig = {
      host: ctx.config.nvxHost, port: ctx.config.nvxPort, username: ctx.config.nvxUser,
      pollInterval: 2000, ignoreSelfSignedCert: true, verbose: false,
    }
    const secrets: ModuleSecrets = { password: '' } // A1 = empty password
    const msg = missingCredential(config, secrets)
    return msg
      ? pass('A1', 'AUTH-EMPTY → BadConfig, no network', 0, { note: msg })
      : fail('A1', 'AUTH-EMPTY → BadConfig, no network', 0, { expected: 'BadConfig message', observed: null })
  },
}

export const authA2: UatCase = {
  id: 'A2', title: 'AUTH-WRONG → AuthenticationFailure, exactly 1 attempt', tier: 0, phase: 'auth',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('A2', 'no device (NVX_PASS unset)', 0, {})
    const client = makeClient(ctx.config, { password: `${ctx.config.nvxPass}_WRONG` }) // deliberately wrong
    try {
      await client.login() // EXACTLY ONE attempt. No retry, ever.
      return fail('A2', 'wrong password should be refused', 0, { observed: 'login succeeded' })
    } catch (err) {
      return err instanceof NvxAuthError
        ? pass('A2', 'AUTH-WRONG → AuthenticationFailure', 0, { note: err.message })
        : fail('A2', 'expected NvxAuthError', 0, { observed: String(err) })
    }
  },
}

export const authA3: UatCase = {
  id: 'A3', title: 'AUTH-GOOD → Connected (resets failure counter)', tier: 0, phase: 'auth',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('A3', 'no device (NVX_PASS unset)', 0, {})
    const client = makeClient(ctx.config) // correct password
    try {
      await client.login()
      return pass('A3', 'AUTH-GOOD → Connected', 0, { note: 'login OK (HTTP 200)' })
    } catch (err) {
      return fail('A3', 'good password should connect', 0, { observed: String(err) })
    }
  },
}

export const authCases: UatCase[] = [authA1, authA2, authA3]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (A1 runs the pure guard; A2/A3 structure asserted).

- [ ] **Step 5: Commit**

```bash
git add scripts/uat/cases/auth.ts scripts/uat/cases/auth.test.ts
git commit -m "feat(uat): auth-gauntlet cases A1/A2/A3 (1 bad login max, no retry)"
```

---

### Task 8: Encoder POST + read cases (ENC-01/02/03/05) + disruptive (C2/C3)

**Files:**
- Create: `scripts/uat/cases/encoder.ts`
- Test: `scripts/uat/cases/encoder.test.ts`

> **Anti-false-positive:** every ENC PASS cross-checks the device via `GET /Device/StreamTransmit` after the action — never the harness's own belief. ENC-02/03 are tagged AMBIGUOUS-on-uncertainty because the `MulticastAddress`/`Start`/`Stop` POSTs were inferred (not validated end-to-end at the gate) — see spec §3.

- [ ] **Step 1: Write the failing test**

`scripts/uat/cases/encoder.test.ts` — structural assertions (device cases gated):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encoderCases } from './encoder.js'

test('encoder cases are tier 0 with expected ids and phases', () => {
  const ids = encoderCases.map((c) => c.id)
  assert.deepEqual(ids, ['ENC-01', 'ENC-02', 'ENC-03', 'ENC-05', 'C2', 'C3'])
  const byId = Object.fromEntries(encoderCases.map((c) => [c.id, c]))
  assert.equal(byId['C2'].phase, 'disruptive')
  assert.equal(byId['C3'].phase, 'disruptive')
  assert.equal(byId['ENC-01'].phase, 'read')
  assert.ok(encoderCases.every((c) => c.tier === 0))
})

test('device cases SKIP when no device configured', async () => {
  const ctx = { config: { nvxHost: '192.168.2.9', nvxPort: 443, nvxUser: 'admin', nvxPass: '', companionUrl: '', tiers: [0] as const } }
  const enc01 = encoderCases.find((c) => c.id === 'ENC-01')!
  const v = await enc01.run(ctx as never)
  assert.equal(v.status, 'SKIP')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './encoder.js'`.

- [ ] **Step 3: Write the implementation**

`scripts/uat/cases/encoder.ts`. Reuse the encoder action bodies via `streamTransmitBody` from `src/panels/encoder.ts` and `postSetPartial` from the client, then cross-check with a device GET. (VERIFY the exact exported names in `src/panels/encoder.ts` and `src/api.ts` before writing.)

```ts
import { streamTransmitBody } from '../../../src/panels/encoder.js'
import { hasDevice, makeClient } from '../tiers/tier0-logic.js'
import { pass, fail, ambiguous, skip, assertEqual } from '../lib/verdict.js'
import type { UatCase, RunContext } from '../lib/case.js'

/** Login + GET StreamTransmit Streams[0]. Returns the parsed object or throws. */
async function streamTransmit0(ctx: RunContext): Promise<Record<string, unknown>> {
  const client = makeClient(ctx.config)
  await client.login()
  const json = (await client.get('/Device/StreamTransmit')) as {
    Device?: { StreamTransmit?: { Streams?: Array<Record<string, unknown>> } }
  }
  const s = json.Device?.StreamTransmit?.Streams?.[0]
  if (!s) throw new Error('Streams[0] absent')
  return s
}

const ENC01: UatCase = {
  id: 'ENC-01', title: 'set_stream_name changes RtspSessionName on the device', tier: 0, phase: 'read',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('ENC-01', 'no device (NVX_PASS unset)', 0, {})
    const client = makeClient(ctx.config)
    await client.login()
    const witness = 'UAT-STREAM-X'
    const status = await client.postSetPartial(streamTransmitBody(0, { RtspSessionName: witness }))
    if (status !== 0) return fail('ENC-01', 'POST RtspSessionName', 0, { note: `StatusId ${status}`, expected: 0, observed: status })
    const s = await streamTransmit0(ctx) // device cross-check
    return assertEqual('ENC-01', 'RtspSessionName on device', 0, s.RtspSessionName, witness, { deviceJson: s })
  },
}

const ENC02: UatCase = {
  id: 'ENC-02', title: 'set_multicast_address (INFERRED POST) changes MulticastAddress', tier: 0, phase: 'read',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('ENC-02', 'no device (NVX_PASS unset)', 0, {})
    const client = makeClient(ctx.config)
    await client.login()
    const witness = '239.9.9.9'
    const status = await client.postSetPartial(streamTransmitBody(0, { MulticastAddress: witness }))
    const s = await streamTransmit0(ctx)
    if (s.MulticastAddress === witness && status === 0) {
      return pass('ENC-02', 'MulticastAddress on device (inferred POST confirmed)', 0, { deviceJson: s, note: 'inferred POST CONFIRMED' })
    }
    // Inferred write: a mismatch is AMBIGUOUS (first real test of this field), not an outright FAIL.
    return ambiguous('ENC-02', 'MulticastAddress inferred POST — needs LLM/human confirmation', 0,
      { expected: witness, observed: s.MulticastAddress, note: `StatusId ${status}; inferred field` })
  },
}

const ENC03: UatCase = {
  id: 'ENC-03', title: 'enable/disable_stream (INFERRED POST) toggles Status', tier: 0, phase: 'read',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('ENC-03', 'no device (NVX_PASS unset)', 0, {})
    const client = makeClient(ctx.config)
    await client.login()
    const sStop = (await (async () => { await client.postSetPartial(streamTransmitBody(0, { Stop: true })); return streamTransmit0(ctx) })())
    const sStart = (await (async () => { await client.postSetPartial(streamTransmitBody(0, { Start: true })); return streamTransmit0(ctx) })())
    const ok = sStop.Status === 'Stream Stopped' && sStart.Status === 'Stream started'
    return ok
      ? pass('ENC-03', 'Start/Stop toggles Status (inferred POST confirmed)', 0, { note: 'transition observed', deviceJson: { sStop, sStart } })
      : ambiguous('ENC-03', 'Start/Stop inferred POST — needs LLM/human confirmation', 0,
          { expected: 'Stream Stopped → Stream started', observed: { stop: sStop.Status, start: sStart.Status } })
  },
}

const ENC05: UatCase = {
  id: 'ENC-05', title: 'encoder variables mirror the device Streams[0]', tier: 0, phase: 'read',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('ENC-05', 'no device (NVX_PASS unset)', 0, {})
    const s = await streamTransmit0(ctx)
    // readVariables is unit-tested elsewhere; here we assert the live device exposes the expected shape.
    const ok = typeof s.RtspSessionName === 'string' && 'MulticastAddress' in s && 'Status' in s
    return ok
      ? pass('ENC-05', 'device Streams[0] exposes name/multicast/status', 0, { deviceJson: s })
      : fail('ENC-05', 'device Streams[0] shape', 0, { observed: s })
  },
}

const C2: UatCase = {
  id: 'C2', title: 'unreachable host → connect fails fast, no module force-restart', tier: 0, phase: 'disruptive',
  run: async (ctx) => {
    // TEST-NET host (RFC5737) — network timeout, NOT a bad password (lockout budget = 0).
    const client = makeClient({ ...ctx.config, nvxHost: '192.0.2.1', nvxPass: ctx.config.nvxPass || 'x' })
    const t0 = Date.now()
    try { await client.login(); return fail('C2', 'unreachable host should not connect', 0, {}) }
    catch (err) {
      const ms = Date.now() - t0
      return pass('C2', 'unreachable host → fast failure', 0, { note: `failed in ${ms}ms: ${String(err)}` })
    }
  },
}

const C3: UatCase = {
  id: 'C3', title: 'logout emitted on teardown', tier: 0, phase: 'disruptive',
  run: async (ctx) => {
    if (!hasDevice(ctx.config)) return skip('C3', 'no device (NVX_PASS unset)', 0, {})
    const client = makeClient(ctx.config)
    await client.login()
    await client.logout() // VERIFY logout() exists on NvxApiClient; capture-nvx.ts / main.ts use it
    return pass('C3', 'logout emitted', 0, { note: 'logout() returned without error' })
  },
}

export const encoderCases: UatCase[] = [ENC01, ENC02, ENC03, ENC05, C2, C3]
```

> ⚠️ **Verify before implementing:** `client.get` / `client.postSetPartial` / `client.logout` signatures in `src/api.ts`, and `streamTransmitBody` export in `src/panels/encoder.ts`. `Date.now()` is allowed here (real harness runtime, not a workflow script).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (structure + SKIP-without-device asserted).

- [ ] **Step 5: Register Wave 2 cases in the orchestrator**

In `scripts/uat/run.ts`, populate the registry:

```ts
import { authCases } from './cases/auth.js'
import { encoderCases } from './cases/encoder.js'
export const allCases: UatCase[] = [...authCases, ...encoderCases]
```

(Replace the empty `allCases` from Task 5.)

- [ ] **Step 6: Verify + commit**

Run: `npm test && npm run uat`
Expected: tests PASS; `npm run uat` (no NVX_PASS) runs all Tier 0 cases → A1 PASS, A2/A3/ENC-*/C3 SKIP, C2 PASS. Report written.

```bash
git add scripts/uat/cases/encoder.ts scripts/uat/cases/encoder.test.ts scripts/uat/run.ts
git commit -m "feat(uat): tier0 encoder POST + read cases (ENC-01/02/03/05) + C2/C3, registered"
```

---

## Wave 3 — Tier 1 (Companion integration, local Companion required)

> **Empirical discovery first.** The Satellite `KEY-STATE` wire format and the Companion HTTP API auth behaviour must be observed against the LOCAL Companion (image `ghcr.io/bitfocus/companion/companion` is present on the machine), not invented. Task 9 captures these; Tasks 10–12 implement against the captures.

### Task 9: Discovery — start local Companion, confirm HTTP API auth, capture Satellite frames

**Files:**
- Create: `scripts/uat/fixtures/satellite-frames/` (captured frames)
- Create: `docs/uat-runs/SETUP.md` (runbook, partial — finished in Task 13)

- [ ] **Step 1: Start the local Companion container**

Run (document the exact command used in `SETUP.md`):
```bash
docker run -d --name companion-uat -p 8000:8000 ghcr.io/bitfocus/companion/companion:latest
```
Wait for it, then:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/
```
Expected: `200`. Record the version shown in the UI.

- [ ] **Step 2: Confirm HTTP API auth behaviour**

Run:
```bash
curl -s -w "\n[%{http_code}]\n" http://localhost:8000/api/connections
```
Record: does it return JSON without auth (open), or 401/403 (key required)? Write the answer into `SETUP.md` and into the spec §8 follow-up. This resolves the open auth item empirically.

- [ ] **Step 3: Capture Satellite `KEY-STATE` frames**

Using a throwaway Node snippet (net.Socket to `localhost:16622`), send the Satellite handshake (`ADD-DEVICE` per the documented protocol) and dump the raw `KEY-STATE` lines to `scripts/uat/fixtures/satellite-frames/keystate-sample.txt`. Reference the documented protocol: companion.free/for-developers/Satellite-API. Capture at least one button with a non-default feedback colour so the parser test has a real COLOR field to assert.

Expected: a text file of real frames. If the Satellite port/protocol differs from the doc, RECORD what was actually observed — the parser (Task 11) is written against THIS capture, not the doc.

- [ ] **Step 4: Commit the captures (no secrets)**

```bash
git add scripts/uat/fixtures/satellite-frames/ docs/uat-runs/SETUP.md
git commit -m "chore(uat): capture local Companion API auth + Satellite KEY-STATE frames"
```

---

### Task 10: Companion HTTP client

**Files:**
- Create: `scripts/uat/lib/companion-http.ts`
- Test: `scripts/uat/lib/companion-http.test.ts`

- [ ] **Step 1: Write the failing test** (inject a fake `fetch` to assert URL/shape, per the endpoints confirmed in Task 9):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CompanionHttp } from './companion-http.js'

function fakeFetch(record: { url?: string; init?: unknown }) {
  return async (url: string, init?: unknown) => {
    record.url = url; record.init = init
    return { ok: true, status: 200, text: async () => '7.1.5259.00090', json: async () => [{ id: 'abc', label: 'nvx' }] } as Response
  }
}

test('pressButton posts to /api/location/<page>/<row>/<col>/press', async () => {
  const rec: { url?: string } = {}
  const c = new CompanionHttp('http://localhost:8000', undefined, fakeFetch(rec) as typeof fetch)
  await c.pressButton(1, 0, 2)
  assert.equal(rec.url, 'http://localhost:8000/api/location/1/0/2/press')
})

test('getVariable reads /api/variable/<label>/<name>/value', async () => {
  const rec: { url?: string } = {}
  const c = new CompanionHttp('http://localhost:8000', undefined, fakeFetch(rec) as typeof fetch)
  const val = await c.getVariable('nvx', 'firmware_version')
  assert.equal(rec.url, 'http://localhost:8000/api/variable/nvx/firmware_version/value')
  assert.equal(val, '7.1.5259.00090')
})

test('findConnectionId resolves a connection id by label', async () => {
  const c = new CompanionHttp('http://localhost:8000', undefined, fakeFetch({}) as typeof fetch)
  assert.equal(await c.findConnectionId('nvx'), 'abc')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './companion-http.js'`.

- [ ] **Step 3: Write the implementation** (adjust endpoints to whatever Task 9 confirmed):

```ts
type Fetch = typeof fetch

export class CompanionHttp {
  constructor(private base: string, private apiKey?: string, private fetchImpl: Fetch = fetch) {}

  private headers(): HeadersInit {
    return this.apiKey ? { 'x-api-key': this.apiKey } : {}
  }

  async pressButton(page: number, row: number, col: number): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/api/location/${page}/${row}/${col}/press`, {
      method: 'POST', headers: this.headers(),
    })
    if (!res.ok) throw new Error(`pressButton ${page}/${row}/${col} → HTTP ${res.status}`)
  }

  async getVariable(label: string, name: string): Promise<string> {
    const res = await this.fetchImpl(`${this.base}/api/variable/${label}/${name}/value`, { headers: this.headers() })
    if (!res.ok) throw new Error(`getVariable ${label}.${name} → HTTP ${res.status}`)
    return (await res.text()).trim()
  }

  async findConnectionId(label: string): Promise<string | null> {
    const res = await this.fetchImpl(`${this.base}/api/connections`, { headers: this.headers() })
    if (!res.ok) throw new Error(`/api/connections → HTTP ${res.status}`)
    const conns = (await res.json()) as Array<{ id: string; label: string }>
    return conns.find((c) => c.label === label)?.id ?? null
  }

  async connectionStatus(id: string): Promise<string> {
    const res = await this.fetchImpl(`${this.base}/api/connections/${id}/status`, { headers: this.headers() })
    if (!res.ok) throw new Error(`/api/connections/${id}/status → HTTP ${res.status}`)
    return (await res.text()).trim()
  }
}
```

> ⚠️ Header name (`x-api-key` vs other) and the `/api/connections` JSON shape come from Task 9's observation — adjust to reality.

- [ ] **Step 4: Run test to verify it passes** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/uat/lib/companion-http.ts scripts/uat/lib/companion-http.test.ts
git commit -m "feat(uat): Companion HTTP client (press, getVariable, connection status)"
```

---

### Task 11: Satellite `KEY-STATE` parser

**Files:**
- Create: `scripts/uat/lib/satellite-client.ts`
- Test: `scripts/uat/lib/satellite-client.test.ts`

- [ ] **Step 1: Write the failing test against the CAPTURED frame** (use a real line from `scripts/uat/fixtures/satellite-frames/keystate-sample.txt` — paste the actual captured format here when implementing):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseKeyState } from './satellite-client.js'

test('parseKeyState extracts COLOR/TEXT for a key from a real captured frame', () => {
  // Replace this literal with an ACTUAL line captured in Task 9.
  const line = 'KEY-STATE DEVICEID=uat KEY=5 COLOR=#00aa00 TEXT=ON ...'
  const s = parseKeyState(line)
  assert.equal(s?.key, 5)
  assert.equal(s?.color, '#00aa00')
})
```

- [ ] **Step 2: Run test to verify it fails** — `Cannot find module './satellite-client.js'`.

- [ ] **Step 3: Write `parseKeyState` + a minimal TCP client** against the captured format. The parser is pure (string → `{key, color, text}`) and unit-tested; the socket client (`connect`, send `ADD-DEVICE`, collect `KEY-STATE`) is thin and integration-exercised in Task 12. Write the parser to match the EXACT tokens observed in Task 9's capture — do not guess token names.

- [ ] **Step 4: Run test to verify it passes** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/uat/lib/satellite-client.ts scripts/uat/lib/satellite-client.test.ts
git commit -m "feat(uat): Satellite KEY-STATE parser + TCP client (against captured frames)"
```

---

### Task 12: Tier 1 cases (CAP-01, ENC-06, B1–B3) + layout fixture

**Files:**
- Create: `scripts/uat/cases/companion.ts`
- Create: `uat/layout.json`
- Create: `uat/companion-page.companionconfig`
- Test: `scripts/uat/cases/companion.test.ts`

- [ ] **Step 1: Build the committed layout** — lay out buttons in local Companion bound to the module's actions/feedbacks, export the page to `uat/companion-page.companionconfig`, and write `uat/layout.json` mapping each action/feedback to its `{page,row,col}` + the expected connection `label` + the Satellite surface page. (Secret-free.)

- [ ] **Step 2: Write the failing test** — assert the case set + that Tier 1 cases SKIP when `findConnectionId` returns null (precondition guard). Use a fake `CompanionHttp`.

- [ ] **Step 3: Run test to verify it fails.**

- [ ] **Step 4: Implement `companion.ts`** — CAP-01 (status via `connectionStatus` + `device_role` via `getVariable`, cross-checked with a device GET that the role is really Transmitter), ENC-06 (press the toggle button via `pressButton`, read feedback colour via the Satellite client), B1–B3 (variables via `getVariable` cross-checked against device GET). Each begins with the precondition guard: `findConnectionId(layout.label)` → null ⟹ `skip(...)` with the "run SETUP.md" note.

- [ ] **Step 5: Run test to verify it passes.**

- [ ] **Step 6: Register Tier 1 cases** in `run.ts` (`allCases = [...authCases, ...encoderCases, ...companionCases]`).

- [ ] **Step 7: Commit**

```bash
git add scripts/uat/cases/companion.ts scripts/uat/cases/companion.test.ts uat/layout.json uat/companion-page.companionconfig scripts/uat/run.ts
git commit -m "feat(uat): tier1 Companion cases (CAP-01, ENC-06, B1-B3) + layout fixture"
```

---

### Task 13: Finish the operator runbook

**Files:**
- Modify: `docs/uat-runs/SETUP.md`

- [ ] **Step 1: Document the one-time setup** — start Companion (Task 9 command), import `uat/companion-page.companionconfig`, create the NVX connection with the exact `label` from `uat/layout.json`, type the password once, confirm `GET /api/connections` lists it. Include the env vars (`NVX_HOST`, `NVX_PASS`, `COMPANION_URL`, optional `COMPANION_API_KEY`) and the run commands (`npm run uat`, `npm run uat:tier0`).

- [ ] **Step 2: Commit**

```bash
git add docs/uat-runs/SETUP.md
git commit -m "docs(uat): operator setup runbook for tier 1"
```

---

## Wave 4 — Tier 2 (Playwright) + LLM escalation

### Task 14: Add Playwright (devDependency) — Zéro Installation decision pre-approved

> Adding a dependency is normally forbidden (Zéro Installation). **Didier pre-approved `playwright` for Tier 2 in the spec §7.2** — this task records and executes that one approved addition. Do NOT add any other dependency.

**Files:**
- Modify: `package.json` (devDependencies)

- [ ] **Step 1: Add playwright + install browsers**

```bash
npm install --save-dev playwright
npx playwright install chromium
```

- [ ] **Step 2: Verify the lock + typecheck**

Run: `git diff package.json` (should show only `playwright` added under devDependencies) and `npm test` (pretest typecheck + existing tests still green).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(uat): add playwright devDependency for tier2 (pre-approved, spec §7.2)"
```

---

### Task 15: Tier 2 config-form cases (UI-01..06)

**Files:**
- Create: `scripts/uat/tiers/tier2-ui.ts`
- Test: (Playwright cases are integration-only; assert the case set + selectors structurally in `scripts/uat/tiers/tier2-ui.test.ts`)

- [ ] **Step 1: Write the failing structural test** — `uiCases.map(c=>c.id)` deepEquals `['UI-01','UI-02','UI-03','UI-04','UI-05','UI-06']`, all `tier: 2`, `phase: 'ui'`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement `tier2-ui.ts`** — each case launches `chromium` (library), navigates to the local Companion connection-config page for the module, and asserts the field from `src/config.ts` (Page Object via role/text/title selectors — Companion has no data-testid). UI-01 (all 8 fields render), UI-02 (password field is masked / `type=password`), UI-03 (number bounds on port + pollInterval), UI-04 (defaults), UI-05 (persistence after save+reopen), UI-06 (config not editable while disabled). Each maps the observation to a `Verdict`. Browser launch failures → `skip` with a clear note (no Playwright browsers installed).

- [ ] **Step 4: Run to verify it passes** (structural test; full UI run needs local Companion).

- [ ] **Step 5: Register Tier 2 cases** in `run.ts`.

- [ ] **Step 6: Commit**

```bash
git add scripts/uat/tiers/tier2-ui.ts scripts/uat/tiers/tier2-ui.test.ts scripts/uat/run.ts
git commit -m "feat(uat): tier2 Playwright config-form cases UI-01..06"
```

---

### Task 16: LLM escalation glue

**Files:**
- Create: `scripts/uat/lib/escalate.ts`
- Test: `scripts/uat/lib/escalate.test.ts`

- [ ] **Step 1: Write the failing test** — `buildEscalationPrompt(packet)` returns a string containing each escalated case id + its expected/observed evidence, and a clear instruction set for the `uat-runner` (re-judge FAIL/AMBIGUOUS, drive HUMAN assisted). `mergeVerdicts(original, llmVerdicts)` replaces a verdict by id when the LLM returns a new status, preserving the rest.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement `escalate.ts`** — pure functions: `buildEscalationPrompt(packet)` (serialize the packet into a uat-runner brief) and `mergeVerdicts(original, llm)` (by-id replacement). The actual invocation of the `uat-runner` agent is a manual/orchestrated step documented in `SETUP.md` (run the harness → if `escalation.json` non-empty, hand it to the `uat-runner`); the harness stays a pure data producer.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Document the escalation step** in `docs/uat-runs/SETUP.md` (one paragraph: when `escalation.json` is non-empty, pass it to the `uat-runner` agent; it re-judges and the merged verdicts update `report.md`).

- [ ] **Step 6: Commit**

```bash
git add scripts/uat/lib/escalate.ts scripts/uat/lib/escalate.test.ts docs/uat-runs/SETUP.md
git commit -m "feat(uat): LLM escalation glue — prompt builder + verdict merge"
```

---

## Self-Review

- **Spec coverage:** Tier 0 (Wave 2 ↔ spec §2/§3) · Tier 1 HTTP+Satellite (Wave 3 ↔ §2/§5) · Tier 2 UI-01..06 (Task 15 ↔ §5 bis) · verdict model 5 states (Task 2 ↔ §3) · report.md+escalation.json (Task 4 ↔ §3) · batch fallback (Task 16 ↔ §3) · secrets separation (Tasks 6/7 env, Tier 1 via Companion ↔ §4) · one-time Companion setup + SKIP guard (Tasks 12/13 ↔ §4) · anti-false-positive device cross-check (Task 8 ↔ §2) · lockout 1-bad-login (Task 7 ↔ §2) · auth=Tier0 (Task 7 ↔ §4) · dedicated orchestrator not node:test (Task 5 ↔ §5) · Playwright library devDep pre-approved (Task 14 ↔ §7.2) ✓. No gaps.
- **Placeholder scan:** Waves 1-2 carry complete code. Waves 3-4 deliberately defer exact code for the Satellite parser (Task 11) and Companion/Playwright selectors (Tasks 12/15) to AFTER the Task 9 empirical capture — this is an anti-hallucination choice (do not invent an unobserved wire format / unverified DOM), explicitly flagged, not a lazy placeholder. The HTTP client (Task 10), verdict/report/orchestrator (Tasks 2-5), Tier 0 cases (Tasks 6-8), and escalation glue (Task 16) have complete code or complete pure-function contracts.
- **Type consistency:** `Verdict`/`VerdictStatus`/`Tier`/`Evidence` (Task 2), `UatCase`/`RunContext`/`RunResult`/`HarnessConfig`/`Phase` (Task 3) defined once and reused verbatim. `makeClient`/`hasDevice` (Task 6) reused by Tasks 7-8. `streamTransmitBody` (from `src/panels/encoder.ts`) and `postSetPartial`/`get`/`login`/`logout` (from `src/api.ts`) flagged for signature verification before use.

**Open items to confirm at execution (empirical, Wave 3):** Companion HTTP API auth (open vs key) · exact Satellite `KEY-STATE` token format · `/api/connections` JSON shape · the real `NvxApiClient`/`ModuleLogger` constructor signatures (copy `scripts/capture-nvx.ts`). All resolved by Task 9's capture before the dependent code is written.

**Not in this plan (by design):** rich reporting (Allure/JUnit — deferred, spec §8) · auto-setup of the Companion instance (unsupported — operator runbook instead) · testing Companion's generic UI (out of scope — we test our module).
