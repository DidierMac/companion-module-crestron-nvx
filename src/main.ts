import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import type { JsonObject } from '@companion-module/base'

import { getConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { NvxApiClient, NvxAuthError } from './api.js'
import { ModuleLogger } from './logger.js'
import { setActionDefinitions } from './actions.js'
import { setFeedbackDefinitions } from './feedbacks.js'
import { variableDefinitions } from './variables.js'

class CrestronNvxInstance extends InstanceBase {
	private api!: NvxApiClient
	private currentConfig!: ModuleConfig
	private currentSecrets!: ModuleSecrets
	private connected = false
	private pollTimer: ReturnType<typeof setInterval> | null = null
	private logger!: ModuleLogger

	// ── Lifecycle ──────────────────────────────────────────────────────────────

	async init(config: JsonObject, _isFirstInit: boolean, secrets?: JsonObject | undefined): Promise<void> {
		this.currentConfig = config as ModuleConfig
		this.currentSecrets = (secrets ?? {}) as ModuleSecrets
		// this.log (no 'ger') is the inherited InstanceBase SDK method — captured here before logger is assigned
		this.logger = new ModuleLogger(this.log.bind(this), '', this.currentConfig.verbose ?? false)

		const initLog = this.logger.child('[INIT]')
		initLog.debug(
			`Config: host=${this.currentConfig.host} port=${this.currentConfig.port} ` +
			`poll=${this.currentConfig.pollInterval}ms verbose=${this.currentConfig.verbose ?? false}`,
		)

		this.api = new NvxApiClient(
			this.currentConfig,
			this.currentSecrets,
			this.logger.child('[AUTH]'),
			this.logger.child('[HTTP]'),
		)

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
		this.logger?.child('[CONN]').debug('destroy() called — stopping polling and logging out')
		this.stopPolling()
		await this.api.logout().catch(() => {})
		this.connected = false
		this.updateStatus(InstanceStatus.Disconnected)
	}

	async configUpdated(config: JsonObject, secrets?: JsonObject | undefined): Promise<void> {
		this.currentConfig = config as ModuleConfig
		this.currentSecrets = (secrets ?? {}) as ModuleSecrets
		this.logger.setVerbose(this.currentConfig.verbose ?? false)
		this.logger.child('[CONN]').debug('configUpdated() → reconnect')
		this.stopPolling()
		this.api.clearCookies()
		this.api.updateConfig(this.currentConfig, this.currentSecrets)
		await this.connect()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return getConfigFields()
	}

	// ── Connection ─────────────────────────────────────────────────────────────

	private async connect(): Promise<void> {
		const connLog = this.logger.child('[CONN]')

		if (!this.currentConfig.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}
		if (!this.currentSecrets.password) {
			this.updateStatus(InstanceStatus.BadConfig, 'No password configured')
			connLog.error('No password configured — not attempting login')
			return
		}

		connLog.debug('connect() triggered')
		this.updateStatus(InstanceStatus.Connecting)
		this.setVariableValues({ connection_status: 'Connecting...' })

		try {
			await this.api.login()
			this.connected = true
			this.updateStatus(InstanceStatus.Ok)
			connLog.info(`Connected to NVX at ${this.currentConfig.host}`)

			await this.poll()
			this.startPolling()
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.connected = false
			if (err instanceof NvxAuthError) {
				this.updateStatus(InstanceStatus.AuthenticationFailure, msg)
				this.setVariableValues({ connection_status: `Auth failed: ${msg}` })
				connLog.error(`Auth refused — stopping reconnect until config changes: ${msg}`)
			} else {
				this.updateStatus(InstanceStatus.ConnectionFailure, msg)
				this.setVariableValues({ connection_status: `Error: ${msg}` })
				connLog.error(`Connection failed (${this.currentConfig.host}): ${msg}`)
				connLog.debug('Reconnect scheduled in 10s')
				setTimeout(() => void this.connect(), 10000)
			}
		}
	}

	// ── Polling ────────────────────────────────────────────────────────────────

	private startPolling(): void {
		this.stopPolling()
		const interval = Math.max(500, this.currentConfig.pollInterval ?? 2000)
		this.logger.child('[POLL]').debug(`Polling started — interval ${interval}ms`)
		this.pollTimer = setInterval(() => void this.poll(), interval)
	}

	private stopPolling(): void {
		if (this.pollTimer !== null) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
			this.logger?.child('[POLL]').debug('Polling stopped')
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
			this.logger.child('[POLL]').debug(`DeviceInfo OK — ${info.name} fw ${info.firmware}`)
			if (!this.connected) {
				this.connected = true
				this.updateStatus(InstanceStatus.Ok)
			}
			this.checkFeedbacks('connected')
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.connected = false
			this.checkFeedbacks('connected')
			this.stopPolling()
			if (err instanceof NvxAuthError) {
				this.updateStatus(InstanceStatus.AuthenticationFailure, msg)
				this.setVariableValues({ connection_status: `Auth failed: ${msg}` })
				this.logger.child('[CONN]').error(`Auth refused during poll — stopping reconnect: ${msg}`)
			} else {
				this.updateStatus(InstanceStatus.ConnectionFailure, msg)
				this.setVariableValues({ connection_status: `Error: ${msg}` })
				this.logger.child('[CONN]').warn(`Poll error: ${msg} — reconnect in 10s`)
				setTimeout(() => void this.connect(), 10000)
			}
		}
	}
}

// v2 SDK: module entry via default export (runEntrypoint was removed in v2.0)
export default CrestronNvxInstance
