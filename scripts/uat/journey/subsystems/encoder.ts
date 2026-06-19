/**
 * encoder.ts — SubsystemSpec pour StreamTransmit (encodeur NVX).
 *
 * Remplace les 4 appels writeStep() + pollOracle() + readStream0() de steps-lab.ts
 * par un spec déclaratif exploité par les 5 builders de subsystem.ts.
 *
 * buildBodies() = ex-txBuilder d'oracle.ts (déplacé ici pour découpler l'oracle).
 * Séquence POST restore : RtspSessionName → MulticastAddress → {Start|Stop}.
 */

import type { SubsystemSpec } from '../subsystem.js'
import { streamsSetBody } from './streams-body.js'

type Json = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

// Known test values the SETUP buttons must be configured to set (so the oracle can verify).
const UAT_STREAM_NAME = 'UAT-STREAM'
const UAT_MULTICAST = '239.200.0.1'

export const encoderSpec: SubsystemSpec = {
  id: 'encoder',
  role: 'Transmitter',
  endpoint: '/Device/StreamTransmit',

  /** Drill Device.StreamTransmit → Streams[0] ; throw si absent (sentinel-safe). */
  extract(subsystem: Json): Json {
    const s = (subsystem.Streams as Array<Json>)?.[0]
    if (!s) throw new Error('StreamTransmit Streams[0] absent')
    return s
  },

  /** Reproduit la séquence POST de l'ancien txBuilder :
   *  POST {RtspSessionName} si présent → POST {MulticastAddress} si présent → POST {Start|Stop}. */
  buildBodies(subsystem: Json): unknown[] {
    if (!('Streams' in subsystem)) throw new Error('buildBodies: Streams absent du subsystem')
    const b = (subsystem.Streams as Array<Json>)?.[0] ?? {}
    const bodies: unknown[] = []
    if (typeof b.RtspSessionName === 'string')
      bodies.push(streamsSetBody('StreamTransmit', 0, { RtspSessionName: b.RtspSessionName }))
    if (typeof b.MulticastAddress === 'string')
      bodies.push(streamsSetBody('StreamTransmit', 0, { MulticastAddress: b.MulticastAddress }))
    bodies.push(streamsSetBody('StreamTransmit', 0, b.Status === 'Stream started' ? { Start: true } : { Stop: true }))
    return bodies
  },

  vars: [
    // ready sur tx_stream_name : gate de polling — attend le 1ᵉʳ poll module (variable vide au démarrage).
    { var: 'tx_stream_name', device: (s) => str(s.RtspSessionName), ready: (v) => v !== '' },
    { var: 'tx_multicast_address', device: (s) => str(s.MulticastAddress) },
    { var: 'tx_stream_url', device: (s) => str(s.StreamLocation) },
    // tx_enabled est une string 'true'/'false' dérivée du Status.
    { var: 'tx_enabled', device: (s) => String(str(s.Status) === 'Stream started') },
  ],

  writes: [
    {
      id: 'ENC-NAME',
      title: 'set stream name → device',
      actionKey: 'set_stream_name',
      pred: (s) => str(s.RtspSessionName) === UAT_STREAM_NAME,
      expected: { RtspSessionName: UAT_STREAM_NAME },
    },
    {
      id: 'ENC-MULTICAST',
      title: 'set multicast address → device',
      actionKey: 'set_multicast_address',
      pred: (s) => str(s.MulticastAddress) === UAT_MULTICAST,
      expected: { MulticastAddress: UAT_MULTICAST },
    },
    {
      id: 'ENC-ENABLE',
      title: 'start stream → device',
      actionKey: 'enc_enable_stream',
      pred: (s) => str(s.Status) === 'Stream started',
      expected: { Status: 'Stream started' },
    },
    {
      id: 'ENC-DISABLE',
      title: 'stop stream → device',
      actionKey: 'enc_disable_stream',
      pred: (s) => str(s.Status) !== 'Stream started',
      expected: { Status: 'not started' },
    },
  ],
}
