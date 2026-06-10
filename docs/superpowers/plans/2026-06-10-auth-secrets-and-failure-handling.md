# Auth Secrets + Auth-Failure Handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Crestron NVX module authenticate with the correct password (read from the SDK v2 `secrets` channel) and stop hammering the device on authentication refusals.

**Architecture:** Two coupled bugs on the auth path. (A) The password lives in the SDK `secrets` object, not `config`; the client must read it there. (B) A 401/403 auth refusal must become a terminal `AuthenticationFailure` status (no reconnect) via a typed `NvxAuthError`, while transient errors keep retrying. Tasks are grouped one-per-bug so each commit compiles (the three source files are coupled at compile time).

**Tech Stack:** TypeScript strict, Node 22, `@companion-module/base` v2.0.4, `node:test` runner via `scripts/ts-resolver.mjs`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/config.ts` | Config + secrets type definitions, UI fields | Split `password` out of `ModuleConfig` into new `ModuleSecrets` |
| `src/api.ts` | NVX REST client (login, requests) | Read password from `secrets`; add `NvxAuthError`; throw it on 401/403 |
| `src/main.ts` | Companion instance lifecycle | Capture `secrets`; garde-fou BadConfig; branch catch on `NvxAuthError` |
| `src/api.test.ts` | Unit tests for the client | **Create** — tests for A (password source) and B (auth error) |
| `package.json` | Scripts | Widen `test` script to run all `src/*.test.ts` |

---

## Task 1: Bug A — Read password from `secrets`

Make the client source the password from the SDK `secrets` channel instead of `config`. Each edit below is required for the build to compile (the three files are coupled).

**Files:**
- Create: `src/api.test.ts`
- Modify: `package.json` (scripts.test)
- Modify: `src/config.ts`
- Modify: `src/api.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write the failing test** (`src/api.test.ts`)

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { NvxApiClient, NvxAuthError } from './api.js'
import { ModuleLogger } from './logger.js'
import type { ModuleConfig, ModuleSecrets } from './config.js'

function fakeRes(statusCode: number, headers: Record<string, unknown> = {}): IncomingMessage {
  const r = Readable.from(['']) as unknown as IncomingMessage
  ;(r as unknown as { statusCode: number }).statusCode = statusCode
  ;(r as unknown as { headers: Record<string, unknown> }).headers = headers
  return r
}

function makeClient(secrets: ModuleSecrets): NvxApiClient {
  const config: ModuleConfig = {
    host: '10.0.0.1', port: 443, username: 'admin',
    pollInterval: 2000, ignoreSelfSignedCert: true, verbose: false,
  }
  const silent = new ModuleLogger(() => {}, '', false)
  return new NvxApiClient(config, secrets, silent.child('[AUTH]'), silent.child('[HTTP]'))
}

// Replace the private HTTP transport with canned responses; capture requests.
function stubTransport(client: NvxApiClient, postStatus: number): { method: string; path: string; body?: string }[] {
  const captured: { method: string; path: string; body?: string }[] = []
  ;(client as unknown as { rawRequest: unknown }).rawRequest = async (method: string, path: string, body?: string) => {
    captured.push({ method, path, body })
    if (method === 'GET' && path === '/userlogin.html') return fakeRes(200, { 'set-cookie': ['TRACKID=test-token'] })
    if (method === 'POST' && path === '/userlogin.html') return fakeRes(postStatus, { 'set-cookie': ['AuthByPasswd=1'] })
    return fakeRes(404)
  }
  return captured
}

test('login() sends the password from secrets, not config', async () => {
  const client = makeClient({ password: 's3cr3t' })
  const captured = stubTransport(client, 302)
  await client.login()
  const post = captured.find((c) => c.method === 'POST')
  assert.ok(post, 'a POST request was made')
  assert.equal(post?.body, 'login=admin&passwd=s3cr3t')
})
```

- [ ] **Step 2: Widen the test script** (`package.json`)

Replace the `test` script value:

```json
"test": "node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs --test src/*.test.ts",
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd .claude/worktrees/log && npm test`
Expected: FAIL — `NvxApiClient` constructor does not accept a `secrets` arg yet, and `NvxAuthError` / `ModuleSecrets` are not exported (compile/import error).

- [ ] **Step 4: Split `password` into `ModuleSecrets`** (`src/config.ts`)

Replace the `ModuleConfig` interface, add `ModuleSecrets`, and update `defaultConfig` (remove `password`). New top of file (through `defaultConfig`):

```ts
import type { JsonValue, SomeCompanionConfigField } from '@companion-module/base'

// Index signature satisfies the JsonObject constraint required by the SDK v2 generics
export interface ModuleConfig {
	[key: string]: JsonValue
	host: string
	port: number
	username: string
	pollInterval: number
	ignoreSelfSignedCert: boolean
	verbose: boolean
}

// `secret-text` fields are delivered by the SDK in the separate `secrets` channel,
// NOT in `config`. See docs/superpowers/specs/2026-06-10-auth-secrets-and-failure-handling.
export interface ModuleSecrets {
	[key: string]: JsonValue
	password: string
}

export const defaultConfig: ModuleConfig = {
	host: '',
	port: 443,
	username: 'admin',
	pollInterval: 2000,
	ignoreSelfSignedCert: true,
	verbose: false,
}
```

Leave `getConfigFields()` unchanged — the `password` `secret-text` field stays (it is what routes the value to `secrets`).

- [ ] **Step 5: Make the client take `secrets` and read the password from it** (`src/api.ts`)

5a. Update the config import line:

```ts
import type { ModuleConfig, ModuleSecrets } from './config.js'
```

5b. Replace the constructor and `updateConfig`:

```ts
	constructor(
		private config: ModuleConfig,
		private secrets: ModuleSecrets,
		private readonly authLog: ModuleLogger,
		private readonly httpLog: ModuleLogger,
	) {
		this.agent = this.buildAgent()
	}

	updateConfig(config: ModuleConfig, secrets: ModuleSecrets): void {
		this.config = config
		this.secrets = secrets
		this.agent = this.buildAgent()
	}
```

5c. In `login()`, change the body line to read from `secrets`:

```ts
		const body = `login=${encodeURIComponent(this.config.username)}&passwd=${encodeURIComponent(this.secrets.password)}`
```

- [ ] **Step 6: Capture `secrets` in the instance and add the empty-password garde-fou** (`src/main.ts`)

6a. Add the import of `ModuleSecrets` (extend the existing config import):

```ts
import { getConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
```

6b. Add a field next to `currentConfig`:

```ts
	private currentSecrets!: ModuleSecrets
```

6c. Replace `init()`'s signature + the first lines and the client construction:

```ts
	async init(config: JsonObject, _isFirstInit: boolean, secrets?: JsonObject | undefined): Promise<void> {
		this.currentConfig = config as ModuleConfig
		this.currentSecrets = (secrets ?? {}) as ModuleSecrets
		// this.log (no 'ger') is the inherited InstanceBase SDK method — captured here before logger is assigned
		this.logger = new ModuleLogger(this.log.bind(this), '', this.currentConfig.verbose ?? false)
```

and the client construction (pass `this.currentSecrets`):

```ts
		this.api = new NvxApiClient(
			this.currentConfig,
			this.currentSecrets,
			this.logger.child('[AUTH]'),
			this.logger.child('[HTTP]'),
		)
```

6d. Replace `configUpdated()`:

```ts
	async configUpdated(config: JsonObject, secrets?: JsonObject | undefined): Promise<void> {
		this.currentConfig = config as ModuleConfig
		this.currentSecrets = (secrets ?? {}) as ModuleSecrets
		this.logger.setVerbose(this.currentConfig.verbose ?? false)
		this.logger.child('[CONN]').debug('configUpdated() → reconnect')
		this.stopPolling()
		this.api.clearCookies()
		this.api.updateConfig(this.currentConfig, this.currentSecrets)
		await this.connect()
	}
```

6e. In `connect()`, add the empty-password garde-fou right after the existing host check:

```ts
		if (!this.currentConfig.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}
		if (!this.currentSecrets.password) {
			this.updateStatus(InstanceStatus.BadConfig, 'No password configured')
			connLog.error('No password configured — not attempting login')
			return
		}
```

- [ ] **Step 7: Run build + test to verify they pass**

Run: `cd .claude/worktrees/log && npm run build && npm test`
Expected: build succeeds; all tests PASS (including `login() sends the password from secrets`).

- [ ] **Step 8: Commit**

```bash
cd .claude/worktrees/log
git add src/config.ts src/api.ts src/main.ts src/api.test.ts package.json
git commit -m "fix(auth): read password from SDK secrets channel + empty-password guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Bug B — Auth refusal is terminal (`NvxAuthError`)

Add a typed error for 401/403 and stop the reconnect loop on it; transient errors keep retrying.

**Files:**
- Modify: `src/api.ts`
- Modify: `src/main.ts`
- Modify: `src/api.test.ts`

- [ ] **Step 1: Add the failing tests** (`src/api.test.ts`, append)

```ts
test('login() throws NvxAuthError on HTTP 403', async () => {
  const client = makeClient({ password: 'wrong' })
  stubTransport(client, 403)
  await assert.rejects(() => client.login(), NvxAuthError)
})

test('login() throws NvxAuthError on HTTP 401', async () => {
  const client = makeClient({ password: 'wrong' })
  stubTransport(client, 401)
  await assert.rejects(() => client.login(), NvxAuthError)
})

test('login() throws a generic Error (not NvxAuthError) on HTTP 500', async () => {
  const client = makeClient({ password: 'x' })
  stubTransport(client, 500)
  await assert.rejects(() => client.login(), (err: unknown) => {
    assert.ok(err instanceof Error)
    assert.ok(!(err instanceof NvxAuthError), 'transient errors must not be NvxAuthError')
    return true
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd .claude/worktrees/log && npm test`
Expected: the two `NvxAuthError` tests FAIL (login currently throws a generic `Error` on 403/401, not `NvxAuthError`).

- [ ] **Step 3: Add `NvxAuthError` and throw it on 401/403** (`src/api.ts`)

3a. Add the class right after the imports / before `export interface DeviceInfo`:

```ts
/**
 * Thrown when the device refuses the credentials (HTTP 401/403).
 * Signals main.ts to stop reconnecting until config/secrets change
 * (NVX locks the account after repeated failed logins).
 */
