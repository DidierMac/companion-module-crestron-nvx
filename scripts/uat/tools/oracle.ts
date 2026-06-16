import { streamTransmitBody } from '../../../src/panels/encoder.js'
import { streamReceiveBody } from '../../../src/panels/decoder.js'
import type { NvxApiClient } from '../../../src/api.js'

/** Device ground-truth: reads Streams[0] directly from the NVX, captures a baseline, restores it.
 *  This is the oracle the journey verifies against — independent of Companion. */
export class Oracle {
  private baseline: Record<string, unknown> | null = null
  private baselineRx: Record<string, unknown> | null = null
  constructor(private clientFactory: () => NvxApiClient) {}

  /** Login + GET StreamTransmit Streams[0]. */
  async readStream0(): Promise<Record<string, unknown>> {
    const c = this.clientFactory()
    await c.login()
    const json = (await c.get('/Device/StreamTransmit')) as {
      Device?: { StreamTransmit?: { Streams?: Array<Record<string, unknown>> } }
    }
    const s = json.Device?.StreamTransmit?.Streams?.[0]
    if (!s) throw new Error('Streams[0] absent')
    return s
  }

  /** Login + GET StreamReceive Streams[0]. */
  async readReceiveStream0(): Promise<Record<string, unknown>> {
    const c = this.clientFactory()
    await c.login()
    const json = (await c.get('/Device/StreamReceive')) as {
      Device?: { StreamReceive?: { Streams?: Array<Record<string, unknown>> } }
    }
    const s = json.Device?.StreamReceive?.Streams?.[0]
    if (!s) throw new Error('StreamReceive Streams[0] absent')
    return s
  }

  async captureBaseline(): Promise<void> {
    this.baseline = await this.readStream0()
  }

  /** Capture StreamReceive Streams[0] before decoder USE steps, for TEARDOWN restore. */
  async captureBaselineRx(): Promise<void> {
    this.baselineRx = await this.readReceiveStream0()
  }

  /** Restore name/multicast/state captured at baseline. No-op if no baseline. */
  async restore(): Promise<void> {
    if (!this.baseline) return
    const c = this.clientFactory()
    await c.login()
    const b = this.baseline
    if (typeof b.RtspSessionName === 'string')
      await c.postSetPartial(streamTransmitBody(0, { RtspSessionName: b.RtspSessionName }))
    if (typeof b.MulticastAddress === 'string')
      await c.postSetPartial(streamTransmitBody(0, { MulticastAddress: b.MulticastAddress }))
    await c.postSetPartial(streamTransmitBody(0, b.Status === 'Stream started' ? { Start: true } : { Stop: true }))
  }

  /**
   * POST /_control/scenario to the fake device (no auth required by that route).
   * Uses the oracle's client factory so certs are handled identically to reads.
   * No-op if the target is a real device (the route doesn't exist → the call throws,
   * which is intentional: callers should guard with a fake-only flag or let it FAIL).
   */
  async setRxScenario(scenario: string): Promise<void> {
    const c = this.clientFactory()
    await c.login()
    await c.post('/_control/scenario', { role: 'rx', scenario })
  }

  /** Restore StreamReceive source/state captured at baselineRx. No-op if no baselineRx. */
  async restoreRx(): Promise<void> {
    if (!this.baselineRx) return
    const c = this.clientFactory()
    await c.login()
    const b = this.baselineRx
    // Restore session initiation + coordinates
    if (typeof b.SessionInitiation === 'string') {
      if (b.SessionInitiation === 'ByReceiver' && typeof b.StreamLocation === 'string')
        await c.postSetPartial(streamReceiveBody(0, { SessionInitiation: 'ByReceiver', StreamLocation: b.StreamLocation }))
      else if (typeof b.MulticastAddress === 'string')
        await c.postSetPartial(streamReceiveBody(0, { SessionInitiation: b.SessionInitiation, MulticastAddress: b.MulticastAddress }))
    }
    // Restore start/stop state
    await c.postSetPartial(streamReceiveBody(0, b.Status === 'Stream started' ? { Start: true } : { Stop: true }))
  }
}
