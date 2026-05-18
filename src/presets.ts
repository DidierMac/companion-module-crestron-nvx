import { combineRgb } from '@companion-module/base'
import type { CompanionPresetDefinitions } from '@companion-module/base'

export function getPresetDefinitions(): CompanionPresetDefinitions {
	const presets: CompanionPresetDefinitions = {}

	// ── Audio presets ──────────────────────────────────────────────────────────

	presets['toggle_mute'] = {
		type: 'button',
		name: 'Toggle Audio Mute',
		category: 'Audio',
		style: {
			text: 'MUTE\n$(crestron-nvx:audio_muted)',
			size: '18',
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(0, 0, 0),
		},
		steps: [
			{
				down: [{ actionId: 'toggle_audio_mute', options: {} }],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'audio_muted',
				options: {},
				style: {
					bgcolor: combineRgb(200, 0, 0),
					color: combineRgb(255, 255, 255),
				},
			},
		],
	}

	presets['volume_up'] = {
		type: 'button',
		name: 'Volume +10',
		category: 'Audio',
		style: {
			text: 'VOL +\n$(crestron-nvx:audio_volume)%',
			size: '18',
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(0, 80, 160),
		},
		steps: [
			{
				down: [{ actionId: 'adjust_audio_volume', options: { delta: 10 } }],
				up: [],
			},
		],
		feedbacks: [],
	}

	presets['volume_down'] = {
		type: 'button',
		name: 'Volume -10',
		category: 'Audio',
		style: {
			text: 'VOL -\n$(crestron-nvx:audio_volume)%',
			size: '18',
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(0, 80, 160),
		},
		steps: [
			{
				down: [{ actionId: 'adjust_audio_volume', options: { delta: -10 } }],
				up: [],
			},
		],
		feedbacks: [],
	}

	// ── Stream mode presets ────────────────────────────────────────────────────

	presets['set_encoder'] = {
		type: 'button',
		name: 'Set as Encoder',
		category: 'Stream Mode',
		style: {
			text: 'ENCODER',
			size: '18',
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(0, 0, 0),
		},
		steps: [
			{
				down: [{ actionId: 'set_stream_mode', options: { mode: 'Encoder' } }],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'is_encoder',
				options: {},
				style: {
					bgcolor: combineRgb(0, 120, 200),
					color: combineRgb(255, 255, 255),
				},
			},
		],
	}

	presets['set_decoder'] = {
		type: 'button',
		name: 'Set as Decoder',
		category: 'Stream Mode',
		style: {
			text: 'DECODER',
			size: '18',
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(0, 0, 0),
		},
		steps: [
			{
				down: [{ actionId: 'set_stream_mode', options: { mode: 'Decoder' } }],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'is_decoder',
				options: {},
				style: {
					bgcolor: combineRgb(0, 160, 80),
					color: combineRgb(255, 255, 255),
				},
			},
		],
	}

	// ── Signal status presets ──────────────────────────────────────────────────

	presets['hdmi_input_status'] = {
		type: 'button',
		name: 'HDMI Input Signal',
		category: 'Status',
		style: {
			text: 'HDMI IN\n$(crestron-nvx:hdmi_input_signal)',
			size: '14',
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(60, 60, 60),
		},
		steps: [{ down: [], up: [] }],
		feedbacks: [
			{
				feedbackId: 'hdmi_input_signal',
				options: {},
				style: {
					bgcolor: combineRgb(0, 180, 0),
					color: combineRgb(255, 255, 255),
				},
			},
		],
	}

	presets['hdmi_output_status'] = {
		type: 'button',
		name: 'HDMI Output Signal',
		category: 'Status',
		style: {
			text: 'HDMI OUT\n$(crestron-nvx:hdmi_output_signal)',
			size: '14',
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(60, 60, 60),
		},
		steps: [{ down: [], up: [] }],
		feedbacks: [
			{
				feedbackId: 'hdmi_output_signal',
				options: {},
				style: {
					bgcolor: combineRgb(0, 180, 0),
					color: combineRgb(255, 255, 255),
				},
			},
		],
	}

	// ── Info preset ────────────────────────────────────────────────────────────

	presets['device_info'] = {
		type: 'button',
		name: 'Device Info',
		category: 'Status',
		style: {
			text: '$(crestron-nvx:device_name)\n$(crestron-nvx:stream_mode)',
			size: '14',
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(30, 30, 30),
		},
		steps: [{ down: [], up: [] }],
		feedbacks: [],
	}

	return presets
}
