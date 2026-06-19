# UAT Harness — SETUP runbook

The journey harness (`npm run uat:journey`) replays the real user journey against a live
Companion: install → configure (+ failure gauntlet) → use the v0.2 encoder → teardown.
It uses 4 tools — Companion REST, Companion logs (`docker logs`), the device REST as an
**oracle**, and Chromium (system Chrome) for the install + config form.

## 1. Prerequisites (one-time, on this machine)

- **Docker Companion (compose)** running — it already mounts this repo as a dev module:
  ```bash
  npm run build                 # produce dist/ (the compose serves it read-only)
  docker compose up -d          # companion-nvx-companion-1 on http://localhost:8000
  ```
- **playwright-core** available globally + linked into the project (no bundled browser):
  ```bash
  npm ls -g playwright-core || npm i -g playwright-core   # Didier installs globally
  npm link playwright-core                                # link into this repo
  ```
- **System Google Chrome** installed (the driver uses `channel: 'chrome'`).

## 2. The test connection `nvx-uat` — provisioning strategies

You can let the harness manage the test connection in two ways:

**Default behavior (no flags)** — delete-if-exists (clean slate):
At startup the harness deletes any existing `nvx-uat` connection and creates a fresh one ("repart à 0");
at exit it deletes it again. Useful for test isolation when buttons/collections are not yet laid out.

**Auto-provision (`UAT_PROVISION=1`)** — idempotent ensure (no delete):
Instead of delete-and-recreate, auto-creates the connection **if absent** or **realigns if present**
(updates host/port via `NVX_HOST`/`NVX_PORT`, sets username `admin`, and password via `NVX_PASS`),
then enables and restarts. **Never deletes the connection** — this is safe to run repeatedly and
persists the connection and its buttons across runs. Implies `UAT_KEEP=1` automatically.

Both strategies require the module to be loaded (step 1 — `docker compose up`); the harness drives
the config form itself (Chromium UI automation).

- Pass `UAT_KEEP=1` alone to skip all provisioning — reuse an existing `nvx-uat` exactly as-is
  (useful when buttons and collections are already laid out and you want to repeat a run without
  touching the Companion config).

## 3. Launch profiles — recommended path

Instead of composing 6–7 variables by hand, use `UAT_PROFILE` to load a named preset. Explicit env vars always win over profile defaults (a profile only fills what is absent).

| Profile | Alias | What it sets |
|---------|-------|-------------|
| `fake` | `npm run uat:fake` | `UAT_LAB=1 UAT_FAKE=1 NVX_HOST=host.docker.internal NVX_PORT=8443 ORACLE_HOST=127.0.0.1 NVX_PASS=test123 COMPANION_CONTAINER=companion-nvx-companion-1` |
| `local` | `npm run uat:local` | `COMPANION_CONTAINER=companion-nvx-companion-1` (install + config-failure steps only, no device) |
| `lab` | *(no bare alias)* | `UAT_LAB=1 COMPANION_CONTAINER=companion-nvx-companion-1` — device coords must come from env |

```bash
# Fake device (all steps, no hardware)
npm run uat:fake

# Local only (no device, no lab steps)
npm run uat:local

# Lab (real device — supply host + password)
UAT_PROFILE=lab NVX_HOST=<ip> NVX_PASS=<pass> npm run uat:journey
```

An unknown `UAT_PROFILE` value aborts immediately (fail-fast). The §4/§4a/§4b hand-composed forms below remain valid for overrides or CI pipelines.

## 3b. Environment variables (full reference)

| Var | Default | Meaning |
|-----|---------|---------|
| `COMPANION_URL` | `http://localhost:8000` | Companion web/REST base |
| `COMPANION_CONTAINER` | `companion-nvx-companion-1` | container name for `docker logs` |
| `UAT_LABEL` | `nvx-uat` | connection label under test |
| `NVX_HOST` | `192.0.2.1` | device host as the MODULE reaches it (real Transmitter IP for lab) |
| `NVX_PORT` | `443` | device HTTPS port (8443 for the local fake) |
| `NVX_USER` | `admin` | device username — passed to the config form and fillConfig calls |
| `NVX_PASS` | *(empty)* | device password — **empty → all lab steps SKIP** |
| `ORACLE_HOST` | *(= NVX_HOST)* | device host as the ORACLE (host process) reaches it; differs only for the fake |
| `UAT_LAB` | *(unset)* | `1` → also run the lab steps |
| `UAT_FAKE` | *(unset)* | `1` → target is the **local fake-device** (enables scenario steps `DEC-NEGOTIATING`/`DEC-DECODING` which require the `/_control/scenario` route, absent on real NVX). **Required when running against `uat:fake-device`** — without it, those steps SKIP even in lab mode. |
| `UAT_PROVISION` | *(unset)* | `1` → idempotent auto-provisioning (creates if absent, realigns if present, no delete; implies `UAT_KEEP=1`) |
| `UAT_KEEP` | *(unset)* | `1` → skip connection provisioning/cleanup (reuse existing `nvx-uat` as-is) |
| `UAT_LAYOUT` | *(unset)* | JSON button map, overrides `scripts/uat/fixtures/layout.json` |

