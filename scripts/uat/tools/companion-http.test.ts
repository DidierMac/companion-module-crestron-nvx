import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CompanionHttp, HttpError } from './companion-http.js'

function fake(routes: Record<string, unknown>) {
  return (async (url: string, init?: { method?: string }) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    const body = routes[key] ?? routes[url]
    if (body === undefined)
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as Response
    return { ok: true, status: 200, text: async () => String(body), json: async () => body } as Response
  }) as typeof fetch
}

test('findConnectionId resolves id by label', async () => {
  const c = new CompanionHttp(
    'http://x:8000',
    fake({
      'http://x:8000/api/connections': [
        { id: 'abc', label: 'nvx-uat', moduleId: 'crestron-nvx', enabled: true },
      ],
    }),
  )
  assert.equal(await c.findConnectionId('nvx-uat'), 'abc')
  assert.equal(await c.findConnectionId('absent'), null)
})

test('status returns the nested .status object (category/level/message)', async () => {
  // Wave-0 capture: GET /api/connections/:id/status → { id, label, enabled, status: {…} }
  const c = new CompanionHttp(
    'http://x:8000',
    fake({
      'http://x:8000/api/connections/abc/status': {
        id: 'abc',
        label: 'nvx-uat',
        enabled: true,
        status: { category: 'error', level: 'Connection Failure', message: 'NVX timeout: GET /userlogin.html' },
      },
    }),
  )
  const s = await c.status('abc')
  assert.equal(s.category, 'error')
  assert.equal(s.level, 'Connection Failure')
  assert.equal(s.message, 'NVX timeout: GET /userlogin.html')
})

test('getVariable reads and trims the value', async () => {
  const c = new CompanionHttp(
    'http://x:8000',
    fake({ 'http://x:8000/api/variable/nvx-uat/device_role/value': 'Transmitter' }),
  )
  assert.equal(await c.getVariable('nvx-uat', 'device_role'), 'Transmitter')
})

test('findConnectionId throws on non-OK /api/connections', async () => {
  const c = new CompanionHttp('http://x:8000', fake({})) // 404 for everything
  await assert.rejects(() => c.findConnectionId('nvx-uat'), /HTTP 404/)
})

/** Fake fetch qui retourne toujours un statut non-OK donné (identique au pattern de fake()). */
function fakeStatus(status: number): typeof fetch {
  return (async () =>
    ({ ok: false, status, text: async () => '', json: async () => ({}) }) as Response
  ) as typeof fetch
}

// ── M6 : HttpError — les erreurs HTTP transportent un statut typé (.status) ──
// Tous ces tests échouent en phase RED : HttpError n'est pas encore exporté depuis companion-http.ts.
// Ils passent une fois le coder ayant ajouté `export class HttpError extends Error { readonly status }`.

test('getVariable rejette une HttpError dont le .status vaut 404', async () => {
  const c = new CompanionHttp('http://x:8000', fake({})) // 404 pour toutes les routes
  await assert.rejects(
    () => c.getVariable('nvx-uat', 'device_role'),
    (err: unknown) => {
      assert.ok(err instanceof HttpError, `attendu HttpError, reçu ${Object.prototype.toString.call(err)}`)
      assert.equal((err as HttpError).status, 404)
      return true
    },
  )
})

test('findConnectionId rejette une HttpError dont le .status vaut 404', async () => {
  const c = new CompanionHttp('http://x:8000', fake({}))
  await assert.rejects(
    () => c.findConnectionId('nvx-uat'),
    (err: unknown) => {
      assert.ok(err instanceof HttpError, `attendu HttpError, reçu ${Object.prototype.toString.call(err)}`)
      assert.equal((err as HttpError).status, 404)
      return true
    },
  )
})

test('findConnectionId rejette une HttpError dont le .status vaut 500', async () => {
  const c = new CompanionHttp('http://x:8000', fakeStatus(500))
  await assert.rejects(
    () => c.findConnectionId('nvx-uat'),
    (err: unknown) => {
      assert.ok(err instanceof HttpError, `attendu HttpError, reçu ${Object.prototype.toString.call(err)}`)
      assert.equal((err as HttpError).status, 500)
      return true
    },
  )
})

test('status rejette une HttpError dont le .status vaut 404', async () => {
  const c = new CompanionHttp('http://x:8000', fake({}))
  await assert.rejects(
    () => c.status('abc'),
    (err: unknown) => {
      assert.ok(err instanceof HttpError, `attendu HttpError, reçu ${Object.prototype.toString.call(err)}`)
      assert.equal((err as HttpError).status, 404)
      return true
    },
  )
})

test('status rejette une HttpError dont le .status vaut 500', async () => {
  const c = new CompanionHttp('http://x:8000', fakeStatus(500))
  await assert.rejects(
    () => c.status('abc'),
    (err: unknown) => {
      assert.ok(err instanceof HttpError, `attendu HttpError, reçu ${Object.prototype.toString.call(err)}`)
      assert.equal((err as HttpError).status, 500)
      return true
    },
  )
})

test('press rejette une HttpError dont le .status vaut 404', async () => {
  const c = new CompanionHttp('http://x:8000', fake({}))
  await assert.rejects(
    () => c.press(1, 0, 0),
    (err: unknown) => {
      assert.ok(err instanceof HttpError, `attendu HttpError, reçu ${Object.prototype.toString.call(err)}`)
      assert.equal((err as HttpError).status, 404)
      return true
    },
  )
})

test('press rejette une HttpError dont le .status vaut 500', async () => {
  const c = new CompanionHttp('http://x:8000', fakeStatus(500))
  await assert.rejects(
    () => c.press(1, 0, 0),
    (err: unknown) => {
      assert.ok(err instanceof HttpError, `attendu HttpError, reçu ${Object.prototype.toString.call(err)}`)
      assert.equal((err as HttpError).status, 500)
      return true
    },
  )
})
