import type { JsonValue, SomeCompanionConfigField } from '@companion-module/base'

// Index signature satisfies the JsonObject constraint required by the SDK v2 generics
export interface ModuleConfig {
	[key: string]: JsonValue
	host: string
	port: number
	username: string
	password: string
	pollInterval: number
	ignoreSelfSignedCert: boolean
}

export const defaultConfig: ModuleConfig = {
	host: '',
	port: 443,
	username: 'admin',
	password: '',
	pollInterval: 2000,
	ignoreSelfSignedCert: true,
}

export function getConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Information',
			value: 'Enter the IP address or hostname of the Crestron DM NVX device.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Device IP / Hostname',
			width: 8,
			default: '',
		},
		{
			type: 'number',
			id: 'port',
			label: 'HTTPS Port',
			width: 4,
			default: 443,
			min: 1,
			max: 65535,
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'Username',
			width: 6,
			default: 'admin',
		},
		{
			type: 'secret-text',
			id: 'password',
			label: 'Password',
			width: 6,
			default: '',
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Poll Interval (ms)',
			width: 6,
			default: 2000,
			min: 500,
			max: 30000,
		},
		{
			type: 'checkbox',
			id: 'ignoreSelfSignedCert',
			label: 'Ignore Self-Signed Certificate',
			width: 6,
			default: true,
		},
	]
}
