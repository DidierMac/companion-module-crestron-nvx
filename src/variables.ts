import type { CompanionVariableDefinition } from '@companion-module/base'

export function getVariableDefinitions(): CompanionVariableDefinition[] {
	return [
		{
			variableId: 'stream_mode',
			name: 'Stream Mode (encoder / decoder)',
		},
		{
			variableId: 'stream_url',
			name: 'Current Stream URL',
		},
		{
			variableId: 'stream_name',
			name: 'Stream Name',
		},
		{
			variableId: 'multicast_address',
			name: 'Multicast Address',
		},
		{
			variableId: 'video_source',
			name: 'Video Source (active input index)',
		},
		{
			variableId: 'video_source_name',
			name: 'Video Source Name',
		},
		{
			variableId: 'audio_muted',
			name: 'Audio Muted (true / false)',
		},
		{
			variableId: 'audio_volume',
			name: 'Audio Volume (0–100)',
		},
		{
			variableId: 'hdmi_input_signal',
			name: 'HDMI Input Signal Present (true / false)',
		},
		{
			variableId: 'hdmi_output_signal',
			name: 'HDMI Output Signal Present (true / false)',
		},
		{
			variableId: 'device_name',
			name: 'Device Name',
		},
		{
			variableId: 'firmware_version',
			name: 'Firmware Version',
		},
		{
			variableId: 'ip_address',
			name: 'IP Address',
		},
		{
			variableId: 'connection_status',
			name: 'Connection Status',
		},
	]
}
