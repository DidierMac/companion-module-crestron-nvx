import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activePanels, composeVariableDefinitions } from './registry.js'
import type { Panel, PanelContext } from './types.js'

const fakePanel = (id: string, gate: (ctx: PanelContext) => boolean, vars: string[]): Panel => ({
  id,
  endpoint: `/Device/${id}`,
  gate,
  variableDefinitions: Object.fromEntries(vars.map((v) => [v, { name: v }])),
  readVariables: () => ({}),
  buildActions: () => ({}),
  buildFeedbacks: () => ({}),
})

const ctxTx: PanelContext = { caps: { canEncode: true, canDecode: true, canSwitchMode: true }, role: 'Transmitter' }

test('activePanels keeps only panels whose gate passes', () => {
  const always = fakePanel('always', () => true, ['a'])
  const txOnly = fakePanel('tx', (c) => c.role === 'Transmitter', ['b'])
  const rxOnly = fakePanel('rx', (c) => c.role === 'Receiver', ['c'])
  const active = activePanels([always, txOnly, rxOnly], ctxTx)
  assert.deepEqual(active.map((p) => p.id), ['always', 'tx'])
})

test('composeVariableDefinitions merges definitions of the given panels', () => {
  const p1 = fakePanel('p1', () => true, ['a', 'b'])
  const p2 = fakePanel('p2', () => true, ['c'])
  const defs = composeVariableDefinitions([p1, p2])
  assert.deepEqual(Object.keys(defs).sort(), ['a', 'b', 'c'])
})
