import https from 'https'
import type { ModuleConfig } from './config.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NvxDeviceStatus {
	// Video routing
	videoSource: string
	videoSourceName: string
	// Stream
	streamMode: 'encoder' | 'decoder' | 'unknown'
	streamUrl: string
	streamName: string
	multicastAddress: string
	// Audio
	audioMuted: boolean
	audioVolume: number
	// Signal
	hdmiInputSignalPresent: boolean
	hdmiOutputSignalPresent: boolean
	// Device info
	deviceName: string
	firmwareVersion: string
	ipAddress: string
}

export type NvxStreamMode = 'Encoder' | 'Decoder'

// ─── Default state ────────────────────────────────────────────────────────────

export const defaultStatus: NvxDeviceStatus = {
	videoSource: '',
	videoSourceName: '',
	streamMode: 'unknown',
	streamUrl: '',
	streamName: '',
	multicastAddress: '',
	audioMuted: false,
	audioVolume: 100,
	hdmiInputSignalPresent: false,
	hdmiOutputSignalPresent: false,
	deviceName: '',
	firmwareVersion: '',
	ipAddress: '',
}

// ─── API Client ───────────────────────────────────────────────────────────────

export class NvxApiClient {
	private config: ModuleConfig
	private sessionToken: string | null = null
	private agent: https.Agent

	constructor(config: ModuleConfig) {
		this.config = config
		this.agent = new https.Agent({
			rejectUnauthorized: !config.ignoreSelfSignedCert,
		})
	}

	updateConfig(config: ModuleConfig): void {
		this.config = config
		this.agent = new https.Agent({
			rejectUnauthorized: !config.ignoreSelfSignedCert,
		})
		this.sessionToken = null
	}

	private get baseUrl(): string {
		return `https://${this.config.host}:${this.config.port}`
	}

	// ── HTTP helpers ──────────────────────────────────────────────────────────

	private async request<T>(
		method: string,
		path: string,
		body?: object,
		retryOnAuth = true
	): Promise<T> {
		const url = `${this.baseUrl}${path}`
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Accept: 'application/json',
		}

		if (this.sessionToken) {
			headers['Cookie'] = `sessionid=${this.sessionToken}`
		}

		const options: RequestInit = {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
			// @ts-ignore - Node.js fetch accepts agent via dispatcher or custom fetch
		}

		// Use native Node.js https for self-signed cert support
		const response = await this.nodeFetch(method, url, headers, body)

