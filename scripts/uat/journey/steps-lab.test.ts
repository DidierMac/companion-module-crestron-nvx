import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labSteps } from './steps-lab.js'
import type { JourneyContext } from './types.js'

function ctx(over: Partial<JourneyContext> = {}, nvxPass = ''): JourneyContext {
  const base = {
    config: {
      companionUrl: 'http://x:8000',
      container: 'c',
      label: 'nvx-uat',
      nvxHost: '192.0.2.1',
      nvxPass,
    },
    http: {
      findConnectionId: async () => 'abc',
      status: async () => ({ category: 'ok', level: 'OK', message: '' }),
      enable: async () => {},
      disable: async () => {},
      restart: async () => {},
      getVariable: async () => '',
      press: async () => {},
    } as never,
    logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
    oracle: {
      readStream0: async () => ({ RtspSessionName: 'X' }),
      captureBaseline: async () => {},
      restore: async () => {},
    } as never,
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

test('all lab steps are scope:lab', () => {
  assert.ok(labSteps.length > 0)
  assert.ok(labSteps.every((s) => s.scope === 'lab'))
})

test('lab steps include the auth gauntlet ids', () => {
  const ids = labSteps.map((s) => s.id)
  assert.ok(ids.includes('CFG-WRONGPASS'))
  assert.ok(ids.includes('CFG-GOOD'))
})

test('every lab step SKIPs without a device (empty nvxPass)', async () => {
  for (const s of labSteps) {
    const v = await s.run(ctx({}, ''))
    assert.equal(v.status, 'SKIP', `${s.id} should SKIP without device`)
  }
})

test('CFG-GOOD PASSes when status ok AND oracle reads a stream (with device)', async () => {
  const step = labSteps.find((s) => s.id === 'CFG-GOOD')!
  const v = await step.run(ctx({}, 'realpass'))
  assert.equal(v.status, 'PASS')
})

test('CFG-GOOD FAILs when the oracle cannot read a stream', async () => {
  const step = labSteps.find((s) => s.id === 'CFG-GOOD')!
  const v = await step.run(
    ctx(
      {
        oracle: {
          readStream0: async () => {
            throw new Error('no session')
          },
          captureBaseline: async () => {},
          restore: async () => {},
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'FAIL')
})
