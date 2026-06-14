import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CompanionHttp } from './companion-http.js'

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
