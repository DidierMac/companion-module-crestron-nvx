import type { CompanionVariableDefinitions } from '@companion-module/base'

// v2 SDK: variable definitions are an object { [variableId]: { name } }, not an array
export const variableDefinitions = {
	connection_status: { name: 'Connection status' },
	device_name: { name: 'Device name' },
	firmware_version: { name: 'Firmware version' },
	ip_address: { name: 'IP address' },
} satisfies CompanionVariableDefinitions
