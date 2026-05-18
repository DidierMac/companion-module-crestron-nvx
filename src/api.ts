import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { ModuleConfig } from './config.js'

export interface DeviceInfo {
	name: string
	firmware: string
	model: string
}

export class NvxApiClient {
	private cookies: Map<string, string> = new Map()
	private loginMutex: Promise<void> | null = null
	private agent: https.Agent

	constructor(private config: ModuleConfig) {
		this.agent = this.buildAgent()
	}

	updateConfig(config: ModuleConfig): void {
		this.config = config
		this.agent = this.buildAgent()
	}

	private buildAgent(): https.Agent {
		return new https.Agent({
			rejectUnauthorized: !this.config.ignoreSelfSignedCert,
		})
	}

	// ── Authentication ────────────────────────────────────────────────────────

	async login(): Promise<void> {
		// Step 1: GET /userlogin.html to retrieve TRACKID cookie
		const step1 = await this.rawRequest('GET', '/userlogin.html')
		this.extractCookies(step1.headers['set-cookie'] ?? [])
		await this.drainBody(step1)

		const trackid = this.cookies.get('TRACKID')
		if (!trackid) throw new Error('NVX login: TRACKID absent from step 1 response')

		// Step 2: POST form URL-encoded — success = HTTP 302
		const body = `login=${encodeURIComponent(this.config.username)}&passwd=${encodeURIComponent(this.config.password)}`
		const step2 = await this.rawRequest('POST', '/userlogin.html', body, {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Content-Length': String(Buffer.byteLength(body)),
			Origin: `https://${this.config.host}`,
			Referer: `https://${this.config.host}/userlogin.html`,
		})
		this.extractCookies(step2.headers['set-cookie'] ?? [])
		await this.drainBody(step2)

		if (step2.statusCode !== 302) {
			throw new Error(`NVX login failed: HTTP ${step2.statusCode} (expected 302)`)
		}
	}

	async logout(): Promise<void> {
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
		const res = await this.rawRequest(method, path, body)

		// Always update cookies — AuthByPasswd rolls after every response
		this.extractCookies(res.headers['set-cookie'] ?? [])

		if (res.statusCode === 403) {
			await this.drainBody(res)
			if (retry) {
				if (!this.loginMutex) {
					this.loginMutex = this.login().finally(() => {
						this.loginMutex = null
					})
				}
				await this.loginMutex
				return this.request<T>(method, path, body, false)
			}
			throw new Error(`NVX HTTP 403 on ${path} after re-login`)
		}

		if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
			await this.drainBody(res)
			throw new Error(`NVX HTTP ${res.statusCode} on ${method} ${path}`)
		}

		const raw = await this.readBody(res)
		return JSON.parse(raw) as T
	}

	// ── Private: raw HTTPS request ────────────────────────────────────────────

	private rawRequest(
		method: string,
		path: string,
		body?: string,
		extraHeaders?: Record<string, string>,
	): Promise<IncomingMessage> {
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
			req.on('error', reject)
			req.on('timeout', () => {
				req.destroy()
				reject(new Error(`NVX timeout: ${method} ${path}`))
			})
			if (body) req.write(body)
			req.end()
		})
	}

	// ── Private: cookie management ────────────────────────────────────────────

	// TODO (apprentissage) : implémenter extractCookies()
	// Chaque entrée de rawCookies a la forme "name=value; Path=/; HttpOnly"
	// → extraire name et value (tout ce qui est avant le premier ';')
	// → mettre à jour this.cookies avec cookies.set(name, value)
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
