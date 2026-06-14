import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { ModuleConfig, ModuleSecrets } from './config.js'
import type { ModuleLogger } from './logger.js'

/**
 * Thrown when the device refuses the credentials (HTTP 401/403).
 * Signals main.ts to stop reconnecting until config/secrets change
 * (NVX locks the account after repeated failed logins).
 */
export class NvxAuthError extends Error {}

export interface DeviceInfo {
	name: string
	firmware: string
	model: string
}

export class NvxApiClient {
	private cookies: Map<string, string> = new Map()
	private loginMutex: Promise<void> | null = null
	private agent: https.Agent

	constructor(
		private config: ModuleConfig,
		private secrets: ModuleSecrets,
		private readonly authLog: ModuleLogger,
		private readonly httpLog: ModuleLogger,
	) {
		this.agent = this.buildAgent()
	}

	updateConfig(config: ModuleConfig, secrets: ModuleSecrets): void {
		this.config = config
		this.secrets = secrets
		this.agent = this.buildAgent()
	}

	private buildAgent(): https.Agent {
		return new https.Agent({
			rejectUnauthorized: !this.config.ignoreSelfSignedCert,
		})
	}

	// ── Authentication ────────────────────────────────────────────────────────

	async login(): Promise<void> {
		this.authLog.debug('Login step 1 — GET /userlogin.html')
		const step1 = await this.rawRequest('GET', '/userlogin.html')
		this.extractCookies(step1.headers['set-cookie'] ?? [])
		await this.drainBody(step1)

		const trackid = this.cookies.get('TRACKID')
		if (!trackid) throw new Error('NVX login: TRACKID absent from step 1 response')
		this.authLog.debug('TRACKID obtained → step 2 POST login')

		const body = `login=${encodeURIComponent(this.config.username)}&passwd=${encodeURIComponent(this.secrets.password)}`
		const step2 = await this.rawRequest('POST', '/userlogin.html', body, {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Content-Length': String(Buffer.byteLength(body)),
			Origin: `https://${this.config.host}`,
			Referer: `https://${this.config.host}/userlogin.html`,
		})
		this.extractCookies(step2.headers['set-cookie'] ?? [])
		await this.drainBody(step2)

		if (step2.statusCode === 401 || step2.statusCode === 403) {
			throw new NvxAuthError(
				`NVX auth refused: HTTP ${step2.statusCode} — bad credentials or account locked`,
			)
		}
		// NVX renvoie 200 sur succès (certains firmwares font un 302). 401/403 traités au-dessus.
		// Tout autre 2xx/3xx = login accepté ; le heartbeat (getDeviceInfo) valide la session juste après.
		const code = step2.statusCode ?? 0
		if (code < 200 || code >= 400) {
			throw new Error(`NVX login failed: HTTP ${step2.statusCode} (expected 2xx/3xx)`)
		}
		this.authLog.debug(`Login OK — ${this.cookies.size} cookies received`)
	}

	async logout(): Promise<void> {
		this.authLog.debug('Logout triggered')
		try {
			const res = await this.rawRequest('GET', '/logout')
			await this.drainBody(res)
		} finally {
			this.clearCookies()
		}
	}

	clearCookies(): void {
		this.cookies.clear()
	}

	// ── Public API helpers ────────────────────────────────────────────────────

	async get<T>(path: string): Promise<T> {
		return this.request<T>('GET', path)
	}

