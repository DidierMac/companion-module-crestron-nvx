import {
	InstanceBase,
	InstanceStatus,
	runEntrypoint,
	type SomeCompanionConfigField,
} from '@companion-module/base'

import { getConfigFields, defaultConfig, type ModuleConfig } from './config.js'
import { NvxApiClient, defaultStatus, type NvxDeviceStatus } from './api.js'
import { getActionDefinitions } from './actions.js'
import { getFeedbackDefinitions } from './feedbacks.js'
import { getVariableDefinitions } from './variables.js'
import { getPresetDefinitions } from './presets.js'

class CrestronNvxInstance extends InstanceBase<ModuleConfig> {
	private api!: NvxApiClient
	private status: NvxDeviceStatus = { ...defaultStatus }
	private pollTimer: ReturnType<typeof setInterval> | null = null
	private config: ModuleConfig = { ...defaultConfig }

	// ── Lifecycle ──────────────────────────────────────────────────────────────

	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		this.api = new NvxApiClient(config)

		this.setActionDefinitions(getActionDefinitions(this.api, () => this.status))
		this.setFeedbackDefinitions(getFeedbackDefinitions(() => this.status))
		this.setVariableDefinitions(getVariableDefinitions())
		this.setPresetDefinitions(getPresetDefinitions())

		await this.connect()
	}

	async destroy(): Promise<void> {
		this.stopPolling()
		this.updateStatus(InstanceStatus.Disconnected)
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		this.api.updateConfig(config)
		this.stopPolling()
		await this.connect()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return getConfigFields()
	}

	// ── Connection & polling ───────────────────────────────────────────────────

	private async connect(): Promise<void> {
		if (!this.config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}

		this.updateStatus(InstanceStatus.Connecting)
		this.setVariableValues({ connection_status: 'Connecting...' })

		try {
			await this.api.login()
			this.updateStatus(InstanceStatus.Ok)
			this.setVariableValues({ connection_status: 'Connected' })
			this.log('info', `Connected to Crestron NVX at ${this.config.host}`)

			// Initial poll then start polling loop
			await this.poll()
			this.startPolling()
		} catch (err: any) {
			this.updateStatus(InstanceStatus.ConnectionFailure, err?.message ?? 'Connection failed')
			this.setVariableValues({ connection_status: 'Error: ' + (err?.message ?? 'unknown') })
			this.log('error', `Failed to connect to ${this.config.host}: ${err?.message}`)

			// Retry after 10 seconds
			setTimeout(() => this.connect(), 10000)
		}
	}

	private startPolling(): void {
		this.stopPolling()
		const interval = Math.max(500, this.config.pollInterval ?? 2000)
		this.pollTimer = setInterval(() => this.poll(), interval)
	}

	private stopPolling(): void {
		if (this.pollTimer !== null) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
	}

	private async poll(): Promise<void> {
		try {
			const newStatus = await this.api.getDeviceStatus()
			this.status = newStatus
			this.updateVariables()
			this.checkFeedbacks()

			// Restore OK status if previously in error
			if (this.getStatus()?.status !== InstanceStatus.Ok) {
				this.updateStatus(InstanceStatus.Ok)
				this.setVariableValues({ connection_status: 'Connected' })
			}
		} catch (err: any) {
			this.log('warn', `Poll error: ${err?.message}`)
			this.updateStatus(InstanceStatus.ConnectionFailure, err?.message ?? 'Poll failed')
			this.setVariableValues({ connection_status: 'Error: ' + (err?.message ?? 'poll failed') })
			this.stopPolling()

			// Try to reconnect
			setTimeout(() => this.connect(), 10000)
		}
	}

	// ── Variable updates ───────────────────────────────────────────────────────

	private updateVariables(): void {
		const s = this.status
		this.setVariableValues({
			stream_mode: s.streamMode,
			stream_url: s.streamUrl,
			stream_name: s.streamName,
			multicast_address: s.multicastAddress,
			video_source: s.videoSource,
			video_source_name: s.videoSourceName,
			audio_muted: s.audioMuted ? 'true' : 'false',
			audio_volume: s.audioVolume.toString(),
			hdmi_input_signal: s.hdmiInputSignalPresent ? 'true' : 'false',
			hdmi_output_signal: s.hdmiOutputSignalPresent ? 'true' : 'false',
			device_name: s.deviceName,
			firmware_version: s.firmwareVersion,
			ip_address: s.ipAddress,
		})
	}

	// Helper to avoid referencing private Companion internals
	private getStatus(): { status: InstanceStatus } | undefined {
		return undefined // Companion tracks this internally; this is a local helper placeholder
	}
}

runEntrypoint(CrestronNvxInstance, [])
