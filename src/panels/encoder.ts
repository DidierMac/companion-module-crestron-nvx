import type { Panel } from './types.js'
import { subsystemObject } from '../capability.js'

/** First stream of StreamTransmit (the primary stream, position 0). */
function stream0(json: unknown): Record<string, unknown> | null {
  const st = subsystemObject(json, 'StreamTransmit')
  const streams = st?.Streams
  if (!Array.isArray(streams) || streams.length === 0) return null
  const s = streams[0]
  return typeof s === 'object' && s !== null ? (s as Record<string, unknown>) : null
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Build a position-addressed StreamTransmit SetPartial body (contract §4). */
export function streamTransmitBody(index: number, props: Record<string, unknown>): unknown {
  const streams = Array.from({ length: index + 1 }, (_, i) => (i === index ? props : {}))
  return { Device: { StreamTransmit: { Streams: streams } } }
}

export const encoderPanel: Panel = {
  id: 'encoder',
  endpoint: '/Device/StreamTransmit',
  gate: (ctx) => ctx.role === 'Transmitter',
  variableDefinitions: {
    stream_name: { name: 'Encoder: stream name' },
    multicast_address: { name: 'Encoder: multicast address' },
    encoder_url: { name: 'Encoder: stream URL' },
    stream_enabled: { name: 'Encoder: stream enabled' },
  },
  readVariables(json) {
    const s = stream0(json)
    return {
      stream_name: str(s?.RtspSessionName),
      multicast_address: str(s?.MulticastAddress),
      encoder_url: str(s?.StreamLocation),
      stream_enabled: str(s?.Status) === 'Stream started',
    }
  },
  buildActions: () => ({}),     // filled in Task 7
  buildFeedbacks: () => ({}),   // filled in Task 8
}
