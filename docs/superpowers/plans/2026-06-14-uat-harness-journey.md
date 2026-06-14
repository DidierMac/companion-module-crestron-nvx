# UAT Harness (User-Journey) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Test the Crestron NVX Companion module by replaying the real user journey (install → configure → use the v0.2 encoder → teardown), covering the happy path and every normal failure, using 4 complementary tools.

**Architecture:** A journey orchestrator runs ordered *steps*; each step uses one or more of 4 tools — REST API Companion (drive + read status/variables), Companion logs via `docker logs` (prove error detection), the device REST as an oracle (`NvxApiClient`: baseline + verify + restore), and Chromium (system Chrome via Playwright, for install + config form only). Each step returns a `Verdict`. The Wave-1 socle (verdict/report/redact/orchestrator) is reused unchanged.

**Tech Stack:** TypeScript strict, Node 22, `node:test` via `scripts/ts-resolver.mjs`, native `fetch`/`child_process`, `playwright-core` (global + `npm link`, `channel:'chrome'`). Reuses `src/api.ts` + `src/config.ts` unchanged.

**Reference spec:** `docs/superpowers/specs/2026-06-14-uat-harness-design.md` (commit 78a6dc6). **Supersedes** the tier-organized plan `2026-06-14-uat-harness.md`.

---

## File Structure

**Reused unchanged (Wave 1-2 socle):** `scripts/uat/lib/{verdict,report,case}.ts`, `scripts/uat/run.ts` (orchestrator + report emit), `scripts/uat/tiers/tier0-logic.ts` (`makeClient`/`hasDevice` → reused by the oracle).

**New — tools:**
- `scripts/uat/tools/companion-http.ts` — REST API Companion client.
- `scripts/uat/tools/companion-logs.ts` — `docker logs` reader with before/after correlation.
- `scripts/uat/tools/oracle.ts` — device ground-truth (reuses `NvxApiClient`): baseline, read, compare, restore.
- `scripts/uat/tools/chromium.ts` — Playwright config-form driver (system Chrome).
- Tests: `*.test.ts` next to each (those that are pure / fake-injectable).

**New — journey:**
- `scripts/uat/journey/types.ts` — `JourneyStep`, `JourneyContext` (the 4 tools + config).
- `scripts/uat/journey/steps-local.ts` — install, config no-password, config unreachable-IP.
- `scripts/uat/journey/steps-lab.ts` — wrong-password, good-password, baseline, USE (v0.2 encoder), teardown.
- `scripts/uat/journey/run-journey.ts` — orders steps, runs them, emits the report.

**Reorganized (not deleted):** `scripts/uat/cases/{auth,encoder}.ts` — their device-read logic moves into `oracle.ts`; the case bodies become journey steps. Removed at the end of Wave 4 once superseded.

**Discovery fixtures:** `scripts/uat/fixtures/` — captured `/api/connections/:id/status` JSON, config-form selector notes, sample `docker logs` lines.

**Test command:** `npm test` (glob already covers `scripts/uat/**/*.test.ts`). Journey dry-run: `npm run uat` (or a new `uat:journey`).

---

## Wave 0 — Discovery (local Companion, before the dependent code)

> Do not write the `/status` parser or the Chromium selectors blind. Capture them against the LOCAL Companion (image present; dev-load via `--extra-module-path`). This is the anti-hallucination gate.

### Task 0.1: Start local Companion with the module, capture the three unknowns

**Files:**
- Create: `scripts/uat/fixtures/discovery-notes.md`
- Create: `scripts/uat/fixtures/connection-status.json`

- [ ] **Step 1: Start Companion with the module (record exact commands in discovery-notes.md)**

```bash
docker run -d --name companion-uat -p 8000:8000 \
  -v "$(pwd):/extra-modules/crestron-nvx" \
  ghcr.io/bitfocus/companion/companion:latest --extra-module-path /extra-modules
# wait for HTTP 200 on http://localhost:8000/
```
(Build `dist/` first: `npm run build`.)

- [ ] **Step 2: Create ONE connection via the UI** (label `nvx-uat`, host `192.0.2.1` — unreachable TEST-NET, any password) so `/api/connections` is non-empty. Record the connection `id` and `label`.

- [ ] **Step 3: Capture `/api/connections/:id/status` shape**