export class NvxAuthError extends Error {}
```

3b. In `login()`, replace the single status check after step 2 with an auth-aware check:

```ts
		if (step2.statusCode === 401 || step2.statusCode === 403) {
			throw new NvxAuthError(
				`NVX auth refused: HTTP ${step2.statusCode} — bad credentials or account locked`,
			)
		}
		if (step2.statusCode !== 302) {
			throw new Error(`NVX login failed: HTTP ${step2.statusCode} (expected 302)`)
		}
```

3c. In the private `request()` method, change the post-re-login 403 throw to `NvxAuthError`:

```ts
			throw new NvxAuthError(`NVX HTTP 403 on ${path} after re-login`)
```

- [ ] **Step 4: Branch the catch blocks on `NvxAuthError`** (`src/main.ts`)

4a. Extend the api import:

```ts
import { NvxApiClient, NvxAuthError } from './api.js'
```

4b. Replace the `catch` block in `connect()`:

```ts
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.connected = false
			if (err instanceof NvxAuthError) {
				this.updateStatus(InstanceStatus.AuthenticationFailure, msg)
				this.setVariableValues({ connection_status: `Auth failed: ${msg}` })
				connLog.error(`Auth refused — stopping reconnect until config changes: ${msg}`)
			} else {
				this.updateStatus(InstanceStatus.ConnectionFailure, msg)
				this.setVariableValues({ connection_status: `Error: ${msg}` })
				connLog.error(`Connection failed (${this.currentConfig.host}): ${msg}`)
				connLog.debug('Reconnect scheduled in 10s')
				setTimeout(() => void this.connect(), 10000)
			}
		}
