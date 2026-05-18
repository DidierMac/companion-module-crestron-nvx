---
name: hardware-validation
description: Starts the hardware gate session. Loads the spec context and §11
  checklist, then launches the nvx-api-explorer agent to guide systematic testing.
disable-model-invocation: true
---

# Hardware Gate — Validation on real device

Launch the `nvx-api-explorer` agent to guide the validation session.

Load this context before starting:
- Spec: `docs/superpowers/specs/2026-05-18-crestron-nvx-design.md` (§11 checklist)
- Phase 1 code: `src/api.ts` (identify the TODO constants to validate)

Remind the user to have ready:
1. The NVX device IP address
2. Login credentials (username / password)
3. `curl` available in the terminal
4. ~30 minutes for the full session

Results will be written to `docs/hardware-validation.md`.