```bash
ID=$(curl -s http://localhost:8000/api/connections | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
curl -s "http://localhost:8000/api/connections/$ID/status" | tee scripts/uat/fixtures/connection-status.json
```
Record the EXACT JSON keys (category/level/message?) in `discovery-notes.md`. This is what `companion-http.ts` parses (Task 1.1).

- [ ] **Step 4: Capture the config-form selectors** — open the connection's config in Chrome DevTools (or via a throwaway Playwright snapshot), note how to target: the **host** input, **username** input, **password** (secret) input, **Save** button, and the connection **status badge**. No `data-testid` exists → record role/text/`title`/label-adjacency selectors. Write them into `discovery-notes.md`.

- [ ] **Step 5: Validate the log-correlation mechanism**

```bash
T=$(date -u +%Y-%m-%dT%H:%M:%S)
# trigger a reconnect via REST, then:
docker logs --since "$T" companion-uat 2>&1 | grep "nvx-uat" | grep -E "\[CONN\]|\[HTTP\]"
```
Confirm `docker logs --since <ISO>` returns only new lines and that our `[CONN]/[HTTP]` prefixes + the connection label appear. Note the exact container name and whether `--since` is reliable, in `discovery-notes.md`.

- [ ] **Step 6: Commit the captures**

```bash
git add scripts/uat/fixtures/discovery-notes.md scripts/uat/fixtures/connection-status.json
git commit -m "chore(uat): capture /status shape, config-form selectors, log correlation"
```

---

## Wave 1 — Tools

### Task 1.1: Companion HTTP client

**Files:**
- Create: `scripts/uat/tools/companion-http.ts`
- Test: `scripts/uat/tools/companion-http.test.ts`

- [ ] **Step 1: Write the failing test** (fake `fetch`; adjust the status shape to Task 0.1's capture):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CompanionHttp } from './companion-http.js'

function fake(routes: Record<string, unknown>) {
  return (async (url: string, init?: { method?: string }) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    const body = routes[key] ?? routes[url]
    if (body === undefined) return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as Response
    return { ok: true, status: 200, text: async () => String(body), json: async () => body } as Response
  }) as typeof fetch
}

test('findConnectionId resolves id by label', async () => {
  const c = new CompanionHttp('http://x:8000', fake({ 'http://x:8000/api/connections': [{ id: 'abc', label: 'nvx-uat' }] }))
  assert.equal(await c.findConnectionId('nvx-uat'), 'abc')
  assert.equal(await c.findConnectionId('absent'), null)
})

test('status returns the category from /status', async () => {
  // shape per Task 0.1 capture; adjust the key if discovery differs.
  const c = new CompanionHttp('http://x:8000', fake({ 'http://x:8000/api/connections/abc/status': { category: 'error', message: 'NVX timeout' } }))
  const s = await c.status('abc')
  assert.equal(s.category, 'error')
  assert.equal(s.message, 'NVX timeout')
})

test('getVariable reads the value', async () => {
  const c = new CompanionHttp('http://x:8000', fake({ 'http://x:8000/api/variable/nvx-uat/device_role/value': 'Transmitter' }))
  assert.equal(await c.getVariable('nvx-uat', 'device_role'), 'Transmitter')
})
```

- [ ] **Step 2: Run to verify it fails** — `npm test` → `Cannot find module './companion-http.js'`.

- [ ] **Step 3: Implement** (adjust `ConnectionStatus` keys to Task 0.1):

```ts
type Fetch = typeof fetch

export interface ConnectionStatus {
  category: string // e.g. 'ok' | 'warning' | 'error' | 'disabled' — confirm in fixtures
  message?: string
}

export class CompanionHttp {
  constructor(private base: string, private fetchImpl: Fetch = fetch) {}

  async findConnectionId(label: string): Promise<string | null> {
    const res = await this.fetchImpl(`${this.base}/api/connections`)
    if (!res.ok) throw new Error(`/api/connections → HTTP ${res.status}`)
    const conns = (await res.json()) as Array<{ id: string; label: string }>
    return conns.find((c) => c.label === label)?.id ?? null
  }

  async status(id: string): Promise<ConnectionStatus> {
    const res = await this.fetchImpl(`${this.base}/api/connections/${id}/status`)
    if (!res.ok) throw new Error(`/status → HTTP ${res.status}`)
    return (await res.json()) as ConnectionStatus
  }

  async enable(id: string): Promise<void> { await this.post(`/api/connections/${id}/enable`) }
  async disable(id: string): Promise<void> { await this.post(`/api/connections/${id}/disable`) }
  async restart(id: string): Promise<void> { await this.post(`/api/connections/${id}/restart`) }

