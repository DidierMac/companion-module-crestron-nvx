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
