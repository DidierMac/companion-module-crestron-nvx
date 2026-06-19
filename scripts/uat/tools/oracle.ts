import type { NvxApiClient } from '../../../src/api.js'

type Json = Record<string, unknown>
type BuildBodiesFn = (subsystem: Json) => unknown[]

// ── Local builder (découplé du code de production — cf. plan phase 3 vague 1) ──

/** Construit { Device: { [subsystem]: { Streams: [props, …] } } } pour le stream à l'index donné.
 *  Oracle utilise toujours index 0 — paramétre conservé pour alignement avec le plan. */
function streamsSetBody(subsystem: 'StreamTransmit' | 'StreamReceive', index: number, props: Record<string, unknown>): unknown {
  const streams = Array.from({ length: index + 1 }, (_, i) => (i === index ? props : {}))
  return { Device: { [subsystem]: { Streams: streams } } }
}

// ── Builders privés (portent la logique de séquence restore — détenus par oracle en v1) ───

/** Builder Tx : reproduit la séquence POST de l'ancien restore() pour StreamTransmit.
 *  Reçoit Device.StreamTransmit (le subsystem complet), drill dans Streams[0].
 *  Séquence : POST {RtspSessionName} si présent → POST {MulticastAddress} si présent → POST {Start|Stop}. */
function txBuilder(subsystem: Json): unknown[] {
  const b = (subsystem.Streams as Array<Json>)?.[0] ?? {}
  const bodies: unknown[] = []
  if (typeof b.RtspSessionName === 'string')
    bodies.push(streamsSetBody('StreamTransmit', 0, { RtspSessionName: b.RtspSessionName }))
  if (typeof b.MulticastAddress === 'string')
    bodies.push(streamsSetBody('StreamTransmit', 0, { MulticastAddress: b.MulticastAddress }))
  bodies.push(streamsSetBody('StreamTransmit', 0, b.Status === 'Stream started' ? { Start: true } : { Stop: true }))
  return bodies
}

/** Builder Rx : reproduit la séquence POST de l'ancien restoreRx() pour StreamReceive.
 *  Reçoit Device.StreamReceive (le subsystem complet), drill dans Streams[0].
 *  Séquence : POST {SessionInitiation + StreamLocation|MulticastAddress} → POST {Start|Stop}. */
function rxBuilder(subsystem: Json): unknown[] {
  const b = (subsystem.Streams as Array<Json>)?.[0] ?? {}
  const bodies: unknown[] = []
  if (typeof b.SessionInitiation === 'string') {
    if (b.SessionInitiation === 'ByReceiver' && typeof b.StreamLocation === 'string')
      bodies.push(streamsSetBody('StreamReceive', 0, { SessionInitiation: 'ByReceiver', StreamLocation: b.StreamLocation }))
    else if (typeof b.MulticastAddress === 'string')
      bodies.push(streamsSetBody('StreamReceive', 0, { SessionInitiation: b.SessionInitiation, MulticastAddress: b.MulticastAddress }))
  }
  bodies.push(streamsSetBody('StreamReceive', 0, b.Status === 'Stream started' ? { Start: true } : { Stop: true }))
  return bodies
}

/** Device ground-truth: lit les sous-systèmes NVX, capture des baselines, les restaure.
 *  Oracle vérifié par les journeys — indépendant de Companion. */
export class Oracle {
  /** Map<endpoint, Device[lastSegment]> — baselines capturées, clés par endpoint. */
  private snapshots: Map<string, Json> = new Map()

  constructor(private clientFactory: () => NvxApiClient) {}

  // ── Noyau générique ────────────────────────────────────────────────────────

  /** Login + GET endpoint, retourne Device[dernier-segment] BRUT (PAS Streams[0]).
   *  Sentinel-safe : throw si Device[segment] est absent. logout() dans finally. */
  async read(endpoint: string): Promise<Json> {
    const segment = endpoint.split('/').pop() ?? endpoint
    const c = this.clientFactory()
    try {
      await c.login()
      const json = (await c.get(endpoint)) as { Device?: Record<string, Json> }
      const subsystem = json.Device?.[segment]
      if (subsystem === undefined) throw new Error(`${segment} absent from Device response`)
      return subsystem
    } finally {
      await c.logout().catch(() => {})
    }
  }

  /** Capture Device[dernier-segment] pour endpoint ; stocké avec endpoint comme clé. */
  async snapshot(endpoint: string): Promise<void> {
    const subsystem = await this.read(endpoint)
    this.snapshots.set(endpoint, subsystem)
  }

  /** Poste buildBodies(baseline) dans l'ordre.
   *  Retourne {skipped:true} si pas de snapshot pour cet endpoint. logout() dans finally. */
  async restore(endpoint: string, buildBodies: BuildBodiesFn): Promise<{ skipped: boolean }> {
    const baseline = this.snapshots.get(endpoint)
    if (baseline === undefined) return { skipped: true }
    const c = this.clientFactory()
    try {
      await c.login()
      for (const body of buildBodies(baseline)) {
        await c.postSetPartial(body)
      }
      return { skipped: false }
    } finally {
      await c.logout().catch(() => {})
    }
  }

  // ── Wrappers legacy (v1 — cohabitent avec steps-lab non migré) ──────────────

  /** Login + GET StreamTransmit Streams[0]. */
  async readStream0(): Promise<Json> {
    const subsystem = await this.read('/Device/StreamTransmit')
    const s = (subsystem.Streams as Array<Json>)?.[0]
    if (!s) throw new Error('Streams[0] absent')
    return s
  }

  /** Login + GET StreamReceive Streams[0]. */
  async readReceiveStream0(): Promise<Json> {
    const subsystem = await this.read('/Device/StreamReceive')
    const s = (subsystem.Streams as Array<Json>)?.[0]
    if (!s) throw new Error('StreamReceive Streams[0] absent')
    return s
  }

  /** = snapshot('/Device/StreamTransmit') */
  async captureBaseline(): Promise<void> {
    await this.snapshot('/Device/StreamTransmit')
  }

  /** = snapshot('/Device/StreamReceive') */
  async captureBaselineRx(): Promise<void> {
    await this.snapshot('/Device/StreamReceive')
  }

  /** = restore('/Device/StreamTransmit', txBuilder). Renommé depuis restore(). */
  async restoreTx(): Promise<{ skipped: boolean }> {
    return this.restore('/Device/StreamTransmit', txBuilder)
  }

  /** = restore('/Device/StreamReceive', rxBuilder) */
  async restoreRx(): Promise<{ skipped: boolean }> {
    return this.restore('/Device/StreamReceive', rxBuilder)
  }

  // ── Contrôle fake ─────────────────────────────────────────────────────────

  /**
   * POST /_control/scenario au fake device (route sans auth).
   * Utilise la clientFactory de l'oracle pour gérer les certs identiquement aux reads.
   * No-op si la cible est un vrai device (route absente → throw intentionnel).
   */
  async setRxScenario(scenario: string): Promise<void> {
    const c = this.clientFactory()
    try {
      await c.login()
      await c.post('/_control/scenario', { role: 'rx', scenario })
    } finally {
      await c.logout().catch(() => {})
    }
  }
}