		if (response.status === 401 && retryOnAuth) {
			await this.login()
			return this.request<T>(method, path, body, false)
		}

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} on ${method} ${path}`)
		}

		const text = response.body
		if (!text || text.trim() === '') return {} as T
		return JSON.parse(text) as T
	}

	private nodeFetch(
		method: string,
		url: string,
		headers: Record<string, string>,
		body?: object
	): Promise<{ status: number; ok: boolean; body: string }> {
		return new Promise((resolve, reject) => {
			const parsed = new URL(url)
			const bodyStr = body ? JSON.stringify(body) : ''

			if (bodyStr) {
				headers['Content-Length'] = Buffer.byteLength(bodyStr).toString()
			}

			const req = https.request(
				{
					hostname: parsed.hostname,
					port: parseInt(parsed.port || '443'),
					path: parsed.pathname + parsed.search,
					method,
					headers,
					agent: this.agent,
				},
				(res) => {
					let data = ''
					res.on('data', (chunk) => (data += chunk))
					res.on('end', () => {
						resolve({
							status: res.statusCode ?? 0,
							ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
							body: data,
						})
					})
				}
			)

			req.on('error', reject)
			if (bodyStr) req.write(bodyStr)
			req.end()
		})
	}

	// ── Authentication ────────────────────────────────────────────────────────

	async login(): Promise<void> {
		this.sessionToken = null
		const response = await this.nodeFetch(
			'POST',
			`${this.baseUrl}/userlogin`,
			{ 'Content-Type': 'application/json', Accept: 'application/json' },
			{ login: this.config.username, passwd: this.config.password }
		)

		if (!response.ok) {
			throw new Error(`Login failed: HTTP ${response.status}`)
		}

		// Session token may be set via Set-Cookie header — but nodeFetch doesn't capture it directly
		// The NVX API typically returns the token in the response body or sets a cookie
		// We parse it from the JSON body
		try {
			const json = JSON.parse(response.body)
			if (json?.Status?.Code === 200 || json?.Status?.Code === undefined) {
				// Successful login; some firmwares set a cookie, others use Bearer
				// Store token from response if present
				if (json?.SessionToken) {
					this.sessionToken = json.SessionToken
				}
			}
		} catch {
			// Body not JSON — login still may have succeeded via cookie
		}
	}

	// ── Device status ─────────────────────────────────────────────────────────

	async getDeviceStatus(): Promise<NvxDeviceStatus> {
		const status = { ...defaultStatus }

		try {
			// Device info
			const deviceInfo = await this.request<any>('GET', '/Device/DeviceInfo')
			status.deviceName = deviceInfo?.Device?.DeviceInfo?.Description ?? ''
			status.firmwareVersion = deviceInfo?.Device?.DeviceInfo?.VersionInfo?.RuntimeEnvironment ?? ''
			status.ipAddress = this.config.host

			// AV routing / stream config
			const avSignal = await this.request<any>('GET', '/Device/AvSignal')
			const avs = avSignal?.Device?.AvSignal

			if (avs) {
				// Stream mode (encoder vs decoder)
				const mode = avs?.StreamMode?.toUpperCase?.()
				status.streamMode = mode === 'ENCODER' ? 'encoder' : mode === 'DECODER' ? 'decoder' : 'unknown'

				// HDMI input signal
				status.hdmiInputSignalPresent = !!avs?.HdmiIn?.HdmiInputSignalPresent

				// HDMI output signal
				status.hdmiOutputSignalPresent = !!avs?.HdmiOut?.HdmiOutputSignalPresent

				// Stream URL / multicast
				status.streamUrl = avs?.StreamUrl ?? ''
				status.streamName = avs?.StreamName ?? ''
				status.multicastAddress = avs?.MulticastAddress ?? ''
			}

			// Video source (for decoders)
			const videoSwitch = await this.request<any>('GET', '/Device/VideoSwitch')
			const vs = videoSwitch?.Device?.VideoSwitch
			if (vs) {
				status.videoSource = vs?.ActiveInput?.toString() ?? ''
				status.videoSourceName = vs?.ActiveInputName ?? ''
			}

			// Audio
			const audio = await this.request<any>('GET', '/Device/AudioControl')
			const ac = audio?.Device?.AudioControl
			if (ac) {
				status.audioMuted = !!ac?.AudioMuted
				status.audioVolume = ac?.AudioVolume ?? 100
			}
		} catch (err) {
			throw err
		}

		return status
	}

	// ── Video routing ─────────────────────────────────────────────────────────

	/**
	 * Set the video source for a decoder (route a specific encoder stream).
	 * @param streamUrl - RTSP or multicast URL of the source encoder
	 */
	async setVideoSource(streamUrl: string): Promise<void> {
		await this.request('POST', '/Device/AvSignal', {
			Device: {
				AvSignal: {
					StreamUrl: streamUrl,
				},
			},
		})
	}

	/**
	 * Set stream mode: Encoder or Decoder.
	 */
	async setStreamMode(mode: NvxStreamMode): Promise<void> {
		await this.request('POST', '/Device/AvSignal', {
			Device: {
				AvSignal: {
					StreamMode: mode,
				},
			},
		})
	}

	/**
	 * Set the stream name (for encoders).
	 */
	async setStreamName(name: string): Promise<void> {
		await this.request('POST', '/Device/AvSignal', {
			Device: {
				AvSignal: {
					StreamName: name,
				},
			},
		})
	}

	/**
	 * Set the multicast address (for encoders).
	 */
	async setMulticastAddress(address: string): Promise<void> {
		await this.request('POST', '/Device/AvSignal', {
			Device: {
				AvSignal: {
					MulticastAddress: address,
				},
			},
		})
	}

	// ── Audio control ─────────────────────────────────────────────────────────

	async setAudioMute(muted: boolean): Promise<void> {
		await this.request('POST', '/Device/AudioControl', {
			Device: {
				AudioControl: {
					AudioMuted: muted,
				},
			},
		})
	}

	async setAudioVolume(volume: number): Promise<void> {
		const clamped = Math.max(0, Math.min(100, volume))
		await this.request('POST', '/Device/AudioControl', {
			Device: {
				AudioControl: {
					AudioVolume: clamped,
				},
			},
		})
	}

	async toggleAudioMute(currentMuted: boolean): Promise<void> {
		await this.setAudioMute(!currentMuted)
	}

	// ── Video switch (HDMI input selection for devices with multiple inputs) ──

	async setVideoInput(input: number): Promise<void> {
		await this.request('POST', '/Device/VideoSwitch', {
			Device: {
				VideoSwitch: {
					ActiveInput: input,
				},
			},
		})
	}

	// ── Reboot ────────────────────────────────────────────────────────────────

	async rebootDevice(): Promise<void> {
		await this.request('POST', '/Device/DeviceOperations', {
			Device: {
				DeviceOperations: {
					Reboot: true,
				},
			},
		})
	}
}
