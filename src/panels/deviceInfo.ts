import type { Panel } from './types.js'
import { subsystemObject } from '../capability.js'

export const deviceInfoPanel: Panel = {
  id: 'deviceInfo',
  endpoint: '/Device/DeviceInfo',
  gate: () => true,
  variableDefinitions: {
    device_name: { name: 'Device name' },
    firmware_version: { name: 'Firmware version' },
  },
  readVariables(json) {
    const di = subsystemObject(json, 'DeviceInfo')
    return {
      device_name: typeof di?.Name === 'string' ? di.Name : '',
      firmware_version: typeof di?.DeviceVersion === 'string' ? di.DeviceVersion : '',
    }
  },
  buildActions: () => ({}),
  buildFeedbacks: () => ({}),
}
