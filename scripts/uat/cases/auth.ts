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
