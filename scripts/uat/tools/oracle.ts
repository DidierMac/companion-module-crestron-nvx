import type { NvxApiClient } from '../../../src/api.js'

type Json = Record<string, unknown>
type BuildBodiesFn = (subsystem: Json) => unknown[]

/** Device ground-truth: lit les sous-systèmes NVX, capture des baselines, les restaure.
 *  Oracle vérifié par les journeys — indépendant de Companion. */
export class Oracle {
  /** Map<endpoint, Device[lastSegment]> — baselines capturées, clés par endpoint. */
  private snapshots: Map<string, Json> = new Map()

  constructor(private clientFactory: () => NvxApiClient) {}

  // ── Noyau générique ────────────────────────────────────────────────────────

  /** Login + GET endpoint, retourne Device[dernier-segment] BRUT (sans extraction).
   *  L'extraction de la portion pertinente (ex. Streams[idx]) est du ressort du SubsystemSpec.
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
