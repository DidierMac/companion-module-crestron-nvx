import { combineRgb } from '@companion-module/base'
import type { Panel } from './types.js'
import { subsystemObject } from '../capability.js'
import { discoveredList, resolveSource } from './discovery.js'

// Colour constants used by feedbacks/presets (Tasks 5-6); defined here to mirror encoder.ts style.
export const WHITE = combineRgb(255, 255, 255)
export const GREEN = combineRgb(0, 170, 0)
export const BLUE = combineRgb(0, 51, 102)
export const DARKRED = combineRgb(102, 0, 0)
export const BLACK = combineRgb(0, 0, 0)

/** First stream of StreamReceive (the primary stream, position 0). Sentinel-safe. */
function stream0(json: unknown): Record<string, unknown> | null {
  const sr = subsystemObject(json, 'StreamReceive')
  const streams = sr?.Streams
  if (!Array.isArray(streams) || streams.length === 0) return null
  const s = streams[0]
  return typeof s === 'object' && s !== null ? (s as Record<string, unknown>) : null
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

/** Build a position-addressed StreamReceive SetPartial body (contract §4.2). */
export function streamReceiveBody(index: number, props: Record<string, unknown>): unknown {
  const streams = Array.from({ length: index + 1 }, (_, i) => (i === index ? props : {}))
  return { Device: { StreamReceive: { Streams: streams } } }
}

export const decoderPanel: Panel = {
  id: 'decoder',
  endpoint: '/Device/StreamReceive',
  auxEndpoints: ['/Device/DiscoveredStreams'],
  gate: (ctx) => ctx.role === 'Receiver',
  variableDefinitions: {
    rx_source_url: { name: 'Decoder: source URL' },
    rx_multicast_address: { name: 'Decoder: source multicast' },
    rx_session_initiation: { name: 'Decoder: session initiation mode' },
    rx_status: { name: 'Decoder: status' },
    rx_resolution: { name: 'Decoder: received resolution' },
    rx_processing: { name: 'Decoder: processing (transition)' },
    rx_stream_name: { name: 'Decoder: source stream name' },
    rx_discovered_count: { name: 'Decoder: discovered stream count' },
    rx_discovered_names: { name: 'Decoder: discovered stream names' },
  },
  readVariables(primary, auxMap) {
    const s = stream0(primary)
    const list = discoveredList(auxMap?.['/Device/DiscoveredStreams'])
    const url = str(s?.StreamLocation)
    const mcast = str(s?.MulticastAddress)
    const match = list.find((d) => (mcast && d.multicastAddress === mcast) || (url && d.rtspUri === url))
    return {
      rx_source_url: url,
      rx_multicast_address: mcast,
      rx_session_initiation: str(s?.SessionInitiation),
      rx_status: str(s?.Status),
      rx_resolution: `${num(s?.HorizontalResolution)}x${num(s?.VerticalResolution)}`,
      rx_processing: s?.Processing === true,
      rx_stream_name: match?.sessionName ?? '',
      rx_discovered_count: list.length,
      rx_discovered_names: list.map((d) => d.sessionName).join(', '),
    }
  },
  buildActions: (api, helpers) => {
    const isProcessing = (): boolean => helpers?.state().rx_processing === true
    const list = () => discoveredList(helpers?.aux()['/Device/DiscoveredStreams'])
    const post = async (props: Record<string, unknown>): Promise<void> => {
      if (isProcessing()) return // device in transition — wait for Processing===false (spec §6)
      await api.postSetPartial(streamReceiveBody(0, props))
    }
    return {
      set_source_url: {
        name: 'Decoder: set source URL (RTSP)',
        options: [{ type: 'textinput', id: 'url', label: 'Source RTSP URL', default: '', useVariables: true }],
        callback: async (ev) => {
          // useVariables: true — Companion resolves expressions before the callback is called
          const url = String(ev.options.url ?? '')
          await post({ SessionInitiation: 'ByReceiver', StreamLocation: url })
        },
      },
      set_source_multicast: {
        name: 'Decoder: set source multicast',
        options: [{ type: 'textinput', id: 'address', label: 'Source multicast address', default: '239.1.1.1', useVariables: true }],
        callback: async (ev) => {
          const addr = String(ev.options.address ?? '')
          await post({ SessionInitiation: 'Multicast via RTSP', MulticastAddress: addr })
        },
      },
      connect_to_stream: {
        name: 'Decoder: connect to discovered stream',
        options: [
          {
            type: 'dropdown',
            id: 'stream',
            label: 'Discovered stream',
            default: 'custom',
            choices: [
              ...list().map((s) => ({ id: s.uniqueId, label: s.sessionName })),
              { id: 'custom', label: 'Custom (name / URL / multicast — supports variables)' },
            ],
          },
          {
            type: 'textinput',
            id: 'custom',
            label: 'Custom source',
            default: '',
            useVariables: true,
            isVisibleExpression: '$(options:stream) == "custom"',
          },
        ],
        callback: async (ev) => {
          const selection = String(ev.options.stream ?? 'custom')
          const custom = String(ev.options.custom ?? '')
          const resolved = resolveSource(selection, custom, list())
          if (!resolved) return
          await post(resolved as unknown as Record<string, unknown>)
        },
      },
      enable_stream: {
        name: 'Decoder: start reception',
        options: [],
        callback: async () => { await post({ Start: true }) },
      },
      disable_stream: {
        name: 'Decoder: stop reception',
        options: [],
        callback: async () => { await post({ Stop: true }) },
      },
    }
  },
  buildFeedbacks: () => ({}),
}
