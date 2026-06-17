import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localSteps } from './steps-local.js'
import type { JourneyContext } from './types.js'

function ctx(over: Partial<JourneyContext> = {}): JourneyContext {
  const base = {
    config: {
      companionUrl: 'http://x:8000',
      container: 'c',
      label: 'nvx-uat',
      nvxHost: '192.0.2.1',
      nvxPass: '',
    },
    http: {
      findConnectionId: async () => 'abc',
      status: async () => ({ category: 'error', level: 'Connection Failure', message: 'NVX timeout' }),
      enable: async () => {},
      disable: async () => {},
      restart: async () => {},
    } as never,
    logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
    oracle: {} as never,
    ui: {
      open: async () => ({}),
      close: async () => {},
      moduleAvailable: async () => true,
      openConnectionConfig: async () => {},
      fillConfig: async () => {},
    } as never,
    sleep: async () => {},
  }
  return { ...base, ...over } as JourneyContext
}

test('local steps are all scope:local with expected ids', () => {
  assert.deepEqual(
    localSteps.map((s) => s.id),
    ['INSTALL', 'CFG-NOPASS', 'CFG-UNREACHABLE'],
  )
  assert.ok(localSteps.every((s) => s.scope === 'local'))
})

test('INSTALL PASSes when the module is available', async () => {
  const step = localSteps.find((s) => s.id === 'INSTALL')!
  assert.equal((await step.run(ctx())).status, 'PASS')
})

test('INSTALL FAILs when the module is not available', async () => {
  const step = localSteps.find((s) => s.id === 'INSTALL')!
  const v = await step.run(ctx({ ui: { open: async () => ({}), close: async () => {}, moduleAvailable: async () => false, fillConfig: async () => {} } as never }))
  assert.equal(v.status, 'FAIL')
})

test('CFG-UNREACHABLE PASSes when status=error AND log detects the cause', async () => {
  const step = localSteps.find((s) => s.id === 'CFG-UNREACHABLE')!
  assert.equal((await step.run(ctx())).status, 'PASS')
})

test('CFG-UNREACHABLE FAILs when the log does NOT show the expected cause', async () => {
  const step = localSteps.find((s) => s.id === 'CFG-UNREACHABLE')!
  const v = await step.run(ctx({ logs: { mark: () => ({ ts: 't' }), detect: () => false } as never }))
  assert.equal(v.status, 'FAIL') // status alone is not enough — the log must prove the cause
})

test('a config step FAILs cleanly when the connection is absent', async () => {
  const step = localSteps.find((s) => s.id === 'CFG-UNREACHABLE')!
  const v = await step.run(ctx({ http: { findConnectionId: async () => null, restart: async () => {}, status: async () => ({ category: 'error' }), enable: async () => {}, disable: async () => {} } as never }))
  assert.equal(v.status, 'FAIL')
  assert.match(String(v.evidence.note), /not found/i)
})

// ── CFG-NOPASS / CFG-UNREACHABLE propagate nvxUser ───────────────────────────

test('CFG-NOPASS passes ctx.config.nvxUser (not "admin") to fillConfig', async () => {
  const step = localSteps.find((s) => s.id === 'CFG-NOPASS')!
  const captured: { username?: string }[] = []
  const v = await step.run(
    ctx({
      config: {
        companionUrl: 'http://x:8000',
        container: 'c',
        label: 'nvx-uat',
        nvxHost: '192.0.2.1',
        nvxPort: 443,
        nvxUser: 'didier',
        nvxPass: '',
      },
      http: {
        findConnectionId: async () => 'abc',
        status: async () => ({ category: 'warning', level: 'Warning', message: '' }),
        enable: async () => {},
        disable: async () => {},
        restart: async () => {},
      } as never,
      logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
      ui: {
        open: async () => ({}),
        close: async () => {},
        moduleAvailable: async () => true,
        openConnectionConfig: async () => {},
        fillConfig: async (_page: unknown, fields: { username?: string }) => {
          captured.push(fields)
        },
      } as never,
    }),
  )
  assert.ok(captured.length > 0, 'fillConfig was not called')
  assert.equal(captured[0].username, 'didier', `expected 'didier', received '${captured[0].username}'`)
  assert.equal(v.status, 'PASS')
})

test('CFG-UNREACHABLE passes ctx.config.nvxUser (not "admin") to fillConfig', async () => {
  const step = localSteps.find((s) => s.id === 'CFG-UNREACHABLE')!
  const captured: { username?: string }[] = []
  const v = await step.run(
    ctx({
      config: {
        companionUrl: 'http://x:8000',
        container: 'c',
        label: 'nvx-uat',
        nvxHost: '192.0.2.1',
        nvxPort: 443,
        nvxUser: 'didier',
        nvxPass: '',
      },
      http: {
        findConnectionId: async () => 'abc',
        status: async () => ({ category: 'error', level: 'Connection Failure', message: 'NVX timeout' }),
        enable: async () => {},
        disable: async () => {},
        restart: async () => {},
      } as never,
      logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
      ui: {
        open: async () => ({}),
        close: async () => {},
        moduleAvailable: async () => true,
        openConnectionConfig: async () => {},
        fillConfig: async (_page: unknown, fields: { username?: string }) => {
          captured.push(fields)
        },
      } as never,
    }),
  )
  assert.ok(captured.length > 0, 'fillConfig was not called')
  assert.equal(captured[0].username, 'didier', `expected 'didier', received '${captured[0].username}'`)
  assert.equal(v.status, 'PASS')
})
