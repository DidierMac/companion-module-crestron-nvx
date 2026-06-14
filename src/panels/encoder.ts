import { combineRgb } from '@companion-module/base'
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
  buildActions: (api) => ({
    set_stream_name: {
      name: 'Encoder: set stream name',
      options: [{ type: 'textinput', id: 'name', label: 'Stream name', default: '' }],
      callback: async (ev) => {
        await api.postSetPartial(streamTransmitBody(0, { RtspSessionName: String(ev.options.name ?? '') }))
      },
    },
    set_multicast_address: {
      name: 'Encoder: set multicast address',
      options: [{ type: 'textinput', id: 'address', label: 'Multicast address', default: '239.1.1.1' }],
      callback: async (ev) => {
        await api.postSetPartial(streamTransmitBody(0, { MulticastAddress: String(ev.options.address ?? '') }))
      },
    },
    enable_stream: {
      name: 'Encoder: start stream',
      options: [],
      callback: async () => {
        await api.postSetPartial(streamTransmitBody(0, { Start: true }))
      },
    },
    disable_stream: {
      name: 'Encoder: stop stream',
      options: [],
      callback: async () => {
        await api.postSetPartial(streamTransmitBody(0, { Stop: true }))
      },
    },
  }),
  buildFeedbacks: (state) => ({
    stream_enabled: {
      type: 'boolean',
      name: 'Encoder: stream enabled',
      description: 'Active when the encoder stream is started',
      defaultStyle: { bgcolor: combineRgb(0, 170, 0), color: combineRgb(255, 255, 255) },
      options: [],
      callback: () => state().stream_enabled === true,
    },
    stream_name_matches: {
      type: 'boolean',
      name: 'Encoder: stream name matches',
      description: 'Active when the encoder stream name equals the given value',
      defaultStyle: { bgcolor: combineRgb(0, 102, 204), color: combineRgb(255, 255, 255) },
      options: [{ type: 'textinput', id: 'name', label: 'Stream name', default: '' }],
      callback: (fb) => state().stream_name === String(fb.options.name ?? ''),
    },
  }),
}
