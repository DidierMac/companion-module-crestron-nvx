/** Named launch profiles: encapsulate the STRUCTURAL env flags so an operator runs
 *  `UAT_PROFILE=fake npm run uat:journey` instead of composing 6-7 vars by hand.
 *  Device coordinates/secrets for the LAB stay in env (.env.local) — never hardcoded here.
 *  Explicit env vars always override profile defaults. */
export const PROFILES: Record<string, Record<string, string>> = {
  // Full offline journey against the local fake-device (no real hardware).
  // NVX_PASS defaults to the fake's throwaway password (matches FAKE_NVX_PASS in SETUP.md).
  // NVX_USER is required because UAT_LAB=1 here trips loadJourneyConfig's lab-mode guard;
  // 'admin' is the fake's conventional account (its auth checks only the password).
  fake: {
    UAT_LAB: '1',
    UAT_FAKE: '1',
    NVX_HOST: 'host.docker.internal',
    NVX_PORT: '8443',
    ORACLE_HOST: '127.0.0.1',
    NVX_USER: 'admin',
    NVX_PASS: 'test123',
    COMPANION_CONTAINER: 'companion-nvx-companion-1',
  },
  // Local-only: install + config failures. No device, no lab steps.
  local: {
    COMPANION_CONTAINER: 'companion-nvx-companion-1',
  },
  // Lab: real device. Host/user/password come from env (.env.local) — NOT set here.
  lab: {
    UAT_LAB: '1',
    COMPANION_CONTAINER: 'companion-nvx-companion-1',
  },
}

/** Merge the named profile (if UAT_PROFILE is set) UNDER the real env: explicit env wins.
 *  Unknown profile name throws — fail fast rather than silently running the default.
 *  Idempotent: applyProfile(applyProfile(env)) === applyProfile(env). */
export function applyProfile(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const name = env.UAT_PROFILE
  if (!name) return env
  const profile = PROFILES[name]
  if (!profile) {
    throw new Error(`Unknown UAT_PROFILE '${name}' — known: ${Object.keys(PROFILES).join(', ')}`)
  }
  return { ...profile, ...env }
}
