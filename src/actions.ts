import type { CompanionActionDefinitions } from '@companion-module/base'
import type { NvxApiClient } from './api.js'
import type { NvxDeviceStatus } from './api.js'

export function getActionDefinitions(
	api: NvxApiClient,
	getStatus: () => NvxDeviceStatus
): CompanionActionDefinitions {
	return {
		// ── Video routing ──────────────────────────────────────────────────────

		set_stream_url: {
			name: 'Set Stream URL (decoder source)',
			description: 'Set the RTSP/multicast stream URL this decoder will play',
			options: [
				{
					type: 'textinput',
					id: 'url',
					label: 'Stream URL (rtsp://... or udp://...)',
					default: '',
					useVariables: true,
				},
			],
			callback: async (action, context) => {
				const url = await context.parseVariablesInString(action.options.url as string)
				await api.setVideoSource(url)
			},
		},

		set_stream_mode: {
			name: 'Set Stream Mode (Encoder / Decoder)',
			options: [
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Mode',
					default: 'Decoder',
					choices: [
						{ id: 'Encoder', label: 'Encoder' },
						{ id: 'Decoder', label: 'Decoder' },
					],
				},
			],
			callback: async (action) => {
				await api.setStreamMode(action.options.mode as 'Encoder' | 'Decoder')
			},
		},

		set_stream_name: {
			name: 'Set Stream Name (encoder)',
			description: 'Set the name broadcast by this encoder',
			options: [
				{
					type: 'textinput',
					id: 'name',
					label: 'Stream Name',
					default: '',
					useVariables: true,
				},
			],
			callback: async (action, context) => {
				const name = await context.parseVariablesInString(action.options.name as string)
				await api.setStreamName(name)
			},
		},

		set_multicast_address: {
			name: 'Set Multicast Address (encoder)',
			options: [
				{
					type: 'textinput',
					id: 'address',
					label: 'Multicast Address (e.g. 239.0.0.1)',
					default: '239.0.0.1',
					useVariables: true,
				},
			],
			callback: async (action, context) => {
				const address = await context.parseVariablesInString(action.options.address as string)
				await api.setMulticastAddress(address)
			},
		},

		set_video_input: {
			name: 'Set Video Input (HDMI input selection)',
			options: [
				{
					type: 'number',
					id: 'input',
					label: 'Input Number',
					default: 1,
					min: 1,
					max: 8,
				},
			],
			callback: async (action) => {
				await api.setVideoInput(action.options.input as number)
			},
		},

		// ── Audio ──────────────────────────────────────────────────────────────

		mute_audio: {
			name: 'Mute Audio',
			options: [],
			callback: async () => {
				await api.setAudioMute(true)
			},
		},

		unmute_audio: {
			name: 'Unmute Audio',
			options: [],
			callback: async () => {
				await api.setAudioMute(false)
			},
		},

		toggle_audio_mute: {
			name: 'Toggle Audio Mute',
			options: [],
			callback: async () => {
				const current = getStatus().audioMuted
				await api.toggleAudioMute(current)
			},
		},

		set_audio_volume: {
			name: 'Set Audio Volume',
			options: [
				{
					type: 'number',
					id: 'volume',
					label: 'Volume (0–100)',
					default: 100,
					min: 0,
					max: 100,
				},
			],
			callback: async (action) => {
				await api.setAudioVolume(action.options.volume as number)
			},
		},

		adjust_audio_volume: {
			name: 'Adjust Audio Volume (relative)',
			options: [
				{
					type: 'number',
					id: 'delta',
					label: 'Delta (positive = louder, negative = quieter)',
					default: 10,
					min: -100,
					max: 100,
				},
			],
			callback: async (action) => {
				const current = getStatus().audioVolume
				const newVol = Math.max(0, Math.min(100, current + (action.options.delta as number)))
				await api.setAudioVolume(newVol)
			},
		},

		// ── Device ─────────────────────────────────────────────────────────────

		reboot_device: {
			name: 'Reboot Device',
			description: 'Send a reboot command to the NVX device',
			options: [],
			callback: async () => {
				await api.rebootDevice()
			},
		},
	}
}