## 4b. Run fully local against the fake device (no real device)

`scripts/uat/fake-device/server.ts` replays the real captured JSON (a DM-NVX-360 Transmitter)
and mirrors the auth + SetPartial contract, so the WHOLE journey runs locally.

```bash
# terminal 1 — start the fake (HTTPS :8443)
FAKE_NVX_PASS=test123 npm run uat:fake-device

# terminal 2 — run the journey against it (module → host.docker.internal, oracle → 127.0.0.1)
# UAT_FAKE=1 is required: without it, DEC-NEGOTIATING/DEC-DECODING SKIP (scenario route fake-only)
UAT_LAB=1 UAT_FAKE=1 NVX_HOST=host.docker.internal NVX_PORT=8443 ORACLE_HOST=127.0.0.1 NVX_PASS=test123 \
  COMPANION_CONTAINER=companion-nvx-companion-1 npm run uat:journey
```

⚠️ The fake validates the harness wiring against our MODEL of the device, NOT the firmware —
it does not replace the real-device gate. WRITE (USE) steps still need the USE buttons laid out.

## 4a. Connection provisioning strategies (UAT_PROVISION)

**Scenario 1: Repeated runs, buttons already laid out** — use `UAT_PROVISION=1`:

```bash
# terminal 1 — start the fake
FAKE_NVX_PASS=test123 npm run uat:fake-device

# terminal 2 — run multiple journeys, auto-provisioning the connection each time
# (connection is created on first run, realigned on subsequent runs, never deleted)
# UAT_FAKE=1 required for scenario steps DEC-NEGOTIATING/DEC-DECODING to run (not SKIP)
UAT_LAB=1 UAT_FAKE=1 UAT_PROVISION=1 \
  NVX_HOST=host.docker.internal NVX_PORT=8443 ORACLE_HOST=127.0.0.1 NVX_PASS=test123 \
  COMPANION_CONTAINER=companion-nvx-companion-1 npm run uat:journey
```

**Intention**: `UAT_PROVISION=1` creates the connection **once** (or realigns it if it exists),
then **keeps it across multiple runs** — buttons and collections survive between test iterations.
This is safe to run repeatedly because `ensureConnection()` is idempotent: it never deletes,
only creates if absent or realigns if present (host/port/credentials via env vars).

**Scenario 2: Clean-slate runs, buttons created in each run** — omit the flag:

```bash
# Deletes any existing connection, creates fresh, runs, cleans up.
# Useful for isolated test runs or CI pipelines.
UAT_LAB=1 NVX_HOST=<device-ip> NVX_PASS=<password> \
  COMPANION_CONTAINER=companion-nvx-companion-1 npm run uat:journey
```

**Scenario 3: Preserve a manually configured connection, skip all provisioning** — use `UAT_KEEP=1`:

```bash
# Reuses the existing connection exactly as-is (no create, no realign, no delete).
# Useful when you have tweaked the connection config manually and want to preserve it.
UAT_LAB=1 UAT_KEEP=1 \
  COMPANION_CONTAINER=companion-nvx-companion-1 npm run uat:journey
```

## 4. Run

```bash
# Local journey (install + no-password + unreachable-IP) — no device needed
COMPANION_CONTAINER=companion-nvx-companion-1 npm run uat:journey

# Full journey including lab steps — needs the real Transmitter
UAT_LAB=1 NVX_HOST=<device-ip> NVX_PASS=<password> \
  COMPANION_CONTAINER=companion-nvx-companion-1 npm run uat:journey
```

Report is written to `docs/uat-runs/<date>#<NN>-<module>/` — four artefacts:

| File | Content |
|------|---------|
| `report.md` | Human-readable summary — observed values truncated at 200 chars |
| `escalation.json` | Full evidence for FAIL / AMBIGUOUS / HUMAN verdicts only |
| `details.json` | Full redacted evidence for **all** verdicts (the complete picture `report.md` summarises) |
| `run.json` | Complete `RunResult` (all verdicts + raw evidence, unredacted) — required by `uat:adjudicate` to re-ingest adjudication |

⚠️ **`details.json` and `run.json` are as sensitive as `escalation.json`.** Redaction is by key name only
(`pass*`, `token`, `cookie`, `sessionid`, `authorization`, `api-key` …). A secret appearing
as a *value* under an innocuous key (e.g. inside a `note` string) is **not masked** — treat
these files accordingly (do not commit, do not paste in public channels).

