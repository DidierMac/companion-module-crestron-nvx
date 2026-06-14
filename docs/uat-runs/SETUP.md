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

## 2. Create the test connection `nvx-uat`

In Companion (http://localhost:8000) → **Connections** → **Add** the `Crestron: DM-NVX-…`
module → set **Label** = `nvx-uat` → **Add**. The harness drives the config form itself;
you only need the connection to exist with this label.

- **Local run** (no device): host `192.0.2.1` (TEST-NET, unreachable) is fine — the local
  steps set it themselves.
- **Lab run**: point host at the real **Transmitter** device; put its password in `NVX_PASS`.

## 3. Environment variables

| Var | Default | Meaning |
|-----|---------|---------|
| `COMPANION_URL` | `http://localhost:8000` | Companion web/REST base |
| `COMPANION_CONTAINER` | `companion-nvx-companion-1` | container name for `docker logs` |
| `UAT_LABEL` | `nvx-uat` | connection label under test |
| `NVX_HOST` | `192.0.2.1` | device IP (real Transmitter for lab) |
| `NVX_PASS` | *(empty)* | device password — **empty → all lab steps SKIP** |
| `UAT_LAB` | *(unset)* | `1` → also run the lab steps |
| `UAT_LAYOUT` | *(unset)* | JSON button map, overrides `scripts/uat/fixtures/layout.json` |

## 4. Run

```bash
# Local journey (install + no-password + unreachable-IP) — no device needed
COMPANION_CONTAINER=companion-nvx-companion-1 npm run uat:journey

# Full journey including lab steps — needs the real Transmitter
UAT_LAB=1 NVX_HOST=<device-ip> NVX_PASS=<password> \
  COMPANION_CONTAINER=companion-nvx-companion-1 npm run uat:journey
```

Report is written to `docs/uat-runs/<date>-journey/` (`report.md` + `escalation.json`).
Verdicts: **PASS / FAIL / AMBIGUOUS / HUMAN / SKIP** (SKIP = lab step without a device —
never a false PASS).

## 5. Encoder action buttons (lab only — for the WRITE steps)

The encoder actions (`set_stream_name`, `set_multicast_address`, `enable_stream`,
`disable_stream`) are exposed **only once the module detects role = Transmitter** (a real
device must be connected — `CFG-GOOD` does this earlier in the journey). So lay the buttons
out **at the lab**, after `CFG-GOOD` connects.

On the **Buttons** page, create one button per action at the coordinates in
`scripts/uat/fixtures/layout.json` (page/row/col), each targeting the `nvx-uat` connection's
action. Configure the value-bearing ones to the test values the steps assert:

| Action button | Coords (default) | Configure value |
|---------------|------------------|-----------------|
| `set_stream_name` | page 1, row 0, col 0 | Stream name = `UAT-STREAM` |
| `set_multicast_address` | page 1, row 0, col 1 | Address = `239.200.0.1` |
| `enable_stream` | page 1, row 0, col 2 | *(no option)* |
| `disable_stream` | page 1, row 0, col 3 | *(no option)* |

A WRITE step whose button is missing from the layout **SKIPs** (does not FAIL) — the harness
stays runnable while only partially provisioned.

## 6. Lockout note

`CFG-WRONGPASS` consumes **exactly one** failed login (the module does not retry on
`AuthenticationFailure`). NVX blocks after ~3 failures (15 min / 24 h). Run the lab journey
**once per slot**, device in hand.
