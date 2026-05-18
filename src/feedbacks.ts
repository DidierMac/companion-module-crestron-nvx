import { combineRgb } from '@companion-module/base'
import type { CompanionFeedbackDefinitions } from '@companion-module/base'
import type { NvxDeviceStatus } from './api.js'

export function getFeedbackDefinitions(getStatus: () => NvxDeviceStatus): CompanionFeedbackDefinitions {
	return {
		// ── Stream mode ────────────────────────────────────────────────────────

		is_encoder: {
			type: 'boolean',
			name: 'Is Encoder',
			description: 'Active when the device is in encoder mode',
			defaultStyle: {
				bgcolor: combineRgb(0, 120, 200),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => {
				return getStatus().streamMode === 'encoder'
			},
		},

		is_decoder: {
			type: 'boolean',
			name: 'Is Decoder',
			description: 'Active when the device is in decoder mode',
			defaultStyle: {
				bgcolor: combineRgb(0, 160, 80),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => {
				return getStatus().streamMode === 'decoder'
			},
		},

		// ── Stream URL match ───────────────────────────────────────────────────

		stream_url_matches: {
			type: 'boolean',
			name: 'Stream URL matches',
			description: 'Active when the current stream URL equals the specified value',
			defaultStyle: {
				bgcolor: combineRgb(255, 165, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [
				{
					type: 'textinput',
					id: 'url',
					label: 'Expected Stream URL',
					default: '',
					useVariables: true,
				},
			],
			callback: async (feedback, context) => {
				const expected = await context.parseVariablesInString(feedback.options.url as string)
				return getStatus().streamUrl === expected
			},
		},

		stream_name_matches: {
			type: 'boolean',
			name: 'Stream Name matches',
			description: 'Active when the stream name contains the specified text',
			defaultStyle: {
				bgcolor: combineRgb(255, 165, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [
				{
					type: 'textinput',
					id: 'name',
					label: 'Stream Name (exact)',
					default: '',
					useVariables: true,
				},
			],
			callback: async (feedback, context) => {
				const expected = await context.parseVariablesInString(feedback.options.name as string)
				return getStatus().streamName === expected
			},
		},

		// ── Audio ──────────────────────────────────────────────────────────────

		audio_muted: {
			type: 'boolean',
			name: 'Audio is Muted',
			description: 'Active when audio output is muted',
			defaultStyle: {
				bgcolor: combineRgb(200, 0, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => {
				return getStatus().audioMuted
			},
		},

		audio_volume_above: {
			type: 'boolean',
			name: 'Audio Volume above threshold',
			defaultStyle: {
				bgcolor: combineRgb(0, 180, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [
				{
					type: 'number',
					id: 'threshold',
					label: 'Threshold (0–100)',
					default: 50,
					min: 0,
					max: 100,
				},
			],
			callback: (feedback) => {
				return getStatus().audioVolume >= (feedback.options.threshold as number)
			},
		},

		// ── Signal presence ────────────────────────────────────────────────────

		hdmi_input_signal: {
			type: 'boolean',
			name: 'HDMI Input Signal Present',
			description: 'Active when a valid HDMI signal is detected on the input',
			defaultStyle: {
				bgcolor: combineRgb(0, 180, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => {
				return getStatus().hdmiInputSignalPresent
			},
		},

		hdmi_output_signal: {
			type: 'boolean',
			name: 'HDMI Output Signal Present',
			description: 'Active when a valid HDMI signal is present on the output',
			defaultStyle: {
				bgcolor: combineRgb(0, 180, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => {
				return getStatus().hdmiOutputSignalPresent
			},
		},

		// ── Connection ─────────────────────────────────────────────────────────

		device_connected: {
			type: 'boolean',
			name: 'Device is Connected',
			description: 'Active when the module has a working connection to the NVX device',
			defaultStyle: {
				bgcolor: combineRgb(0, 180, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => {
				// Checked via connection status variable — the module sets this
				return getStatus().ipAddress !== ''
			},
		},
	}
}