```

4c. Replace the `catch` block in `poll()`:

```ts
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.connected = false
			this.checkFeedbacks('connected')
			this.stopPolling()
			if (err instanceof NvxAuthError) {
				this.updateStatus(InstanceStatus.AuthenticationFailure, msg)
				this.setVariableValues({ connection_status: `Auth failed: ${msg}` })
				this.logger.child('[CONN]').error(`Auth refused during poll — stopping reconnect: ${msg}`)
			} else {
				this.updateStatus(InstanceStatus.ConnectionFailure, msg)
				this.setVariableValues({ connection_status: `Error: ${msg}` })
				this.logger.child('[CONN]').warn(`Poll error: ${msg} — reconnect in 10s`)
				setTimeout(() => void this.connect(), 10000)
			}
		}
```

- [ ] **Step 5: Run build + test to verify they pass**

Run: `cd .claude/worktrees/log && npm run build && npm test`
Expected: build succeeds; all tests PASS (5 api tests + 9 logger tests).

- [ ] **Step 6: Commit**

```bash
cd .claude/worktrees/log
git add src/api.ts src/main.ts src/api.test.ts
git commit -m "fix(auth): treat 401/403 as terminal AuthenticationFailure, no reconnect

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Verification in Companion (Docker)

Confirm the built module loads and behaves correctly against the running Companion stack.

