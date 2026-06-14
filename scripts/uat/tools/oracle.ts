import { streamTransmitBody } from '../../../src/panels/encoder.js'
import type { NvxApiClient } from '../../../src/api.js'

/** Device ground-truth: reads Streams[0] directly from the NVX, captures a baseline, restores it.
 *  This is the oracle the journey verifies against — independent of Companion. */
export class Oracle {
  private baseline: Record<string, unknown> | null = null
  constructor(private clientFactory: () => NvxApiClient) {}

  /** Login + GET Streams[0]. */
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

  async captureBaseline(): Promise<void> {
    this.baseline = await this.readStream0()
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
}
