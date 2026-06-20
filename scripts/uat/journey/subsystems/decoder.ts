/**
 * decoder.ts — SubsystemSpec pour StreamReceive (décodeur NVX).
 *
 * Remplace les 3 writeStepRx() + pollOracleRx() + readReceiveStream0() de steps-lab.ts
 * par un spec déclaratif exploité par les 5 builders de subsystem.ts.
 *
 * buildBodies() = ex-rxBuilder d'oracle.ts (déplacé ici pour découpler l'oracle).
 * Séquence POST restore : {SessionInitiation + StreamLocation|MulticastAddress} → {Start|Stop}.
 */

import type { SubsystemSpec } from '../subsystem.js'
import { streamsSetBody } from './streams-body.js'

type Json = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

// Known test values the SETUP buttons must be configured to set (so the oracle can verify).
const UAT_RX_URL = 'rtsp://192.168.2.10:554/live.sdp'
const UAT_RX_MULTICAST = '239.1.1.4'
const UAT_RX_CONNECT_NAME = 'DM-NVX-360-C442684E534B' // resolves → Multicast via RTSP / 239.1.1.4

export const decoderSpec: SubsystemSpec = {
  id: 'decoder',
  role: 'Receiver',
  endpoint: '/Device/StreamReceive',

  /** Drill Device.StreamReceive → Streams[0] ; throw si absent (sentinel-safe). */
  extract(subsystem: Json): Json {
    const s = (subsystem.Streams as Array<Json>)?.[0]
    if (!s) throw new Error('StreamReceive Streams[0] absent')
    return s
  },

  /** Reproduit la séquence POST de l'ancien rxBuilder d'oracle.ts :
   *  POST {SessionInitiation + StreamLocation|MulticastAddress} si présent → POST {Start|Stop}. */
  buildBodies(subsystem: Json): unknown[] {
    if (!('Streams' in subsystem)) throw new Error('buildBodies: Streams absent du subsystem')
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
  },

  vars: [
    // ready sur rx_status : gate de polling — attend le 1ᵉʳ poll module (variable vide au démarrage).
    { var: 'rx_status', device: (s) => str(s.Status), ready: (v) => v !== '' },
    { var: 'rx_source_url', device: (s) => str(s.StreamLocation) },
    { var: 'rx_multicast_address', device: (s) => str(s.MulticastAddress) },
    { var: 'rx_session_initiation', device: (s) => str(s.SessionInitiation) },
  ],

  writes: [
    {
      id: 'DEC-SOURCE-URL',
      title: 'set source URL (ByReceiver) → device',
      actionKey: 'set_source_url',
      pred: (s) => str(s.SessionInitiation) === 'ByReceiver' && str(s.StreamLocation) === UAT_RX_URL,
      expected: { SessionInitiation: 'ByReceiver', StreamLocation: UAT_RX_URL },
    },
    {
      id: 'DEC-SOURCE-MCAST',
      title: 'set source multicast → device',
      actionKey: 'set_source_multicast',
      pred: (s) => str(s.SessionInitiation) === 'Multicast via RTSP' && str(s.MulticastAddress) === UAT_RX_MULTICAST,
      expected: { SessionInitiation: 'Multicast via RTSP', MulticastAddress: UAT_RX_MULTICAST },
    },
    // NOTE: connect-by-name resolves to the same multicast as DEC-SOURCE-MCAST → shared terminal state
    // by design (assertion can't distinguish the two paths at device level).
    {
      id: 'DEC-CONNECT',
      title: 'connect to discovered stream by name → device',
      actionKey: 'connect_to_stream',
      pred: (s) => str(s.SessionInitiation) === 'Multicast via RTSP' && str(s.MulticastAddress) === UAT_RX_MULTICAST,
      expected: { SessionInitiation: 'Multicast via RTSP', MulticastAddress: UAT_RX_MULTICAST, note: `resolved from name '${UAT_RX_CONNECT_NAME}'` },
    },
    {
      id: 'DEC-NEGOTIATING',
      title: 'start reception (negotiating scenario) → CodecReady false, resolution populated',
      actionKey: 'dec_enable_stream',
      scenario: 'negotiating',
      pred: (s) => Number(s.HorizontalResolution) > 0 && s.CodecReady === false,
      expected: { HorizontalResolution: '>0', CodecReady: false },
    },
    {
      id: 'DEC-DECODING',
      title: 'start reception (decoding scenario) → CodecReady true',
      actionKey: 'dec_enable_stream',
      scenario: 'decoding',
      pred: (s) => s.CodecReady === true,
      expected: { CodecReady: true },
    },
    {
      id: 'DEC-ENABLE',
      title: 'start reception → device',
      actionKey: 'dec_enable_stream',
      pred: (s) => s.CodecReady === true || Number(s.NumVideoPacketsRcvd) > 0,
      expected: { CodecReady: true, NumVideoPacketsRcvd: '>0' },
    },
    {
      id: 'DEC-DISABLE',
      title: 'stop reception → device',
      actionKey: 'dec_disable_stream',
      pred: (s) => s.CodecReady === false,
      expected: { CodecReady: false },
    },
  ],
}
