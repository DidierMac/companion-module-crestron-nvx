import { combineRgb } from '@companion-module/base'
import type { InstanceBase } from '@companion-module/base'
import type { DeviceRole } from './capability.js'

// Connection- and role-level feedbacks owned by main (always registered).
export function baseFeedbackDefinitions(
  isConnected: () => boolean,
  role: () => DeviceRole | null,
) {
  return {
    connected: {
      type: 'boolean' as const,
      name: 'Device connected',
      description: 'Active when the module has a working connection to the NVX device',
      defaultStyle: { bgcolor: combineRgb(0, 170, 0), color: combineRgb(255, 255, 255) },
      options: [],
      callback: () => isConnected(),
    },
    is_encoder: {
      type: 'boolean' as const,
      name: 'Device is Encoder (Transmitter)',
      description: 'Active when the device is currently in Transmitter mode',
      defaultStyle: { bgcolor: combineRgb(204, 102, 0), color: combineRgb(255, 255, 255) },
      options: [],
      callback: () => role() === 'Transmitter',
    },
    is_decoder: {
      type: 'boolean' as const,
      name: 'Device is Decoder (Receiver)',
      description: 'Active when the device is currently in Receiver mode',
      defaultStyle: { bgcolor: combineRgb(102, 0, 204), color: combineRgb(255, 255, 255) },
      options: [],
      callback: () => role() === 'Receiver',
    },
  }
}

// Kept for reference by upgrade scripts; no longer the wiring entry point.
export function setFeedbackDefinitions(self: InstanceBase, isConnected: () => boolean): void {
  self.setFeedbackDefinitions(baseFeedbackDefinitions(isConnected, () => null))
}
