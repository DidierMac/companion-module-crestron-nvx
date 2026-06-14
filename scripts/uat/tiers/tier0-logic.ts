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

  // Silent logger — no output during UAT unit tests; mirrors capture-nvx.ts pattern.
  const rootLogger = new ModuleLogger(() => {}, '[UAT]', false)
  const authLogger = rootLogger.child('[AUTH]')
  const httpLogger = rootLogger.child('[HTTP]')

  return new NvxApiClient(moduleConfig, secrets, authLogger, httpLogger)
}
