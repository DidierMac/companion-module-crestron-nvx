import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { NvxApiClient, NvxAuthError } from './api.js'
import { ModuleLogger } from './logger.js'
import type { ModuleConfig, ModuleSecrets } from './config.js'

function fakeRes(statusCode: number, headers: Record<string, unknown> = {}): IncomingMessage {
  const r = Readable.from(['']) as unknown as IncomingMessage
  ;(r as unknown as { statusCode: number }).statusCode = statusCode
  ;(r as unknown as { headers: Record<string, unknown> }).headers = headers
  return r
}

function makeClient(secrets: ModuleSecrets): NvxApiClient {
  const config: ModuleConfig = {
    host: '10.0.0.1', port: 443, username: 'admin',
    pollInterval: 2000, ignoreSelfSignedCert: true, verbose: false,
  }
  const silent = new ModuleLogger(() => {}, '', false)
  return new NvxApiClient(config, secrets, silent.child('[AUTH]'), silent.child('[HTTP]'))
}

// Replace the private HTTP transport with canned responses; capture requests.
function stubTransport(client: NvxApiClient, postStatus: number): { method: string; path: string; body?: string }[] {
  const captured: { method: string; path: string; body?: string }[] = []
  ;(client as unknown as { rawRequest: unknown }).rawRequest = async (method: string, path: string, body?: string) => {
    captured.push({ method, path, body })
    if (method === 'GET' && path === '/userlogin.html') return fakeRes(200, { 'set-cookie': ['TRACKID=test-token'] })
    if (method === 'POST' && path === '/userlogin.html') return fakeRes(postStatus, { 'set-cookie': ['AuthByPasswd=1'] })
    return fakeRes(404)
  }
  return captured
}

test('login() sends the password from secrets, not config', async () => {
  const client = makeClient({ password: 's3cr3t' })
  const captured = stubTransport(client, 302)
  await client.login()
  const post = captured.find((c) => c.method === 'POST')
  assert.ok(post, 'a POST request was made')
  assert.equal(post?.body, 'login=admin&passwd=s3cr3t')
})

test('login() throws NvxAuthError on HTTP 403', async () => {
  const client = makeClient({ password: 'wrong' })
  stubTransport(client, 403)
  await assert.rejects(() => client.login(), NvxAuthError)
})

test('login() throws NvxAuthError on HTTP 401', async () => {
  const client = makeClient({ password: 'wrong' })
  stubTransport(client, 401)
  await assert.rejects(() => client.login(), NvxAuthError)
})

test('login() throws a generic Error (not NvxAuthError) on HTTP 500', async () => {
  const client = makeClient({ password: 'x' })
  stubTransport(client, 500)
  await assert.rejects(() => client.login(), (err: unknown) => {
    assert.ok(err instanceof Error)
    assert.ok(!(err instanceof NvxAuthError), 'transient errors must not be NvxAuthError')
    return true
  })
})

test('login() accepts HTTP 200 as success (NVX firmware returns 200, not 302)', async () => {
  const client = makeClient({ password: 'good' })
  stubTransport(client, 200)
  await client.login() // must not throw
})

// ── Durcissement Vague 1 (code-review) ───────────────────────────────────────

// Helper local : fakeRes renvoie un body VIDE (adapté à login qui drainBody).
// Pour les routes qui passent par request() → JSON.parse(body), il faut un body JSON non vide.
function fakeResWithBody(statusCode: number, jsonBody: unknown, headers: Record<string, unknown> = {}): IncomingMessage {
  // Readable.from() avec une string émet des chunks de type string, incompatibles avec Buffer.concat().
  // On passe un Buffer pour que readBody() dans api.ts puisse faire Buffer.concat([chunk]).
  const r = Readable.from([Buffer.from(JSON.stringify(jsonBody))]) as unknown as IncomingMessage
  ;(r as unknown as { statusCode: number }).statusCode = statusCode
  ;(r as unknown as { headers: Record<string, unknown> }).headers = { ...headers }
  return r
}

test('postSetPartial routes to POST /Device with the body intact (transport-level stub)', async () => {
  const client = makeClient({ password: 'x' })

  const captured: { method: string; path: string; body?: string }[] = []
  const okEnvelope = { Actions: [{ Results: [{ StatusId: 0 }] }] }

  // On stubbe rawRequest (transport bas niveau) — différent de stubber request() —
  // pour vérifier que la sérialisation + le routage HTTP sont corrects de bout en bout.
  // Le body doit être parseable (JSON.parse dans request()), d'où fakeResWithBody.
  ;(client as unknown as { rawRequest: unknown }).rawRequest = async (
    method: string,
    path: string,
    body?: string,
  ) => {
    captured.push({ method, path, body })
    return fakeResWithBody(200, okEnvelope)
  }

  const payload = { Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'cam1' }] } } }
  await client.postSetPartial(payload)

  const req = captured.find((c) => c.method === 'POST' && c.path === '/Device')
  assert.ok(req, 'un POST vers /Device doit être émis')
  assert.equal(req?.body, JSON.stringify(payload), 'le body transmis doit être le payload sérialisé intact')
})

test('postSetPartial returns the StatusId from the Actions envelope', async () => {
  const client = makeClient({ password: 'x' })
  ;(client as unknown as { request: unknown }).request = async () => ({
    Actions: [{ Operation: 'SetPartial', Results: [{ StatusId: 0, StatusInfo: 'OK' }] }],
  })
  const status = await client.postSetPartial({ Device: { StreamTransmit: { Streams: [{ RtspSessionName: 'x' }] } } })
  assert.equal(status, 0)
})

test('postSetPartial returns -1 when the envelope is malformed', async () => {
  const client = makeClient({ password: 'x' })
  ;(client as unknown as { request: unknown }).request = async () => ({})
  assert.equal(await client.postSetPartial({}), -1)
})
