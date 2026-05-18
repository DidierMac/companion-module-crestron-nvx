import type { SomeCompanionConfigField } from '@companion-module/base'

export interface ModuleConfig {
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
			value:
				'This module controls Crestron DM NVX AV-over-IP encoders and decoders via the REST API. ' +
				'Enter the IP address or hostname of the NVX device below.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Device IP / Hostname',
			width: 8,
			default: '',
			required: true,
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
			type: 'textinput',
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
