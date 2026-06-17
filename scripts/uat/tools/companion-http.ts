type Fetch = typeof fetch

/** HTTP error carrying the response status code as a typed field (.status). */
export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Companion connection status, as returned nested under `.status` by the REST API. */
export interface ConnectionStatus {
  category: string // machine-readable: 'ok' | 'warning' | 'error' | 'disabled' (confirmed in fixtures)
  level?: string // human-readable, e.g. 'Connection Failure'
  message?: string // module-supplied detail, e.g. 'NVX timeout: GET /userlogin.html'
}

/** REST client for driving + reading a local Companion (one connection under test). */
export class CompanionHttp {
  constructor(
    private base: string,
    private fetchImpl: Fetch = fetch,
  ) {}

  /** Resolve a connection id from its label, or null if absent. */
  async findConnectionId(label: string): Promise<string | null> {
    const res = await this.fetchImpl(`${this.base}/api/connections`)
    if (!res.ok) throw new HttpError(`/api/connections → HTTP ${res.status}`, res.status)
    const conns = (await res.json()) as Array<{ id: string; label: string }>
    return conns.find((c) => c.label === label)?.id ?? null
  }

  /** Read the connection status. The REST envelope nests it under `.status` (Wave-0 capture). */
  async status(id: string): Promise<ConnectionStatus> {
    const res = await this.fetchImpl(`${this.base}/api/connections/${id}/status`)
    if (!res.ok) throw new HttpError(`/status → HTTP ${res.status}`, res.status)
    const envelope = (await res.json()) as { status?: ConnectionStatus }
    if (!envelope.status) throw new Error(`/status → no .status in envelope`)
    return envelope.status
  }

  async enable(id: string): Promise<void> {
    await this.post(`/api/connections/${id}/enable`)
  }
  async disable(id: string): Promise<void> {
    await this.post(`/api/connections/${id}/disable`)
  }
  async restart(id: string): Promise<void> {
    await this.post(`/api/connections/${id}/restart`)
  }

  /** Read a Companion variable value (trimmed). */
  async getVariable(label: string, name: string): Promise<string> {
    const res = await this.fetchImpl(`${this.base}/api/variable/${label}/${name}/value`)
    if (!res.ok) throw new HttpError(`getVariable ${label}.${name} → HTTP ${res.status}`, res.status)
    return (await res.text()).trim()
  }

  /** Press a button at a grid location (drives module actions). */
  async press(page: number, row: number, col: number): Promise<void> {
    await this.post(`/api/location/${page}/${row}/${col}/press`)
  }

  private async post(path: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}${path}`, { method: 'POST' })
    if (!res.ok) throw new HttpError(`POST ${path} → HTTP ${res.status}`, res.status)
  }
}
