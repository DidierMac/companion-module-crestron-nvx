import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { subsystemObject, detectCapability, parseDeviceMode } from './capability.js'

const RAW = 'docs/hardware-validation/raw'
const load = (host: string, file: string): unknown =>
  JSON.parse(readFileSync(`${RAW}/${host}/${file}.json`, 'utf8'))

test('subsystemObject returns the object for a present subsystem', () => {
  const json = load('192.168.2.9', 'Device_DeviceSpecific')
  const ds = subsystemObject(json, 'DeviceSpecific')
  assert.equal(typeof ds, 'object')
  assert.equal((ds as Record<string, unknown>).DeviceMode, 'Receiver')
})

test('subsystemObject returns null on the UNSUPPORTED PROPERTY sentinel', () => {
  // E30 StreamReceive is the string sentinel, not an object
  const json = load('192.168.2.11', 'Device_StreamReceive')
  assert.equal(subsystemObject(json, 'StreamReceive'), null)
})

test('subsystemObject returns null when the key is absent', () => {
  assert.equal(subsystemObject({ Device: {} }, 'StreamReceive'), null)
})

test('detectCapability: 360 (1 in / 1 out) is switchable', () => {
  const caps = detectCapability(load('192.168.2.9', 'Device_DeviceCapabilities'))
  assert.deepEqual(caps, { canEncode: true, canDecode: true, canSwitchMode: true })
})

test('detectCapability: E30 (1 in / 0 out) is encode-only', () => {
  const caps = detectCapability(load('192.168.2.11', 'Device_DeviceCapabilities'))
  assert.deepEqual(caps, { canEncode: true, canDecode: false, canSwitchMode: false })
})

test('parseDeviceMode reads Transmitter / Receiver', () => {
  assert.equal(parseDeviceMode(load('192.168.2.10', 'Device_DeviceSpecific')), 'Transmitter')
  assert.equal(parseDeviceMode(load('192.168.2.9', 'Device_DeviceSpecific')), 'Receiver')
})

test('parseDeviceMode returns null on garbage', () => {
  assert.equal(parseDeviceMode({ Device: { DeviceSpecific: { DeviceMode: 'Nope' } } }), null)
  assert.equal(parseDeviceMode('UNSUPPORTED PROPERTY, CHECK REST API!!!'), null)
})

// ── Durcissement Vague 1 (code-review) ───────────────────────────────────────

test('subsystemObject returns null when the subsystem value is an array (not a valid subsystem object)', () => {
  // Un tableau passe le check `typeof x === 'object' && x !== null`
  // mais N'EST PAS un objet de sous-système valide.
  // Ce test sera RED tant que le guard Array.isArray n'est pas ajouté dans capability.ts.
  assert.equal(subsystemObject({ Device: { X: [1, 2] } }, 'X'), null)
})

test('detectCapability returns all-false when PortConfig is absent', () => {
  // Cas dégénéré : DeviceCapabilities présent mais PortConfig absent ({}  ou clé manquante).
  // Number(undefined ?? 0) = 0 → canEncode=false, canDecode=false, canSwitchMode=false.
  assert.deepEqual(
    detectCapability({ Device: { DeviceCapabilities: { PortConfig: {} } } }),
    { canEncode: false, canDecode: false, canSwitchMode: false },
  )
})

test('detectCapability coerces string NumberOfHdmiInputs to number (canEncode true for "1")', () => {
  // YAML/JSON peuvent produire '1' (string) au lieu de 1 (number) selon la source.
  // Number('1') = 1 >= 1 → canEncode=true. Fige ce comportement de coercition.
  assert.deepEqual(
    detectCapability({
      Device: {
        DeviceCapabilities: {
          PortConfig: { NumberOfHdmiInputs: '1', NumberOfHdmiOutputs: 0 },
        },
      },
    }),
    { canEncode: true, canDecode: false, canSwitchMode: false },
  )
})