	async post<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>('POST', path, JSON.stringify(body))
	}

	/**
	 * POST a CresNext SetPartial body to /Device and return the first
	 * Results[].StatusId (0 = OK, 1 = Reboot needed, other = error, -1 = malformed).
	 * Contract observed in docs/hardware-validation.md §4.
	 */
	async postSetPartial(body: unknown): Promise<number> {
		const resp = await this.post<{ Actions?: Array<{ Results?: Array<{ StatusId?: number }> }> }>(
			'/Device',
			body,
		)
		return resp.Actions?.[0]?.Results?.[0]?.StatusId ?? -1
	}

	// ── Device info (v0.1 heartbeat) ─────────────────────────────────────────

	async getDeviceInfo(): Promise<DeviceInfo> {
		const data = await this.get<{
			Device: { DeviceInfo: { Name: string; DeviceVersion: string; Model: string } }
		}>('/Device/DeviceInfo')
		return {
			name: data.Device.DeviceInfo.Name,
			firmware: data.Device.DeviceInfo.DeviceVersion,
			model: data.Device.DeviceInfo.Model,
		}
	}

	// ── Private: request with 403→re-login retry ──────────────────────────────

	private async request<T>(method: string, path: string, body?: string, retry = true): Promise<T> {
		const start = Date.now()
		const res = await this.rawRequest(method, path, body)

		this.extractCookies(res.headers['set-cookie'] ?? [])

		if (res.statusCode === 403) {
			await this.drainBody(res)
			this.httpLog.warn(`HTTP 403 on ${method} ${path} → re-login triggered`)
			if (retry) {
				if (!this.loginMutex) {
					this.loginMutex = this.login().finally(() => {
						this.loginMutex = null
					})
				}
				await this.loginMutex
				return this.request<T>(method, path, body, false)
			}
			throw new NvxAuthError(`NVX HTTP 403 on ${path} after re-login`)
		}

		if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
			await this.drainBody(res)
			throw new Error(`NVX HTTP ${res.statusCode} on ${method} ${path}`)
		}

		const raw = await this.readBody(res)
		const elapsed = Date.now() - start
		this.httpLog.debug(`${method} ${path} ← HTTP ${res.statusCode} (${elapsed}ms)`)
		return JSON.parse(raw) as T
	}

	// ── Private: raw HTTPS request ────────────────────────────────────────────

	private rawRequest(
		method: string,
		path: string,
		body?: string,
		extraHeaders?: Record<string, string>,
	): Promise<IncomingMessage> {
		this.httpLog.debug(`${method} ${path} → sent`)
		return new Promise((resolve, reject) => {
			const port = this.config.port ?? 443
			const req = https.request(
				{
					hostname: this.config.host,
					port,
					path,
					method,
					agent: this.agent,
					timeout: 10000,
					headers: {
						Cookie: this.buildCookieHeader(),
						Accept: 'application/json',
						...(body && !extraHeaders?.['Content-Type']
							? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) }
							: {}),
						...extraHeaders,
					},
				},
				resolve,
			)
			req.on('error', (err) => {
				this.httpLog.error(`Network error: ${method} ${path} — ${err.message}`)
				reject(err)
			})
			req.on('timeout', () => {
				req.destroy()
				this.httpLog.error(`Timeout: ${method} ${path}`)
				reject(new Error(`NVX timeout: ${method} ${path}`))
			})
			if (body) req.write(body)
			req.end()
		})
	}

	// ── Private: cookie management ────────────────────────────────────────────

	private extractCookies(rawCookies: string[]): void {
		for (const raw of rawCookies) {
			const [pair] = raw.split(';')
			const eqIdx = pair.indexOf('=')
			if (eqIdx === -1) continue
			const name = pair.substring(0, eqIdx).trim()
			const value = pair.substring(eqIdx + 1).trim()
			if (name) this.cookies.set(name, value)
		}
	}

	private buildCookieHeader(): string {
		return Array.from(this.cookies.entries())
			.map(([k, v]) => `${k}=${v}`)
			.join('; ')
	}

	// ── Private: body helpers ─────────────────────────────────────────────────

	private readBody(res: IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = []
			res.on('data', (chunk: Buffer) => chunks.push(chunk))
			res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
			res.on('error', reject)
		})
	}

	private drainBody(res: IncomingMessage): Promise<void> {
		return new Promise((resolve) => {
			res.resume()
			res.on('end', resolve)
			res.on('error', resolve)
		})
	}
}
