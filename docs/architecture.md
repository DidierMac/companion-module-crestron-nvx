# Architecture

## Overview

Each Companion instance of this module controls a single Crestron DM NVX device. To manage multiple devices, create one Companion connection per device.

## Module Structure

```
src/
  main.ts       — CrestronNvxInstance (InstanceBase): lifecycle, polling, status
  api.ts        — NvxApiClient: HTTPS requests, cookie auth, re-login on 403
  config.ts     — ModuleConfig interface + Companion UI config fields
  logger.ts     — ModuleLogger: verbose toggle, component prefixes, child loggers
  actions.ts    — Companion action definitions (v0.2+)
  feedbacks.ts  — Companion feedback definitions
  variables.ts  — Companion variable definitions
  upgrades.ts   — SDK upgrade scripts (schema migrations)
companion/
  manifest.json — Module metadata required by Companion v4
```

## Data Flow

```
Companion UI
    │ config save
    ▼
CrestronNvxInstance.configUpdated()
    │ updateConfig + reconnect
    ▼
NvxApiClient.login()          ← 2-step: GET /userlogin.html → POST form → 302
    │ cookies stored in Map
    ▼
setInterval → poll()
    │ GET /Device/DeviceInfo
    ▼
setVariableValues()           → Companion variables updated
checkFeedbacks('connected')   → button colours updated
```

## Authentication

The NVX uses a two-step form-based login:
1. `GET /userlogin.html` → receive `TRACKID` cookie
2. `POST /userlogin.html` (URL-encoded form) → HTTP 302 on success, rolling `AuthByPasswd` cookie

On HTTP 403 responses, the client re-authenticates once and retries the request. A mutex prevents concurrent re-login attempts.

## Logging

`ModuleLogger` wraps `this.log()` from the SDK. Each subsystem gets a child logger with a component prefix (`[AUTH]`, `[HTTP]`, `[POLL]`, `[CONN]`, `[INIT]`). Debug messages are suppressed by default and promoted to `info` level when verbose mode is enabled via the config UI.

See [debugging.md](debugging.md) for log file locations and grep patterns.

## Polling

The module polls `GET /Device/DeviceInfo` on a configurable interval (default: 2000ms, minimum: 500ms). On poll failure, polling stops and a reconnect is scheduled after 10 seconds. There is no push/webhook mechanism in the NVX REST API.
