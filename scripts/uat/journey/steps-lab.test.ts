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
      status: async () => ({ category: 'good', level: 'OK', message: '' }),
      enable: async () => {},
      disable: async () => {},
      restart: async () => {},
      getVariable: async () => '',
      press: async () => {},
    } as never,
    logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
    oracle: {
      readStream0: async () => ({ RtspSessionName: 'X' }),
      readReceiveStream0: async () => ({ Status: 'Stream Stopped', StreamLocation: '', MulticastAddress: '', SessionInitiation: 'Multicast via RTSP' }),
      captureBaseline: async () => {},
      captureBaselineRx: async () => {},
      restore: async () => {},
      restoreRx: async () => {},
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

test('lab steps include the v0.2 encoder USE ids', () => {
  const ids = labSteps.map((s) => s.id)
  for (const id of ['CAP', 'ENC-VARS', 'ENC-FEEDBACKS', 'ENC-NAME', 'ENC-MULTICAST', 'ENC-ENABLE', 'ENC-DISABLE'])
    assert.ok(ids.includes(id), `missing ${id}`)
})

test('CAP PASSes when device_role is Transmitter', async () => {
  const step = labSteps.find((s) => s.id === 'CAP')!
  const v = await step.run(
    ctx(
      {
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'ok' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => 'Transmitter',
          press: async () => {},
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'PASS')
})

test('a WRITE step SKIPs when its button is not mapped (device present, Transmitter, no layout)', async () => {
  const step = labSteps.find((s) => s.id === 'ENC-NAME')!
  const v = await step.run(ctxWithRole('Transmitter')) // config.layout undefined
  assert.equal(v.status, 'SKIP')
  assert.match(String(v.evidence.note), /layout|SETUP/i)
})

test('every lab step SKIPs without a device (empty nvxPass)', async () => {
  for (const s of labSteps) {
    const v = await s.run(ctx({}, ''))
    assert.equal(v.status, 'SKIP', `${s.id} should SKIP without device`)
  }
})

test('baseline precedes the USE block and teardown is last', () => {
  const ids = labSteps.map((s) => s.id)
  assert.ok(ids.indexOf('BASELINE') < ids.indexOf('CAP'), 'BASELINE before CAP')
  assert.equal(ids[ids.length - 1], 'TEARDOWN', 'TEARDOWN last')
})

test('BASELINE and TEARDOWN PASS with a device', async () => {
  const baseline = labSteps.find((s) => s.id === 'BASELINE')!
  const teardown = labSteps.find((s) => s.id === 'TEARDOWN')!
  assert.equal((await baseline.run(ctx({}, 'realpass'))).status, 'PASS')
  assert.equal((await teardown.run(ctx({}, 'realpass'))).status, 'PASS')
})

test('TEARDOWN FAILs (reports) when restore throws', async () => {
  const teardown = labSteps.find((s) => s.id === 'TEARDOWN')!
  const v = await teardown.run(
    ctx(
      {
        oracle: {
          readStream0: async () => ({}),
          captureBaseline: async () => {},
          restore: async () => {
            throw new Error('device unreachable')
          },
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'FAIL')
  assert.match(String(v.evidence.note), /restore failed/i)
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
          readReceiveStream0: async () => ({ Status: 'Stream Stopped', StreamLocation: '', MulticastAddress: '', SessionInitiation: 'Multicast via RTSP' }),
          captureBaseline: async () => {},
          captureBaselineRx: async () => {},
          restore: async () => {},
          restoreRx: async () => {},
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'FAIL')
})

// ── Decoder steps ─────────────────────────────────────────────────────────────

test('lab steps include the decoder USE ids', () => {
  const ids = labSteps.map((s) => s.id)
  for (const id of ['DEC-CAP', 'BASELINE-RX', 'DEC-VARS', 'DEC-SOURCE-URL', 'DEC-SOURCE-MCAST', 'DEC-CONNECT', 'DEC-ENABLE', 'DEC-DISABLE', 'TEARDOWN-RX'])
    assert.ok(ids.includes(id), `missing ${id}`)
})

test('decoder steps come after encoder USE block and before TEARDOWN', () => {
  const ids = labSteps.map((s) => s.id)
  assert.ok(ids.indexOf('ENC-DISABLE') < ids.indexOf('DEC-CAP'), 'DEC-CAP after ENC-DISABLE')
  assert.ok(ids.indexOf('TEARDOWN-RX') < ids.indexOf('TEARDOWN'), 'TEARDOWN-RX before TEARDOWN')
})

test('DEC-CAP SKIPs (not FAILs) when device is a Transmitter', async () => {
  const step = labSteps.find((s) => s.id === 'DEC-CAP')!
  const v = await step.run(
    ctx(
      {
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'ok' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => 'Transmitter',
          press: async () => {},
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'SKIP')
})

test('DEC-CAP PASSes when device_role is Receiver', async () => {
  const step = labSteps.find((s) => s.id === 'DEC-CAP')!
  const v = await step.run(
    ctx(
      {
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'ok' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => 'Receiver',
          press: async () => {},
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'PASS')
})

test('a DEC WRITE step SKIPs when its button is not mapped (device present, Receiver, no layout)', async () => {
  const step = labSteps.find((s) => s.id === 'DEC-SOURCE-URL')!
  const v = await step.run(ctxWithRole('Receiver')) // config.layout undefined
  assert.equal(v.status, 'SKIP')
  assert.match(String(v.evidence.note), /layout|SETUP/i)
})

test('TEARDOWN-RX PASSes with a device', async () => {
  const step = labSteps.find((s) => s.id === 'TEARDOWN-RX')!
  assert.equal((await step.run(ctx({}, 'realpass'))).status, 'PASS')
})

test('TEARDOWN-RX FAILs when restoreRx throws', async () => {
  const step = labSteps.find((s) => s.id === 'TEARDOWN-RX')!
  const v = await step.run(
    ctx(
      {
        oracle: {
          readStream0: async () => ({ RtspSessionName: 'X' }),
          readReceiveStream0: async () => ({ Status: 'Stream Stopped', StreamLocation: '', MulticastAddress: '', SessionInitiation: 'Multicast via RTSP' }),
          captureBaseline: async () => {},
          captureBaselineRx: async () => {},
          restore: async () => {},
          restoreRx: async () => {
            throw new Error('decoder unreachable')
          },
        } as never,
      },
      'realpass',
    ),
  )
  assert.equal(v.status, 'FAIL')
  assert.match(String(v.evidence.note), /decoder restore failed/i)
})

// ── CFG-WRONGPASS / CFG-GOOD propagate nvxUser ────────────────────────────────

test('CFG-WRONGPASS passes ctx.config.nvxUser (not "admin") to fillConfig', async () => {
  const step = labSteps.find((s) => s.id === 'CFG-WRONGPASS')!
  const captured: { username?: string }[] = []
  const v = await step.run(
    ctx(
      {
        config: {
          companionUrl: 'http://x:8000',
          container: 'c',
          label: 'nvx-uat',
          nvxHost: '192.0.2.1',
          nvxPort: 443,
          nvxUser: 'didier',
          nvxPass: 'realpass',
        },
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'warning', level: 'Warning', message: '' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => '',
          press: async () => {},
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
      },
      'realpass',
    ),
  )
  assert.ok(captured.length > 0, 'fillConfig was not called')
  assert.equal(captured[0].username, 'didier', `expected 'didier', received '${captured[0].username}'`)
  assert.equal(v.status, 'PASS')
})

test('CFG-GOOD passes ctx.config.nvxUser (not "admin") to fillConfig', async () => {
  const step = labSteps.find((s) => s.id === 'CFG-GOOD')!
  const captured: { username?: string }[] = []
  await step.run(
    ctx(
      {
        config: {
          companionUrl: 'http://x:8000',
          container: 'c',
          label: 'nvx-uat',
          nvxHost: '192.0.2.1',
          nvxPort: 443,
          nvxUser: 'didier',
          nvxPass: 'realpass',
        },
        http: {
          findConnectionId: async () => 'abc',
          status: async () => ({ category: 'good', level: 'OK', message: '' }),
          enable: async () => {},
          disable: async () => {},
          restart: async () => {},
          getVariable: async () => '',
          press: async () => {},
        } as never,
        logs: { mark: () => ({ ts: 't' }), detect: () => true } as never,
        oracle: {
          readStream0: async () => ({ RtspSessionName: 'X' }),
          readReceiveStream0: async () => ({ Status: 'Stream Stopped', StreamLocation: '', MulticastAddress: '', SessionInitiation: 'Multicast via RTSP' }),
          captureBaseline: async () => {},
          captureBaselineRx: async () => {},
          restore: async () => {},
          restoreRx: async () => {},
        } as never,
        ui: {
          open: async () => ({}),
          close: async () => {},
          moduleAvailable: async () => true,
          openConnectionConfig: async () => {},
          fillConfig: async (_page: unknown, fields: { username?: string }) => {
            captured.push(fields)
          },
        } as never,
      },
      'realpass',
    ),
  )
  assert.ok(captured.length > 0, 'fillConfig was not called')
  assert.equal(captured[0].username, 'didier', `expected 'didier', received '${captured[0].username}'`)
})

// ── Role guards in writeStep / writeStepRx (bug #3) ──────────────────────────

/** ctx with device present and getVariable always returning `role` */
function ctxWithRole(role: string): JourneyContext {
  return ctx(
    {
      http: {
        findConnectionId: async () => 'abc',
        status: async () => ({ category: 'ok' }),
        enable: async () => {},
        disable: async () => {},
        restart: async () => {},
        getVariable: async () => role,
        press: async () => {},
      } as never,
    },
    'realpass',
  )
}

test('ENC-NAME (writeStep) SKIPs — not FAILs — when device_role is Receiver', async () => {
  const step = labSteps.find((s) => s.id === 'ENC-NAME')!
  // Provide a layout so the button IS mapped — role check must fire before pressMapped.
  const c = ctxWithRole('Receiver')
  c.config.layout = { set_stream_name: { page: 1, row: 0, col: 0 } }
  const v = await step.run(c)
  assert.equal(v.status, 'SKIP', 'ENC-NAME must SKIP on a Receiver, not FAIL')
})

test('DEC-SOURCE-URL (writeStepRx) SKIPs — not FAILs — when device_role is Transmitter', async () => {
  const step = labSteps.find((s) => s.id === 'DEC-SOURCE-URL')!
  // Provide a layout so the button IS mapped — role check must fire before pressMapped.
  const c = ctxWithRole('Transmitter')
  c.config.layout = { set_source_url: { page: 1, row: 0, col: 0 } }
  const v = await step.run(c)
  assert.equal(v.status, 'SKIP', 'DEC-SOURCE-URL must SKIP on a Transmitter, not FAIL')
})
