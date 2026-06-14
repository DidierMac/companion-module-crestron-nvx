import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deviceInfoPanel } from './deviceInfo.js'

const load = (host: string): unknown =>
  JSON.parse(readFileSync(`docs/hardware-validation/raw/${host}/Device_DeviceInfo.json`, 'utf8'))

test('deviceInfo panel is always active', () => {
  assert.equal(deviceInfoPanel.gate({ caps: { canEncode: false, canDecode: false, canSwitchMode: false }, role: null }), true)
})

test('deviceInfo.readVariables maps name + firmware from real JSON', () => {
  const v = deviceInfoPanel.readVariables(load('192.168.2.9'))
  assert.equal(v.device_name, 'DM-NVX-360-00107FF7D99A')
  assert.equal(v.firmware_version, '7.1.5259.00090')
})

test('deviceInfo.readVariables is sentinel-safe (empty on garbage)', () => {
  const v = deviceInfoPanel.readVariables('UNSUPPORTED PROPERTY, CHECK REST API!!!')
  assert.equal(v.device_name, '')
  assert.equal(v.firmware_version, '')
})