  async getVariable(label: string, name: string): Promise<string> {
    const res = await this.fetchImpl(`${this.base}/api/variable/${label}/${name}/value`)
    if (!res.ok) throw new Error(`getVariable ${label}.${name} → HTTP ${res.status}`)
    return (await res.text()).trim()
  }

  async press(page: number, row: number, col: number): Promise<void> {
    await this.post(`/api/location/${page}/${row}/${col}/press`)
  }

  private async post(path: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}${path}`, { method: 'POST' })
    if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`)
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/uat/tools/companion-http.ts scripts/uat/tools/companion-http.test.ts
git commit -m "feat(uat): Companion HTTP client (status, variable, press, enable/disable)"
```

---

### Task 1.2: Companion logs reader (docker logs, correlated)

**Files:**
- Create: `scripts/uat/tools/companion-logs.ts`
- Test: `scripts/uat/tools/companion-logs.test.ts`

- [ ] **Step 1: Write the failing test** (inject a fake exec so it's pure):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CompanionLogs } from './companion-logs.js'

const SAMPLE = [
  '2026-06-14T16:51:50Z error Instance/Connection/nvx-uat [HTTP] Timeout: GET /userlogin.html',
  '2026-06-14T16:51:50Z error Instance/Connection/nvx-uat [CONN] Connection failed (192.0.2.1): NVX timeout',
  '2026-06-14T16:51:50Z info  Instance/Connection/other [POLL] tick',
].join('\n')

test('since filters by label and prefix', () => {
  const logs = new CompanionLogs('companion-uat', () => SAMPLE)
  const lines = logs.since({ ts: '2026-06-14T16:51:00Z' }, 'nvx-uat', '[CONN]')
  assert.equal(lines.length, 1)
  assert.match(lines[0], /NVX timeout/)
})

test('detect returns true when a matching line exists', () => {
  const logs = new CompanionLogs('companion-uat', () => SAMPLE)
  assert.equal(logs.detect({ ts: '2026-06-14T16:51:00Z' }, 'nvx-uat', /NVX timeout/), true)
  assert.equal(logs.detect({ ts: '2026-06-14T16:51:00Z' }, 'nvx-uat', /401|403/), false)
})
```

- [ ] **Step 2: Run to verify it fails** — `Cannot find module './companion-logs.js'`.

- [ ] **Step 3: Implement** (`mark()` stamps the host clock — `Date.now`/`new Date` allowed in the harness runtime):

```ts
import { execFileSync } from 'node:child_process'

export interface LogMark { ts: string }
type Exec = (container: string, sinceTs: string) => string

function defaultExec(container: string, sinceTs: string): string {
  return execFileSync('docker', ['logs', '--since', sinceTs, container], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

export class CompanionLogs {
  constructor(private container: string, private exec: Exec = defaultExec) {}

  /** Stamp the current time; pass to since()/detect() after an action. */
  mark(): LogMark { return { ts: new Date().toISOString() } }

  /** New log lines since `mark`, for `label`, optionally containing `prefix`. */
  since(mark: LogMark, label: string, prefix?: string): string[] {
    const out = this.exec(this.container, mark.ts)
    return out.split('\n').filter((l) => l.includes(label) && (!prefix || l.includes(prefix)))
  }

  /** True if any line since `mark` for `label` matches `re`. */
  detect(mark: LogMark, label: string, re: RegExp): boolean {
    return this.since(mark, label).some((l) => re.test(l))
  }
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/uat/tools/companion-logs.ts scripts/uat/tools/companion-logs.test.ts
git commit -m "feat(uat): Companion logs reader (docker logs, correlated by mark+label+prefix)"
```

---

### Task 1.3: Device oracle

**Files:**
- Create: `scripts/uat/tools/oracle.ts`
- Test: `scripts/uat/tools/oracle.test.ts`

- [ ] **Step 1: Write the failing test** (fake client injected):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Oracle } from './oracle.js'
import type { NvxApiClient } from '../../../src/api.js'

function fakeClient(stream0: Record<string, unknown>) {
  return { login: async () => {}, logout: async () => {},
    get: async () => ({ Device: { StreamTransmit: { Streams: [stream0] } } }),
    postSetPartial: async () => 0,
  } as unknown as NvxApiClient
}

test('readStream0 returns Streams[0]', async () => {
  const o = new Oracle(() => fakeClient({ RtspSessionName: 'X', Status: 'Stream started' }))
  const s = await o.readStream0()
  assert.equal(s.RtspSessionName, 'X')
})