**Files:** none (verification only)

- [ ] **Step 1: Rebuild dist (Companion serves `dist/`)**

Run: `cd .claude/worktrees/log && npm run build`
Expected: `dist/` updated, no errors.

- [ ] **Step 2: Trigger a hot reload and watch the lifecycle logs**

In the Companion UI (`http://localhost:8000`), re-enable / save the Crestron NVX instance, then:

Run: `docker logs --tail 40 companion-nvx-companion-1 2>&1 | grep -iE "\[AUTH\]|\[CONN\]|\[HTTP\]"`

Expected, depending on device state:
- If the password is now read correctly and the account is unlocked → `[AUTH] Login OK` and `[POLL] DeviceInfo OK`.
- If credentials are still refused → a single `AuthenticationFailure` and **no** 10s reconnect loop (verify no repeated `connect() triggered` every 10s).
- If the password field is empty → status `BadConfig` (`No password configured`), no login attempt.

- [ ] **Step 3: UAT against the real device (192.168.2.9)**

With the NVX account unlocked and the correct password entered in the instance config, confirm: status reaches `Connected`, the `device_name` / `firmware_version` variables populate, and verbose logs show the auth + heartbeat succeeding. If auth still fails, confirm the loop does **not** re-lock the account (single `AuthenticationFailure`, no retries).

---

## Self-Review

**Spec coverage:**
- A (read password from `secrets`) → Task 1, steps 4–6. ✓
- A garde-fou (empty password → BadConfig) → Task 1, step 6e. ✓
- B (`NvxAuthError` on 401/403, no reconnect) → Task 2, steps 3–4. ✓
- B transient unchanged (ConnectionFailure + 10s) → Task 2, steps 4b/4c (else branch). ✓
- `request()` re-login 403 → NvxAuthError → Task 2, step 3c. ✓
- Tests for A and B → Task 1 step 1, Task 2 step 1. ✓
- Recovery via `configUpdated()` → preserved (Task 1 step 6d). ✓
- No manifest change → confirmed (storage already works; not touched). ✓

**Placeholder scan:** none — every step shows full code or exact commands.

**Type consistency:** `NvxApiClient(config, secrets, authLog, httpLog)` and `updateConfig(config, secrets)` used identically in api.ts, main.ts, and api.test.ts. `ModuleSecrets` defined in config.ts (Task 1 step 4), imported in api.ts (5a), main.ts (6a), api.test.ts (step 1). `NvxAuthError` exported in api.ts (Task 2 step 3a), imported in main.ts (4a) and api.test.ts (step 1). Consistent.
