import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadJourneyConfig, ensureFreshConnection, loadLayout } from './run-journey.js'
import type { JourneyContext, JourneyConfig } from './types.js'

test('loadJourneyConfig — hors lab, NVX_USER absent → défaut admin toléré', () => {
  const cfg = loadJourneyConfig({ NVX_HOST: '192.0.2.1' })
  assert.equal(cfg.nvxUser, 'admin')
})

test('loadJourneyConfig — hors lab, NVX_USER présent → utilisé', () => {
  const cfg = loadJourneyConfig({ NVX_HOST: '192.0.2.1', NVX_USER: 'didier' })
  assert.equal(cfg.nvxUser, 'didier')
})

test('loadJourneyConfig — mode lab, NVX_USER présent → utilisé sans erreur', () => {
  const cfg = loadJourneyConfig({ UAT_LAB: '1', NVX_HOST: '10.0.0.10', NVX_USER: 'admin' })
  assert.equal(cfg.nvxUser, 'admin')
})

test('loadJourneyConfig — mode lab, NVX_USER absent → throw avec message explicite', () => {
  assert.throws(
    () => loadJourneyConfig({ UAT_LAB: '1', NVX_HOST: '10.0.0.10' }),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.ok(err.message.includes('NVX_USER'), `message manque NVX_USER : ${err.message}`)
      assert.ok(err.message.includes('lab'), `message manque 'lab' : ${err.message}`)
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// ensureFreshConnection — provision unifiée (Task 4)
//
// Ces tests vérifient que le chemin !keep aboutit à une connexion configurée
// (fillConfig appelé avec username = ctx.config.nvxUser) ET enabled+restarted,
// à parité avec ensureConnection.
// Pattern de spies identique à ensure-connection.test.ts.
// ---------------------------------------------------------------------------

type FakePage = Record<string, never>
const fakePage: FakePage = {}

function makeCtx(opts: {
  existingId: string | null
  nvxUser?: string
  nvxPass?: string
  nvxHost?: string
  nvxPort?: number
}): {
  ctx: JourneyContext
  httpCalls: string[]
  uiCalls: string[]
  fillConfigArgs: unknown[]
} {
  const httpCalls: string[] = []
  const uiCalls: string[] = []
  const fillConfigArgs: unknown[] = []

  let findCount = 0
  const http = {
    findConnectionId: async (_label: string) => {
      httpCalls.push('findConnectionId')
      findCount++
      if (opts.existingId !== null) return opts.existingId
      return findCount === 1 ? null : 'fresh-id-001'
    },
    enable:  async (id: string) => { httpCalls.push(`enable:${id}`) },
    restart: async (id: string) => { httpCalls.push(`restart:${id}`) },
  }

  const ui = {
    open:  async () => fakePage as unknown as ReturnType<JourneyContext['ui']['open']>,
    close: async () => { uiCalls.push('close') },
    createConnection:    async (_page: unknown, label: string) => { uiCalls.push(`createConnection:${label}`) },
    deleteConnectionViaUi: async (_page: unknown, id: string) => { uiCalls.push(`delete:${id}`) },
    openConnectionConfig: async (_page: unknown, id: string) => { uiCalls.push(`openConnectionConfig:${id}`) },
    fillConfig: async (_page: unknown, fields: unknown) => {
      uiCalls.push('fillConfig')
      fillConfigArgs.push(fields)
    },
  }

  const cfg: JourneyConfig = {
    companionUrl: 'http://localhost:8000',
    container: 'test',
    label: 'nvx-uat-rx',
    nvxHost: opts.nvxHost ?? '192.168.2.9',
    nvxPort: opts.nvxPort ?? 8443,
    nvxUser: opts.nvxUser ?? 'didier',
    nvxPass: opts.nvxPass ?? 'secret',
  }

  const ctx: JourneyContext = {
    config: cfg,
    http: http as unknown as JourneyContext['http'],
    logs: {} as JourneyContext['logs'],
    oracle: {} as JourneyContext['oracle'],
    ui: ui as unknown as JourneyContext['ui'],
    sleep: async () => {},
  }

  return { ctx, httpCalls, uiCalls, fillConfigArgs }
}

test('ensureFreshConnection: connexion absente → fillConfig appelé avec username = nvxUser', async () => {
  const { ctx, uiCalls, fillConfigArgs } = makeCtx({ existingId: null, nvxUser: 'didier' })

  await ensureFreshConnection(ctx)

  assert.ok(uiCalls.includes('fillConfig'), 'fillConfig must be called')
  assert.equal(fillConfigArgs.length, 1, 'fillConfig must be called exactly once')
  const fields = fillConfigArgs[0] as { username?: string }
  assert.equal(fields.username, 'didier', 'fillConfig must receive nvxUser as username')
})

test('ensureFreshConnection: connexion absente → enable + restart appelés', async () => {
  const { ctx, httpCalls } = makeCtx({ existingId: null })

  await ensureFreshConnection(ctx)

  assert.ok(httpCalls.some((c) => c.startsWith('enable:')),  'enable must be called')
  assert.ok(httpCalls.some((c) => c.startsWith('restart:')), 'restart must be called')
})

test('ensureFreshConnection: connexion existante → delete puis fillConfig + enable + restart', async () => {
  const { ctx, httpCalls, uiCalls, fillConfigArgs } = makeCtx({ existingId: 'old-id-xyz', nvxUser: 'didier' })

  await ensureFreshConnection(ctx)

  // delete de l'ancienne connexion
  assert.ok(uiCalls.some((c) => c.startsWith('delete:')), 'existing connection must be deleted')

  // config remplie
  assert.ok(uiCalls.includes('fillConfig'), 'fillConfig must be called after delete+create')
  const fields = fillConfigArgs[0] as { username?: string }
  assert.equal(fields.username, 'didier', 'fillConfig must receive nvxUser as username')

  // enabled + restarted
  assert.ok(httpCalls.some((c) => c.startsWith('enable:')),  'enable must be called')
  assert.ok(httpCalls.some((c) => c.startsWith('restart:')), 'restart must be called')
})

// ── isFake câblé via UAT_FAKE (Task 6 — finding CRITICAL) ────────────────────

test('loadJourneyConfig — UAT_FAKE absent → isFake === false', () => {
  const cfg = loadJourneyConfig({ NVX_HOST: '192.0.2.1' })
  assert.equal(cfg.isFake, false, 'isFake doit valoir false quand UAT_FAKE est absent')
})

test("loadJourneyConfig — UAT_FAKE='1' → isFake === true", () => {
  const cfg = loadJourneyConfig({ NVX_HOST: '192.0.2.1', UAT_FAKE: '1' })
  assert.equal(cfg.isFake, true, "isFake doit valoir true quand UAT_FAKE='1'")
})

test("loadJourneyConfig — UAT_FAKE='0' → isFake === false", () => {
  const cfg = loadJourneyConfig({ NVX_HOST: '192.0.2.1', UAT_FAKE: '0' })
  assert.equal(cfg.isFake, false, "isFake doit valoir false quand UAT_FAKE='0' (pas '1')")
})

test('ensureFreshConnection: fillConfig reçoit host, port, username, password corrects', async () => {
  const { ctx, fillConfigArgs } = makeCtx({
    existingId: null,
    nvxHost: '192.168.2.10',
    nvxPort: 443,
    nvxUser: 'didier',
    nvxPass: 'topsecret',
  })

  await ensureFreshConnection(ctx)

  const fields = fillConfigArgs[0] as { host?: string; port?: number; username?: string; password?: string }
  assert.equal(fields.host,     '192.168.2.10', 'fillConfig must receive correct host')
  assert.equal(fields.port,     443,             'fillConfig must receive correct port')
  assert.equal(fields.username, 'didier',        'fillConfig must receive correct username')
  assert.equal(fields.password, 'topsecret',     'fillConfig must receive correct password')
})

// ── Task 8: loadLayout — erreurs franches sur JSON malformé ──────────────────

test('loadLayout — UAT_LAYOUT absent → undefined (comportement nominal inchangé)', () => {
  // Sans fixture présent, la lecture échoue silencieusement → undefined.
  // Ce test vérifie que le chemin "absent" n'est pas cassé par le fix.
  const result = loadLayout({ UAT_LAYOUT: undefined })
  // Peut être undefined (fixture absente ou présente) — juste ne pas throw.
  assert.ok(result === undefined || typeof result === 'object')
})

test('loadLayout — UAT_LAYOUT = JSON invalide → throw avec message mentionnant UAT_LAYOUT ou parse', () => {
  assert.throws(
    () => loadLayout({ UAT_LAYOUT: '{ invalid json' }),
    (err: unknown) => {
      assert.ok(err instanceof Error, `attendu Error, reçu ${typeof err}`)
      const msg = err.message.toLowerCase()
      assert.ok(
        msg.includes('uat_layout') || msg.includes('parse') || msg.includes('json'),
        `message doit mentionner UAT_LAYOUT ou parse/json, reçu : "${err.message}"`,
      )
      return true
    },
  )
})
