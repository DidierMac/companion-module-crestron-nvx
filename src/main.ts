import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import type { JsonObject, CompanionVariableValues, CompanionActionDefinitions, CompanionFeedbackDefinitions } from '@companion-module/base'

import { getConfigFields, missingCredential, type ModuleConfig, type ModuleSecrets } from './config.js'
import { NvxApiClient, NvxAuthError } from './api.js'
import { ModuleLogger } from './logger.js'
import { detectCapability, parseDeviceMode, type Capability, type DeviceRole } from './capability.js'
import type { Panel, PanelContext } from './panels/types.js'
import { activePanels, composeVariableDefinitions } from './panels/registry.js'
import { deviceInfoPanel } from './panels/deviceInfo.js'
import { encoderPanel } from './panels/encoder.js'
import { connectionVariableDefinitions } from './variables.js'
import { baseFeedbackDefinitions } from './feedbacks.js'

class CrestronNvxInstance extends InstanceBase {
	private api!: NvxApiClient
	private currentConfig!: ModuleConfig
	private currentSecrets!: ModuleSecrets
	private connected = false
	private pollTimer: ReturnType<typeof setInterval> | null = null
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private destroyed = false
	private logger!: ModuleLogger
	private caps: Capability = { canEncode: false, canDecode: false, canSwitchMode: false }
	private role: DeviceRole | null = null
	private active: Panel[] = []
	private state: CompanionVariableValues = {}
	private readonly allPanels: Panel[] = [deviceInfoPanel, encoderPanel]

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

		// Definitions are (re)composed once capability + role are known (see connect()).
		// Register the connection-level baseline now so the UI has variables before first connect.
		this.setVariableDefinitions(connectionVariableDefinitions)
		this.setVariableValues({
			connection_status: 'Disconnected',
			ip_address: config.host,
			device_role: '',
		})

		// Fire-and-forget : ne PAS bloquer init() sur le réseau, sinon Companion
		// force-restart le process (timeout d'init). connect() gère ses propres erreurs.
		void this.connect()
	}

	async destroy(): Promise<void> {
		this.logger?.child('[CONN]').debug('destroy() called — stopping timers and logging out')
		this.destroyed = true
		this.clearReconnect()
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
		void this.connect()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return getConfigFields()
	}

	// ── Connection ─────────────────────────────────────────────────────────────

	private async connect(): Promise<void> {
		const connLog = this.logger.child('[CONN]')

		this.clearReconnect() // une seule chaîne de reconnexion à la fois
		if (this.destroyed) return

		const missing = missingCredential(this.currentConfig, this.currentSecrets)
		if (missing) {
			this.updateStatus(InstanceStatus.BadConfig, missing)
			connLog.error(`${missing} — not attempting login`)
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

			await this.detectAndRegister()
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
				this.scheduleReconnect()
			}
		}
	}

	/** Detect capability + role from the device and (re)register the active panels' definitions. */
	private async detectAndRegister(): Promise<void> {
		const connLog = this.logger.child('[CONN]')
		this.caps = detectCapability(await this.api.get('/Device/DeviceCapabilities'))
		this.role = parseDeviceMode(await this.api.get('/Device/DeviceSpecific'))
		const ctx: PanelContext = { caps: this.caps, role: this.role }
		this.active = activePanels(this.allPanels, ctx)
		connLog.info(`Capability ${JSON.stringify(this.caps)} role=${this.role} → panels: ${this.active.map((p) => p.id).join(', ')}`)

		this.setVariableDefinitions({ ...connectionVariableDefinitions, ...composeVariableDefinitions(this.active) })

		let actions: CompanionActionDefinitions = {}
		let feedbacks: CompanionFeedbackDefinitions = baseFeedbackDefinitions(() => this.connected, () => this.role)
		for (const p of this.active) {
			actions = { ...actions, ...p.buildActions(this.api) }
			feedbacks = { ...feedbacks, ...p.buildFeedbacks(() => this.state) }
		}
		this.setActionDefinitions(actions)
		this.setFeedbackDefinitions(feedbacks)
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

	private scheduleReconnect(): void {
		if (this.destroyed) return
		this.clearReconnect()
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			void this.connect()
		}, 10000)
	}

	private clearReconnect(): void {
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
	}

	private async poll(): Promise<void> {
		try {
			const next: CompanionVariableValues = {}
			for (const panel of this.active) {
				const json = await this.api.get(panel.endpoint)
				Object.assign(next, panel.readVariables(json))
			}
			next.connection_status = 'Connected'
			next.ip_address = this.currentConfig.host
			next.device_role = this.role ?? ''
			this.state = next
			this.setVariableValues(next)
			this.logger.child('[POLL]').debug(`Polled ${this.active.length} panel(s)`)
			if (!this.connected) {
				this.connected = true
				this.updateStatus(InstanceStatus.Ok)
			}
			this.checkAllFeedbacks()
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.connected = false
			this.checkAllFeedbacks()
			this.stopPolling()
			if (err instanceof NvxAuthError) {
				this.updateStatus(InstanceStatus.AuthenticationFailure, msg)
				this.setVariableValues({ connection_status: `Auth failed: ${msg}` })
				this.logger.child('[CONN]').error(`Auth refused during poll — stopping reconnect: ${msg}`)
			} else {
				this.updateStatus(InstanceStatus.ConnectionFailure, msg)
				this.setVariableValues({ connection_status: `Error: ${msg}` })
				this.logger.child('[CONN]').warn(`Poll error: ${msg} — reconnect in 10s`)
				this.scheduleReconnect()
			}
		}
	}
}

// v2 SDK: module entry via default export (runEntrypoint was removed in v2.0)
export default CrestronNvxInstance