test('baseline then restore re-posts the captured values', async () => {
  const posted: unknown[] = []
  const client = { login: async () => {}, logout: async () => {},
    get: async () => ({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'ORIG', MulticastAddress: '239.1.1.1', Status: 'Stream Stopped' }] } } }),
    postSetPartial: async (b: unknown) => { posted.push(b); return 0 },
  } as unknown as NvxApiClient
  const o = new Oracle(() => client)
  await o.captureBaseline()
  await o.restore()
  assert.deepEqual(posted[0], { Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'ORIG' }] } } })
})
```

- [ ] **Step 2: Run to verify it fails** — `Cannot find module './oracle.js'`.

- [ ] **Step 3: Implement** (reuse `streamTransmitBody`; the client factory wraps `makeClient` from `tier0-logic.ts`):

```ts
import { streamTransmitBody } from '../../../src/panels/encoder.js'
import type { NvxApiClient } from '../../../src/api.js'

export class Oracle {
  private baseline: Record<string, unknown> | null = null
  constructor(private clientFactory: () => NvxApiClient) {}

  /** Login + GET Streams[0]. */
  async readStream0(): Promise<Record<string, unknown>> {
    const c = this.clientFactory()
    await c.login()
    const json = (await c.get('/Device/StreamTransmit')) as { Device?: { StreamTransmit?: { Streams?: Array<Record<string, unknown>> } } }
    const s = json.Device?.StreamTransmit?.Streams?.[0]
    if (!s) throw new Error('Streams[0] absent')
    return s
  }

  async captureBaseline(): Promise<void> { this.baseline = await this.readStream0() }

  /** Restore name/multicast/state captured at baseline. No-op if no baseline. */
  async restore(): Promise<void> {
    if (!this.baseline) return
    const c = this.clientFactory()
    await c.login()
    const b = this.baseline
    if (typeof b.RtspSessionName === 'string') await c.postSetPartial(streamTransmitBody(0, { RtspSessionName: b.RtspSessionName }))
    if (typeof b.MulticastAddress === 'string') await c.postSetPartial(streamTransmitBody(0, { MulticastAddress: b.MulticastAddress }))
    await c.postSetPartial(streamTransmitBody(0, b.Status === 'Stream started' ? { Start: true } : { Stop: true }))
  }
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/uat/tools/oracle.ts scripts/uat/tools/oracle.test.ts
git commit -m "feat(uat): device oracle — baseline, readStream0, restore (reuses NvxApiClient)"
```

---

### Task 1.4: Chromium config-form driver

**Files:**
- Create: `scripts/uat/tools/chromium.ts`

> Selectors come from Task 0.1. This file has no pure unit test (it drives a real browser); it is exercised by the local journey steps (Wave 2). Browser-launch failure → the step returns `skip` (no Chrome / no playwright-core link).

- [ ] **Step 1: Implement the driver** using the selectors captured in `discovery-notes.md`. Structure (fill in the real selectors from Task 0.1 — do NOT guess them):

```ts
import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'

export class CompanionUi {
  private browser?: Browser
  constructor(private base = 'http://localhost:8000') {}

  async open(): Promise<Page> {
    this.browser = await chromium.launch({ channel: 'chrome', headless: true })
    const page = await this.browser.newPage()
    await page.goto(this.base, { waitUntil: 'domcontentloaded', timeout: 20000 })
    return page
  }
  async close(): Promise<void> { await this.browser?.close() }

  /** True if the module is available to add (Modules list / add-connection search). */
  async moduleAvailable(page: Page, moduleName: string): Promise<boolean> {
    // selector per Task 0.1 — placeholder name only, replace with captured locator
    return (await page.getByText(moduleName, { exact: false }).count()) > 0
  }

