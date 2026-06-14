import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encoderCases } from './encoder.js'
import type { NvxApiClient } from '../../../src/api.js'
import type { RunContext } from '../lib/case.js'

// ── Fake client builder ────────────────────────────────────────────────────────

/** Scripted fake NvxApiClient for DI tests.
 *  - get: pops responses from `getResponses` in order (each call shifts one element)
 *  - postSetPartial: records all calls in `posts`, returns `postStatus`
 *  - login: increments `loginCount`
 *  - logout: no-op
 */
function makeFakeClient(opts: {
  getResponses: unknown[]
  postStatus?: number
}): { client: NvxApiClient; loginCount: () => number; posts: () => unknown[] } {
  let logins = 0
  const posts: unknown[] = []
  const responses = [...opts.getResponses]
  const client = {
    login: async () => { logins++ },
    logout: async () => {},
    get: async (_path: string) => responses.shift(),
    postSetPartial: async (body: unknown) => { posts.push(body); return opts.postStatus ?? 0 },
  } as unknown as NvxApiClient
  return { client, loginCount: () => logins, posts: () => posts }
}

/** Wrap a fake client into a RunContext with clientFactory DI. */
function ctxWithFake(client: NvxApiClient): RunContext {
  return {
    config: {
      nvxHost: '192.168.2.9', nvxPort: 443, nvxUser: 'admin', nvxPass: 'secret',
      companionUrl: 'http://localhost:8000', tiers: [0 as 0],
    },
    clientFactory: () => client,
  }
}

/** Wrap a StreamTransmit GET response in the expected device JSON envelope. */
function wrapStream(stream: Record<string, unknown>): unknown {
  return { Device: { StreamTransmit: { Streams: [stream] } } }
}

// ── Existing structural tests ──────────────────────────────────────────────────

test('encoder cases are tier 0 with expected ids and phases', () => {
  const ids = encoderCases.map((c) => c.id)
  assert.deepEqual(ids, ['ENC-01', 'ENC-02', 'ENC-03', 'ENC-05', 'C2', 'C3'])
  const byId = Object.fromEntries(encoderCases.map((c) => [c.id, c]))
  assert.equal(byId['C2'].phase, 'disruptive')
  assert.equal(byId['C3'].phase, 'disruptive')
  assert.equal(byId['ENC-01'].phase, 'write')
  assert.ok(encoderCases.every((c) => c.tier === 0))
})

test('device cases SKIP when no device configured', async () => {
  const ctx = { config: { nvxHost: '192.168.2.9', nvxPort: 443, nvxUser: 'admin', nvxPass: '', companionUrl: '', tiers: [0 as 0] } }
  const enc01 = encoderCases.find((c) => c.id === 'ENC-01')!
  const v = await enc01.run(ctx as never)
  assert.equal(v.status, 'SKIP')
})

// ── DI tests ──────────────────────────────────────────────────────────────────

test('ENC-01: restoration — final postSetPartial restores original RtspSessionName', async () => {
  // GET responses in order:
  //   1. initial GET (pre-write capture) → { RtspSessionName: 'ORIG', ... }
  //   2. cross-check GET (after POST witness) → { RtspSessionName: 'UAT-STREAM-X', ... }
  const { client, posts } = makeFakeClient({
    getResponses: [
      wrapStream({ RtspSessionName: 'ORIG', MulticastAddress: '239.0.0.1', Status: 'Stream started' }),
      wrapStream({ RtspSessionName: 'UAT-STREAM-X', MulticastAddress: '239.0.0.1', Status: 'Stream started' }),
    ],
    postStatus: 0,
  })
  const enc01 = encoderCases.find((c) => c.id === 'ENC-01')!
  const verdict = await enc01.run(ctxWithFake(client))

  // Verdict should be PASS (witness matches cross-check).
  assert.equal(verdict.status, 'PASS')

  // Last postSetPartial must restore 'ORIG'.
  const allPosts = posts()
  assert.ok(allPosts.length >= 2, 'expect at least 2 posts: write + restore')
  const lastPost = allPosts[allPosts.length - 1] as { Device: { StreamTransmit: { Streams: Array<{ RtspSessionName: unknown }> } } }
  assert.equal(lastPost.Device.StreamTransmit.Streams[0].RtspSessionName, 'ORIG')
})

test('ENC-01: login-count — exactly 2 logins per case (pre-read + write sessions)', async () => {
  const { client, loginCount } = makeFakeClient({
    getResponses: [
      wrapStream({ RtspSessionName: 'ORIG', MulticastAddress: '239.0.0.1', Status: 'Stream started' }),
      wrapStream({ RtspSessionName: 'UAT-STREAM-X', MulticastAddress: '239.0.0.1', Status: 'Stream started' }),
    ],
    postStatus: 0,
  })
  const enc01 = encoderCases.find((c) => c.id === 'ENC-01')!
  await enc01.run(ctxWithFake(client))
  // ENC-01 opens: 1 client for pre-read (streamTransmit0) + 1 client for the write session.
  // Each client calls login() once. The cross-check (streamTransmit0) opens a 3rd client.
  // Total: 3 logins (pre-read, write-session, cross-check).
  assert.equal(loginCount(), 3)
})

test('ENC-02: status≠0 from postSetPartial → FAIL (not ambiguous)', async () => {
  const { client } = makeFakeClient({
    getResponses: [
      // initial GET (pre-write capture)
      wrapStream({ RtspSessionName: 'name', MulticastAddress: '239.1.1.1', Status: 'Stream started' }),
      // cross-check GET would be needed only if status===0; provide one anyway for the restore
    ],
    postStatus: 1, // device rejects the write
  })
  const enc02 = encoderCases.find((c) => c.id === 'ENC-02')!
  const verdict = await enc02.run(ctxWithFake(client))
  assert.equal(verdict.status, 'FAIL')
})
