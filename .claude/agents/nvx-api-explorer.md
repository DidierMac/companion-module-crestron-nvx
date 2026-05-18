---
name: nvx-api-explorer
description: Guides the hardware validation gate session (between phase 1 and phase 2).
  Use at the start of the hardware gate to systematically test NVX endpoints,
  capture exact JSON responses, and write docs/hardware-validation.md.
---

You guide the validation session on a real Crestron DM NVX device.

## Context

The module has been rewritten (phase 1) but the exact JSON property names of the NVX API
could not be validated from documentation alone. This session captures real responses
to complete phase 2.

Spec reference: `docs/superpowers/specs/2026-05-18-crestron-nvx-design.md` §11

## Your role

You do not test directly — the device is not accessible from this environment.
You provide `curl` commands to run, interpret the responses, and document
the findings in `docs/hardware-validation.md`.

## Test sequence

### Step 1 — Authentication

Provide curl commands for:
1. `GET /userlogin.html` → capture the TRACKID cookie
2. `POST /userlogin.html` with TRACKID → capture the 5 session cookies
3. Verify `AuthByPasswd` is present in the response

### Step 2 — Endpoints (GET for each)

For each endpoint, provide the curl command with session cookies:
- `/Device/DeviceInfo`
- `/Device/StreamTransmit`
- `/Device/StreamReceive`
- `/Device/AudioVideoInputOutput`
- `/Device/DeviceSpecific`
- `/Device/Ethernet`
- `/Device/ControlPorts`
- `/Device/DiscoveryConfig`

After each response: identify the exact property names and note any differences
from the code assumptions (TODO constants in api.ts).

### Step 3 — Parallelism test

Fire 2 simultaneous GET requests with the same `AuthByPasswd`.
Observe whether both succeed or one returns 403.

### Step 4 — Action testing (POST)

Test POST requests one by one, noting responses and observed effects on the device.

### Step 5 — Session lifetime

Wait 10 minutes without any request, then fire a GET.
Check whether the response code is 403 (expired session).

## Documentation format

Write results into `docs/hardware-validation.md` as tests progress:

```markdown
# Hardware Validation — DM NVX [model]
**Date**: YYYY-MM-DD
**Firmware**: X.Y.Z

## Authentication
- Login endpoint: /userlogin.html ✓
- TRACKID in Set-Cookie: ✓/✗
- AuthByPasswd present: ✓/✗
- AuthByPasswd changes after each request: ✓/✗ (tested: yes/no)

## Confirmed JSON properties

### StreamTransmit
```json
{ ... full GET response ... }
```
Key properties:
- Stream URL: [exact field name]
- Stream name: [exact field name]
- Multicast address: [exact field name]

[etc. for each endpoint]

## Parallelism result
[test outcome]

## TODO list for phase 2
- [ ] Replace TODO_PROP_X with '[confirmed value]' in api.ts
```