  /** Fill the config form of an existing connection. Returns when Save is applied. */
  async fillConfig(page: Page, fields: { host?: string; username?: string; password?: string }): Promise<void> {
    // Use the captured locators (label→adjacent input). Save button per capture.
    // (Implement against discovery-notes.md selectors.)
  }
}
```

- [ ] **Step 2: Build to confirm it compiles** — `npm run build` (chromium.ts has no test; ensure `playwright-core` resolves via the `npm link`). If `playwright-core` is not linked, document the `npm link playwright-core` prerequisite in `SETUP.md` (Wave 4).

- [ ] **Step 3: Commit**

```bash
git add scripts/uat/tools/chromium.ts
git commit -m "feat(uat): Chromium config-form driver (system Chrome via playwright-core)"
```

---

## Wave 2 — Journey skeleton + LOCAL steps (runnable now, no device)

### Task 2.1: Journey types + context

**Files:**
- Create: `scripts/uat/journey/types.ts`

- [ ] **Step 1: Write the types**

```ts
import type { Verdict } from '../lib/verdict.js'
import type { CompanionHttp } from '../tools/companion-http.js'
import type { CompanionLogs } from '../tools/companion-logs.js'
import type { Oracle } from '../tools/oracle.js'
import type { CompanionUi } from '../tools/chromium.js'

export interface JourneyConfig {
  companionUrl: string
  container: string      // docker container name for logs
  label: string          // connection label under test
  nvxHost: string
  nvxPass: string        // empty → lab-only steps SKIP
}

export interface JourneyContext {
  config: JourneyConfig
  http: CompanionHttp
  logs: CompanionLogs
  oracle: Oracle
  ui: CompanionUi
}

export interface JourneyStep {
  id: string
  title: string
  scope: 'local' | 'lab'
  run(ctx: JourneyContext): Promise<Verdict>
}
```

- [ ] **Step 2: Build to confirm** — `npm run build`. **Step 3: Commit** `git add scripts/uat/journey/types.ts && git commit -m "feat(uat): journey types (JourneyStep/Context/Config)"`

---

### Task 2.2: Local steps — install + the two local failures

**Files:**
- Create: `scripts/uat/journey/steps-local.ts`
- Test: `scripts/uat/journey/steps-local.test.ts`

> Three steps, all `scope: 'local'`: (1) INSTALL — module visible; (2) NO-PASSWORD → BadConfig; (3) UNREACHABLE-IP → ConnectionFailure. Each verifies via REST status + a log-detection assertion. The triple-check pattern: status (REST) == expected AND logs detect the right cause.

- [ ] **Step 1: Write the failing test** (fake http/logs/ui injected via context; assert the verdict logic, not a live browser):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localSteps } from './steps-local.js'
import type { JourneyContext } from './types.js'

function ctx(over: Partial<JourneyContext> = {}): JourneyContext {
  const base = {
    config: { companionUrl: 'http://x:8000', container: 'c', label: 'nvx-uat', nvxHost: '192.0.2.1', nvxPass: '' },
    http: { findConnectionId: async () => 'abc', status: async () => ({ category: 'error', message: 'NVX timeout' }),
      enable: async () => {}, disable: async () => {} } as never,
    logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
    oracle: {} as never,
    ui: { open: async () => ({}), close: async () => {}, moduleAvailable: async () => true, fillConfig: async () => {} } as never,
  }
  return { ...base, ...over } as JourneyContext
}

test('local steps are all scope:local with expected ids', () => {
  assert.deepEqual(localSteps.map((s) => s.id), ['INSTALL', 'CFG-NOPASS', 'CFG-UNREACHABLE'])
  assert.ok(localSteps.every((s) => s.scope === 'local'))
})

test('CFG-UNREACHABLE PASSes when status=error AND log detects timeout', async () => {
  const step = localSteps.find((s) => s.id === 'CFG-UNREACHABLE')!
  const v = await step.run(ctx())
  assert.equal(v.status, 'PASS')
})

test('CFG-UNREACHABLE FAILs when the log does NOT show the expected cause', async () => {
  const step = localSteps.find((s) => s.id === 'CFG-UNREACHABLE')!
  const v = await step.run(ctx({ logs: { mark: () => ({ ts: 't' }), detect: () => false } as never }))
  assert.equal(v.status, 'FAIL') // status alone is not enough — the log must prove the cause
})
```

- [ ] **Step 2: Run to verify it fails** — `Cannot find module './steps-local.js'`.

- [ ] **Step 3: Implement.** The config-state changes (empty password, unreachable IP) are applied by Chromium (`ui.fillConfig`); the verdict combines REST status + log detection. Expected categories per spec §3 (confirm exact strings against Task 0.1 capture):

```ts
import { pass, fail } from '../lib/verdict.js'
import type { JourneyStep, JourneyContext } from './types.js'

async function statusAndLog(ctx: JourneyContext, expectCat: string, causeRe: RegExp, id: string, title: string) {
  const ui = await ctx.ui.open()
  const m = ctx.logs.mark()
  try {
    // fillConfig already set the relevant state before this helper (see steps below)
    const id2 = await ctx.http.findConnectionId(ctx.config.label)
    if (!id2) return fail(id, title, 1 as never, { note: 'connection not found — run SETUP' })
    await ctx.http.enable(id2)
    const st = await ctx.http.status(id2)
    const logged = ctx.logs.detect(m, ctx.config.label, causeRe)
    return st.category === expectCat && logged
      ? pass(id, title, 1 as never, { companion: st, note: `status=${expectCat} + cause logged` })
      : fail(id, title, 1 as never, { expected: { category: expectCat, cause: String(causeRe) }, observed: { status: st, logged } })
  } finally {
    await ctx.ui.close()
    void ui
  }
}

export const localSteps: JourneyStep[] = [
  {
    id: 'INSTALL', title: 'module crestron-nvx available in Companion', scope: 'local',
    run: async (ctx) => {
      const page = await ctx.ui.open()
      try {
        const ok = await ctx.ui.moduleAvailable(page, 'Crestron DM NVX')
        return ok ? pass('INSTALL', 'module available', 1 as never, {}) : fail('INSTALL', 'module not available', 1 as never, {})
      } finally { await ctx.ui.close() }
    },
  },
  {
    id: 'CFG-NOPASS', title: 'empty password → BadConfig', scope: 'local',
    run: async (ctx) => {
      const page = await ctx.ui.open(); await ctx.ui.fillConfig(page, { host: ctx.config.nvxHost, username: 'admin', password: '' })
      return statusAndLog(ctx, 'warning' /* bad_config = warning, confirm */, /no password|BadConfig|missing/i, 'CFG-NOPASS', 'empty password → BadConfig')
    },
  },
  {
    id: 'CFG-UNREACHABLE', title: 'unreachable IP → ConnectionFailure', scope: 'local',
    run: async (ctx) => {
      const page = await ctx.ui.open(); await ctx.ui.fillConfig(page, { host: '192.0.2.1', username: 'admin', password: 'whatever' })
      return statusAndLog(ctx, 'error', /timeout|NVX timeout|ECONN/i, 'CFG-UNREACHABLE', 'unreachable IP → ConnectionFailure')
    },
  },
]
```

> Note: `1 as never` is the `tier` argument of the verdict constructors (legacy field); the journey doesn't use tiers — a follow-up (Wave 4) can widen `Verdict.tier` or drop it. Keep consistent for now.

- [ ] **Step 4: Run to verify it passes** — `npm test` → PASS (logic asserted with fakes).

- [ ] **Step 5: Commit**

```bash
git add scripts/uat/journey/steps-local.ts scripts/uat/journey/steps-local.test.ts
git commit -m "feat(uat): local journey steps — install + no-password + unreachable-IP (status+log)"
```

---

### Task 2.3: Journey runner + `uat:journey` entrypoint

**Files:**
- Create: `scripts/uat/journey/run-journey.ts`
- Modify: `package.json` (add `uat:journey` script)

- [ ] **Step 1: Implement the runner** — build the context (instantiate the 4 tools from env), run steps filtered by scope (default: local only unless `UAT_LAB=1`), emit the report via the reused `writeRun`:

```ts
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeRun } from '../lib/report.js'
import type { RunResult } from '../lib/case.js'
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
    container: env.COMPANION_CONTAINER ?? 'companion-uat',
    label: env.UAT_LABEL ?? 'nvx-uat',
    nvxHost: env.NVX_HOST ?? '192.0.2.1',
    nvxPass: env.NVX_PASS ?? '',
  }
}

export function buildContext(cfg: JourneyConfig): JourneyContext {
  const oracleFactory = () => makeClient({ nvxHost: cfg.nvxHost, nvxPort: 443, nvxUser: 'admin', nvxPass: cfg.nvxPass, companionUrl: cfg.companionUrl, tiers: [0] })
  return {
    config: cfg,
    http: new CompanionHttp(cfg.companionUrl),
    logs: new CompanionLogs(cfg.container),
    oracle: new Oracle(oracleFactory),
    ui: new CompanionUi(cfg.companionUrl),
  }
}

export async function runJourney(steps: JourneyStep[], ctx: JourneyContext): Promise<Verdict[]> {
  const verdicts: Verdict[] = []
  for (const s of steps) {
    try { verdicts.push(await s.run(ctx)) }
    catch (err) { verdicts.push({ id: s.id, title: s.title, tier: 1, status: 'FAIL', evidence: { note: `threw: ${err instanceof Error ? err.message : String(err)}` } }) }
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { void main() }
```

- [ ] **Step 2: Add the npm script**

```json
"uat:journey": "node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs scripts/uat/journey/run-journey.ts",
```

- [ ] **Step 3: Run the local journey against the live local Companion**

Run: `npm run build && COMPANION_CONTAINER=companion-uat npm run uat:journey`
Expected: INSTALL/CFG-NOPASS/CFG-UNREACHABLE execute against the real local Companion; report written. (Lab steps skipped without `UAT_LAB=1`.) Iterate on the Chromium selectors (Task 1.4) until the local steps pass for the right reasons.

- [ ] **Step 4: Commit**

```bash
git add scripts/uat/journey/run-journey.ts package.json
git commit -m "feat(uat): journey runner + uat:journey entrypoint (local steps runnable)"
```

---

## Wave 3 — LAB steps (coded now, run at the lab)

> All `scope: 'lab'` — need a reachable device. Coded against the verified mechanisms; executed at a lab slot. `labSteps` array in `scripts/uat/journey/steps-lab.ts`.

### Task 3.1: Auth lab steps — wrong-password + good-password

**Files:**
- Create: `scripts/uat/journey/steps-lab.ts`
- Test: `scripts/uat/journey/steps-lab.test.ts`

- [ ] **Step 1: Write the failing test** — assert ids/scope + that lab steps `SKIP` when `nvxPass` is empty (no device). (Fakes for http/logs/oracle/ui as in Task 2.2.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** `CFG-WRONGPASS` (Chromium sets a deliberately wrong password → enable → REST status `AuthenticationFailure` + log `[AUTH]` 401/403; **exactly one** login, no retry) and `CFG-GOOD` (Chromium sets the good password + good host → REST status `OK` + oracle confirms a session: `oracle.readStream0()` succeeds). Guard both with `if (!ctx.config.nvxPass) return skip(...)`. ⚠️ Lockout: `CFG-WRONGPASS` is the only budget-consuming step — document "run once, device in hand".

- [ ] **Step 4: Run to verify it passes** (structure + SKIP-without-device). **Step 5: Commit** `feat(uat): lab auth steps — wrong-password + good-password (status+log+oracle)`.

---

### Task 3.2: USE steps — v0.2 Encoder

**Files:**
- Modify: `scripts/uat/journey/steps-lab.ts` (append USE steps)
- Test: `scripts/uat/journey/steps-lab.test.ts` (append)

- [ ] **Step 1: Write the failing test** — assert the USE step ids: `CAP`, `ENC-NAME`, `ENC-MULTICAST`, `ENC-ENABLE`, `ENC-DISABLE`, `ENC-FEEDBACKS`, `ENC-VARS`, all `scope: 'lab'`; SKIP without device.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement the v0.2 encoder USE steps.** Each presses the action via `ctx.http.press(...)` (button laid out per `uat/layout.json` — produced in Task 4.x) OR triggers via the action directly, then validates with the oracle + reads the Companion variable + checks the log StatusId:
  - `CAP`: `ctx.http.getVariable(label, 'device_role')` === `'Transmitter'` AND the encoder actions are exposed (presence) → encoder panel active.
  - `ENC-NAME`: capture baseline (oracle), press set_stream_name button → oracle `Streams[0].RtspSessionName` changed → restore.
  - `ENC-MULTICAST`, `ENC-ENABLE`, `ENC-DISABLE`: same pattern; enable/disable check `Status` transition via oracle.
  - `ENC-FEEDBACKS`: read the feedback-driven variables/state (`stream_enabled`, etc.) via `ctx.http.getVariable`; (optional Satellite colour check deferred — spec §8).
  - `ENC-VARS`: each encoder variable via REST equals the oracle device value.
  Edge step `CAP-RECEIVER` (optional): if device is Receiver, encoder panel absent → `skip`/`pass` (correct, not a failure).

- [ ] **Step 4: Run to verify it passes** (structure + SKIP). **Step 5: Commit** `feat(uat): lab USE steps — v0.2 encoder (CAP, actions, feedbacks, variables) via REST+oracle`.

---

### Task 3.3: BASELINE + TEARDOWN steps

**Files:**
- Modify: `scripts/uat/journey/steps-lab.ts`

- [ ] **Step 1-3: Add `BASELINE`** (call `ctx.oracle.captureBaseline()` at the journey's pre-USE point → `pass` with the snapshot) and `TEARDOWN` (`ctx.oracle.restore()` + `ctx.http.disable(id)` + a logout via the oracle client → `pass`). Order in `labSteps`: `CFG-WRONGPASS, CFG-GOOD, BASELINE, CAP, ENC-*, TEARDOWN`. Test the ordering + SKIP-without-device.

- [ ] **Step 4-5: Run + Commit** `feat(uat): lab baseline + teardown steps (oracle restore, disable, logout)`.

---

## Wave 4 — Escalation, SETUP runbook, cleanup

### Task 4.1: Layout fixture + SETUP runbook

**Files:**
- Create: `uat/layout.json` (button-map: action → page/row/col + the connection label) and `docs/uat-runs/SETUP.md`.

- [ ] **Step 1:** Lay out the encoder action buttons in local Companion, record their `{page,row,col}` in `uat/layout.json`. **Step 2:** Write `SETUP.md`: start Companion (`--extra-module-path`), `npm link playwright-core`, create the connection labelled `nvx-uat`, the env vars (`COMPANION_URL`, `COMPANION_CONTAINER`, `UAT_LABEL`, `NVX_HOST`, `NVX_PASS`, `UAT_LAB=1`), and the run commands (`npm run uat:journey`, `UAT_LAB=1 … npm run uat:journey`). **Step 3: Commit.**

### Task 4.2: Escalation glue (reuse) + retire the superseded tier-0 cases

**Files:**
- Create: `scripts/uat/lib/escalate.ts` (prompt builder + verdict merge — pure, as in the prior plan).
- Remove: `scripts/uat/cases/auth.ts`, `scripts/uat/cases/encoder.ts` (+ tests) once `steps-local`/`steps-lab` cover them; update `scripts/uat/run.ts` (drop the old `allCases` registry or keep it pointing at the journey).

- [ ] **Step 1:** Implement `escalate.ts` (`buildEscalationPrompt(packet)` + `mergeVerdicts(original, llm)`), tested pure. **Step 2:** `git rm` the superseded `cases/*` once the journey suite is green and covers their intent (verify with a grep that nothing imports them). **Step 3:** `npm test` all green. **Step 4: Commit** `refactor(uat): journey supersedes tier-0 cases; add LLM escalation glue`.

---

## Self-Review

- **Spec coverage:** 4 tools (Tasks 1.1-1.4 ↔ spec §2) · user journey install→config→use→teardown (Tasks 2.2/3.1-3.3 ↔ §3) · v0.2 encoder as USE core (Task 3.2 ↔ §3) · triple-check status+log+oracle (Task 2.2 helper ↔ §4) · oracle baseline/restore (Task 1.3/3.3 ↔ §4) · local-vs-lab split (scope field + UAT_LAB ↔ §5) · reuse socle/oracle/Chromium (file structure ↔ §6) · status/alert via REST (Task 1.1 ↔ §2) · logs via docker logs (Task 1.2 ↔ §2) · escalation reuse (Task 4.2 ↔ §4) ✓. No gaps.
- **Placeholder scan:** Discovery-dependent code (the `/status` category strings, the Chromium selectors in Task 1.4, the `bad_config=warning` assumption) is **explicitly flagged to confirm against Task 0.1's capture** — an anti-hallucination gate, not a lazy placeholder. The complete code (tools, journey runner, local steps) is present. Wave 3 USE steps are described step-by-step with the exact tool calls and oracle pattern (not full literal code for every encoder sub-step, to avoid repeating Task 1.3's pattern N times — the pattern is shown once and applied).
- **Type consistency:** `JourneyStep`/`JourneyContext`/`JourneyConfig` (Task 2.1) reused across Waves 2-3. `CompanionHttp`/`CompanionLogs`/`Oracle`/`CompanionUi` signatures defined in Wave 1, consumed by the journey. `Verdict` 5-state reused from the socle. `makeClient` reused from `tier0-logic.ts`.

**Open items (empirical, Wave 0):** exact `/api/connections/:id/status` keys + the category strings for bad_config/auth-fail/connection-fail · config-form selectors · `docker logs --since` correlation reliability + the real container name. All resolved by Task 0.1 before the dependent steps.

**Not in this plan (by design):** Satellite feedback-colour check (deferred — feedbacks validated via variables/oracle, spec §8) · rich reporting (Allure/JUnit) · creating connections via REST (impossible — Chromium does it).
