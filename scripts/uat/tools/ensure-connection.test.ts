/**
 * Tests Red pour ensureConnection (à implémenter dans chromium.ts ou ensure-connection.ts).
 *
 * SIGNATURE IMPOSÉE AU CODER :
 *
 *   export async function ensureConnection(
 *     deps: {
 *       http: Pick<CompanionHttp, 'findConnectionId' | 'enable' | 'restart'>
 *       ui:   Pick<CompanionUi,   'createConnection' | 'openConnectionConfig' | 'fillConfig'>
 *       page: Page
 *     },
 *     label: string,
 *     config: { host: string; port: number; username?: string; password?: string },
 *   ): Promise<void>
 *
 * Flux attendu :
 *   1. http.findConnectionId(label)
 *   2a. Si null  → ui.createConnection(page, label) [crée + ouvre l'éditeur]
 *                → ui.fillConfig(page, config)
 *   2b. Si exist → ui.openConnectionConfig(page, id)
 *                → ui.fillConfig(page, config)
 *   3. Dans les deux cas : http.enable(id) + http.restart(id)
 *   4. Jamais : ui.deleteConnectionViaUi ni aucune suppression
 *
 * L'id retourné par createConnection est obtenu via un second appel findConnectionId
 * après création, ou toute autre mécanique — le test l'ignore, il vérifie seulement
 * que enable/restart sont appelés. Si le coder choisit une autre approche pour
 * résoudre l'id post-création, ce test reste valide.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensureConnection } from './ensure-connection.js'

// ---------------------------------------------------------------------------
// Types mock (interface minimale que le coder doit satisfaire)
// ---------------------------------------------------------------------------

// Page Playwright — opaque pour les tests unitaires, casté en `unknown` pour éviter
// d'importer playwright-core dans le test. Le coder utilise le vrai type Page dans l'impl.
type MockPage = unknown

interface MockHttp {
  findConnectionId: (label: string) => Promise<string | null>
  enable:           (id: string) => Promise<void>
  restart:          (id: string) => Promise<void>
}

interface MockUi {
  createConnection:    (page: MockPage, label: string) => Promise<void>
  openConnectionConfig:(page: MockPage, id: string) => Promise<void>
  fillConfig:          (page: MockPage, fields: { host?: string; port?: number; username?: string; password?: string }) => Promise<void>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakePage: MockPage = {}

function makeHttp(existingId: string | null): { mock: MockHttp; calls: string[] } {
  const calls: string[] = []
  let callCount = 0
  const mock: MockHttp = {
    findConnectionId: async (_label: string) => {
      calls.push('findConnectionId')
      // Premier appel → existingId ; si absent → second appel post-création renvoie un id généré
      callCount++
      if (existingId !== null) return existingId
      return callCount === 1 ? null : 'new-id-001'
    },
    enable:  async (id: string) => { calls.push(`enable:${id}`) },
    restart: async (id: string) => { calls.push(`restart:${id}`) },
  }
  return { mock, calls }
}

function makeUi(): { mock: MockUi; calls: string[]; fillConfigArgs: unknown[] } {
  const calls: string[] = []
  const fillConfigArgs: unknown[] = []
  const mock: MockUi = {
    createConnection:    async (_page: MockPage, label: string) => { calls.push(`createConnection:${label}`) },
    openConnectionConfig:async (_page: MockPage, id: string)    => { calls.push(`openConnectionConfig:${id}`) },
    fillConfig:          async (_page: MockPage, fields: unknown) => { calls.push('fillConfig'); fillConfigArgs.push(fields) },
  }
  return { mock, calls, fillConfigArgs }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('ensureConnection: connexion absente — createConnection + fillConfig + enable + restart', async () => {
  const { mock: http, calls: httpCalls } = makeHttp(null)
  const { mock: ui,   calls: uiCalls, fillConfigArgs } = makeUi()

  await ensureConnection(
    { http, ui, page: fakePage },
    'nvx-uat-rx',
    { host: '192.168.2.9', port: 8443, username: 'admin', password: 'secret' },
  )

  // createConnection appelé exactement une fois
  assert.equal(uiCalls.filter((c) => c.startsWith('createConnection')).length, 1,
    'createConnection must be called exactly once when connection is absent')

  // fillConfig appelé
  assert.ok(uiCalls.includes('fillConfig'), 'fillConfig must be called')

  // enable + restart appelés
  assert.ok(httpCalls.some((c) => c.startsWith('enable:')),  'enable must be called')
  assert.ok(httpCalls.some((c) => c.startsWith('restart:')), 'restart must be called')

  // Jamais de delete
  assert.ok(!uiCalls.some((c) => c.includes('delete') || c.includes('Delete')),
    'no delete must be called')
})

test('ensureConnection: connexion existante — PAS de createConnection, fillConfig + enable + restart', async () => {
  const { mock: http, calls: httpCalls } = makeHttp('existing-id-abc')
  const { mock: ui,   calls: uiCalls } = makeUi()

  await ensureConnection(
    { http, ui, page: fakePage },
    'nvx-uat-rx',
    { host: '192.168.2.9', port: 8443, username: 'admin', password: 'secret' },
  )

  // createConnection jamais appelé
  assert.equal(uiCalls.filter((c) => c.startsWith('createConnection')).length, 0,
    'createConnection must NOT be called when connection already exists')

  // fillConfig (réalignement config)
  assert.ok(uiCalls.includes('fillConfig'), 'fillConfig must be called for config realignment')

  // enable + restart sur l'id existant
  assert.ok(httpCalls.includes('enable:existing-id-abc'),  'enable must be called with existing id')
  assert.ok(httpCalls.includes('restart:existing-id-abc'), 'restart must be called with existing id')

  // Jamais de delete
  assert.ok(!uiCalls.some((c) => c.includes('delete') || c.includes('Delete')),
    'no delete must be called')
})

test('ensureConnection: fillConfig reçoit host, port, username, password corrects', async () => {
  const { mock: http } = makeHttp('existing-id-abc')
  const { mock: ui, fillConfigArgs } = makeUi()

  await ensureConnection(
    { http, ui, page: fakePage },
    'nvx-uat-rx',
    { host: '192.168.2.9', port: 8443, username: 'admin', password: 'secret' },
  )

  assert.equal(fillConfigArgs.length, 1, 'fillConfig must be called exactly once')
  const fields = fillConfigArgs[0] as { host?: string; port?: number; username?: string; password?: string }
  assert.equal(fields.host,     '192.168.2.9', 'fillConfig must receive correct host')
  assert.equal(fields.port,     8443,           'fillConfig must receive correct port (8443)')
  assert.equal(fields.username, 'admin',         'fillConfig must receive correct username')
  assert.equal(fields.password, 'secret',        'fillConfig must receive correct password')
})

test('ensureConnection: jamais de delete dans les deux branches (absent + existant)', async () => {
  for (const existingId of [null, 'some-id']) {
    const { mock: http } = makeHttp(existingId)
    const { mock: ui, calls: uiCalls } = makeUi()

    await ensureConnection(
      { http, ui, page: fakePage },
      'nvx-uat-rx',
      { host: '192.168.2.9', port: 8443 },
    )

    assert.ok(
      !uiCalls.some((c) => c.toLowerCase().includes('delete')),
      `no delete must be called (existingId=${String(existingId)})`,
    )
  }
})

test('ensureConnection: createConnection réussit mais re-findConnectionId renvoie null — rejet clair, pas de enable/restart', async () => {
  // Simule un timing UI/REST : la connexion n'est pas encore indexée après création.
  // Le code actuel caste (id as string) et appelle enable(null) → erreur opaque.
  // Ce test exige un rejet explicite avec un message contenant le label et la cause.
  const httpCalls: string[] = []
  const http: MockHttp = {
    findConnectionId: async (_label: string) => {
      httpCalls.push('findConnectionId')
      return null  // null aux deux appels — 1er (lookup initial) et 2e (post-création)
    },
    enable:  async (id: string) => { httpCalls.push(`enable:${id}`) },
    restart: async (id: string) => { httpCalls.push(`restart:${id}`) },
  }
  const { mock: ui } = makeUi()

  // Message exact attendu — le coder doit aligner son implémentation sur cette chaîne.
  const expectedMessage = "ensureConnection: created connection 'nvx-uat-rx' but could not resolve its id"

  await assert.rejects(
    () => ensureConnection(
      { http, ui, page: fakePage },
      'nvx-uat-rx',
      { host: '192.168.2.9', port: 8443 },
    ),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must throw an Error')
      assert.ok(
        err.message.includes(expectedMessage),
        `error message must include: ${expectedMessage}\n  actual: ${(err as Error).message}`,
      )
      return true
    },
  )

  // enable et restart ne doivent PAS être appelés sur un id null
  assert.ok(!httpCalls.some((c) => c.startsWith('enable:')),  'enable must NOT be called when id is unresolved')
  assert.ok(!httpCalls.some((c) => c.startsWith('restart:')), 'restart must NOT be called when id is unresolved')
})
