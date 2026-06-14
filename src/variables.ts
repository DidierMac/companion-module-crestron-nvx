import type { CompanionVariableDefinitions } from '@companion-module/base'

// Connection-level variables owned by main (not by a subsystem panel).
export const connectionVariableDefinitions = {
  connection_status: { name: 'Connection status' },
  ip_address: { name: 'IP address' },
  device_role: { name: 'Device role (Transmitter/Receiver)' },
} satisfies CompanionVariableDefinitions
