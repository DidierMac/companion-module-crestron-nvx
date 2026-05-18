import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import type { JsonObject } from '@companion-module/base'

import { getConfigFields, type ModuleConfig } from './config.js'
import { NvxApiClient } from './api.js'
import { setActionDefinitions } from './actions.js'
import { setFeedbackDefinitions } from './feedbacks.js'
import { variableDefinitions } from './variables.js'

class CrestronNvxInstance extends InstanceBase {
	private api!: NvxApiClient
	private currentConfig!: ModuleConfig
	private connected = false
	private pollTimer: ReturnType<typeof setInterval> | null = null

	// ── Lifecycle ──────────────────────────────────────────────────────────────

	async init(config: JsonObject, _isFirstInit: boolean, _secrets?: JsonObject | undefined): Promise<void> {
		this.currentConfig = config as ModuleConfig
		this.api = new NvxApiClient(this.currentConfig)

		setActionDefinitions(this)
		setFeedbackDefinitions(this, () => this.connected)
		this.setVariableDefinitions(variableDefinitions)
		this.setVariableValues({
			connection_status: 'Disconnected',
			device_name: '',
			firmware_version: '',
			ip_address: config.host,
		})

		await this.connect()
	}

	async destroy(): Promise<void> {
		this.stopPolling()
		await this.api.logout().catch(() => {})
		this.connected = false
		this.updateStatus(InstanceStatus.Disconnected)
	}

	async configUpdated(config: JsonObject, _secrets?: JsonObject | undefined): Promise<void> {
		this.currentConfig = config as ModuleConfig
		this.stopPolling()
		this.api.clearCookies()
		this.api.updateConfig(this.currentConfig)
		await this.connect()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return getConfigFields()
	}

	// ── Connection ─────────────────────────────────────────────────────────────

	private async connect(): Promise<void> {
		if (!this.currentConfig.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}

		this.updateStatus(InstanceStatus.Connecting)
		this.setVariableValues({ connection_status: 'Connecting...' })

		try {
			await this.api.login()
			this.connected = true
			this.updateStatus(InstanceStatus.Ok)
			this.log('info', `Connected to NVX at ${this.currentConfig.host}`)

			await this.poll()
			this.startPolling()
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.connected = false
			this.updateStatus(InstanceStatus.ConnectionFailure, msg)
			this.setVariableValues({ connection_status: `Error: ${msg}` })
			this.log('error', `Connection failed (${this.currentConfig.host}): ${msg}`)
			setTimeout(() => void this.connect(), 10000)
		}
	}

	// ── Polling ────────────────────────────────────────────────────────────────

	private startPolling(): void {
		this.stopPolling()
		const interval = Math.max(500, this.currentConfig.pollInterval ?? 2000)
		this.pollTimer = setInterval(() => void this.poll(), interval)
	}

	private stopPolling(): void {
		if (this.pollTimer !== null) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
	}

	private async poll(): Promise<void> {
		try {
			const info = await this.api.getDeviceInfo()
			this.setVariableValues({
				device_name: info.name,
				firmware_version: info.firmware,
				ip_address: this.currentConfig.host,
				connection_status: 'Connected',
			})
			if (!this.connected) {
				this.connected = true
				this.updateStatus(InstanceStatus.Ok)
			}
			this.checkFeedbacks('connected')
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.log('warn', `Poll error: ${msg}`)
			this.connected = false
			this.updateStatus(InstanceStatus.ConnectionFailure, msg)
			this.setVariableValues({ connection_status: `Error: ${msg}` })
			this.checkFeedbacks('connected')
			this.stopPolling()
			setTimeout(() => void this.connect(), 10000)
		}
	}
}

// v2 SDK: module entry via default export (runEntrypoint was removed in v2.0)
export default CrestronNvxInstance