Verdicts: **PASS / FAIL / AMBIGUOUS / HUMAN / SKIP**
- **SKIP** — lab step voluntarily omitted (missing device or wrong role). Never a false PASS.
- **AMBIGUOUS** — the test could not observe the expected condition (e.g. the trigger was absent from the logs, the connection never reached a healthy state). This is **not** a module bug — it means the test was inconclusive. Distinct from FAIL (which signals a wrong observed value) and from SKIP (which signals a deliberate omission).
- **FAIL / HUMAN** — escalated: included in `escalation.json` and eligible for manual adjudication (see §4c below).

## 4c. Manual adjudication cycle (escalation)

When a run contains escalated cases (FAIL / AMBIGUOUS / HUMAN), the harness writes
`escalation-prompt.md` in the run directory and prints the following instruction:

```
UAT escalade : N cas (FAIL/AMBIGUOUS/HUMAN). Adjudication : lancer l'agent uat-runner
sur <run-dir>/escalation-prompt.md, puis 'npm run uat:adjudicate -- <run-dir> <llm-verdicts.json>'.
```

Operator cycle:

1. Open `<run-dir>/escalation-prompt.md` in the `uat-runner` agent (it contains the full
   evidence packet and adjudication instructions).
2. The agent returns its verdicts as a JSON array — save it to a file (e.g. `llm-verdicts.json`).
   Expected format: `[{ "id": "STEP-ID", "status": "PASS"|"FAIL"|"AMBIGUOUS"|"HUMAN", "reason": "..." }]`
3. Re-ingest via:
   ```bash
   npm run uat:adjudicate -- <run-dir> <llm-verdicts.json>
   ```
   This reads `run.json` + the LLM verdicts, merges them via `mergeVerdicts`, and rewrites
   `report.md`, `details.json`, `escalation.json`, and `run.json` in place.

**No LLM call happens in-process** — `uat:adjudicate` is pure glue (file I/O + merge).
The agent invocation is a deliberate manual gesture by the operator.

## 5. Action buttons (lab only — for the WRITE steps) — MANUAL CREATION

The encoder actions (`set_stream_name`, `set_multicast_address`, `enc_enable_stream`,
`enc_disable_stream`) are exposed **only once the module detects role = Transmitter**. The decoder
actions (`set_source_url`, `set_source_multicast`, `connect_to_stream`, `dec_enable_stream`,
`dec_disable_stream`) are exposed **only once the module detects role = Receiver**. A real device
must be connected (`CFG-GOOD` does this earlier in the journey). Lay the buttons out **at the lab**,
after `CFG-GOOD` connects.

**⚠️ Button creation is NOT automatically provisioned.** (No clean API; Companion stores buttons
in its internal SQLite — no bulk import or programmatic assignment.) The auto-provisioning
(`UAT_PROVISION=1`) creates the **connection** (module becomes visible), but you must **manually
create the buttons once** on the Buttons page. Once created, they persist across runs and survive
connection realignment.

On the **Buttons** page, create one button per action at the coordinates in
`scripts/uat/fixtures/layout.json` (page/row/col), each targeting the `nvx-uat` connection's
action. Configure the value-bearing ones to the test values the steps assert:

**Encoder buttons (Transmitter device — row 0)**

| Action button | Coords (default) | Configure value |
|---------------|------------------|-----------------|
| `set_stream_name` | page 1, row 0, col 0 | Stream name = `UAT-STREAM` |
| `set_multicast_address` | page 1, row 0, col 1 | Address = `239.200.0.1` |
| `enc_enable_stream` | page 1, row 0, col 2 | *(no option)* |
| `enc_disable_stream` | page 1, row 0, col 3 | *(no option)* |

**Decoder buttons (Receiver device — row 1)**

| Action button | Coords (default) | Configure value |
|---------------|------------------|-----------------|
| `set_source_url` | page 1, row 1, col 0 | Source URL = `rtsp://192.168.2.10:554/live.sdp` |
| `set_source_multicast` | page 1, row 1, col 1 | Multicast address = `239.1.1.4` |
| `connect_to_stream` | page 1, row 1, col 2 | Stream name = `DM-NVX-360-C442684E534B` |
| `dec_enable_stream` | page 1, row 1, col 3 | *(no option)* |
| `dec_disable_stream` | page 1, row 1, col 4 | *(no option)* |

A WRITE step whose button is missing from the layout **SKIPs** (does not FAIL) — the harness
stays runnable while only partially provisioned.

## 6. Lockout note

`CFG-WRONGPASS` consumes **exactly one** failed login (the module does not retry on
`AuthenticationFailure`). NVX blocks after ~3 failures (15 min / 24 h). Run the lab journey
**once per slot**, device in hand.
