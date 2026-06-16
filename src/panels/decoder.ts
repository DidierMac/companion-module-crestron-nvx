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
  buildFeedbacks: (state) => ({
    rx_receiving: {
      type: 'boolean',
      name: 'Decoder: receiving',
      description: 'Active while the decoder is receiving a stream (status not Stopped, not transitioning)',
      defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [],
      // Heuristic until the active Status string is confirmed at lab (spec §7-#1).
      callback: () => state().rx_status !== 'Stream Stopped' && state().rx_status !== '' && state().rx_processing !== true,
    },
    rx_source_matches: {
      type: 'boolean',
      name: 'Decoder: source matches',
      description: 'Active when the current source equals the given value',
      defaultStyle: { bgcolor: combineRgb(0, 102, 204), color: WHITE },
      options: [
        { type: 'textinput', id: 'value', label: 'Value', default: '', useVariables: true },
        {
          type: 'dropdown',
          id: 'by',
          label: 'Compare by',
          default: 'name',
          choices: [
            { id: 'name', label: 'Stream name' },
            { id: 'url', label: 'Source URL' },
            { id: 'multicast', label: 'Multicast address' },
          ],
        },
      ],
      callback: (fb) => {
        const value = String(fb.options.value ?? '')
        const by = String(fb.options.by ?? 'name')
        const s = state()
        if (by === 'url') return s.rx_source_url === value
        if (by === 'multicast') return s.rx_multicast_address === value
        return s.rx_stream_name === value
      },
    },
    rx_processing: {
      type: 'boolean',
      name: 'Decoder: processing (transition)',
      description: 'Active while the device is transitioning (commands should wait)',
      defaultStyle: { bgcolor: combineRgb(153, 102, 0), color: WHITE },
      options: [],
      callback: () => state().rx_processing === true,
    },
  }),
  buildPresets: () => ({
    section: {
      id: 'decoder',
      name: 'Decoder',
      description: 'Ready-to-use buttons for the decoder (StreamReceive) stream.',
      definitions: ['dec_start_rx', 'dec_stop_rx', 'dec_set_source_url', 'dec_set_source_multicast', 'dec_connect_stream'],
    },
    presets: {
      dec_start_rx: {
        type: 'simple',
        name: 'Start reception',
        style: { text: 'Start\nRX', size: 'auto', color: WHITE, bgcolor: BLACK },
        steps: [{ down: [{ actionId: 'enable_stream', options: {} }], up: [] }],
        feedbacks: [{ feedbackId: 'rx_receiving', options: {}, style: { bgcolor: GREEN, color: WHITE } }],
      },
      dec_stop_rx: {
        type: 'simple',
        name: 'Stop reception',
        style: { text: 'Stop\nRX', size: 'auto', color: WHITE, bgcolor: DARKRED },
        steps: [{ down: [{ actionId: 'disable_stream', options: {} }], up: [] }],
        feedbacks: [],
      },
      dec_set_source_url: {
        type: 'simple',
        name: 'Set source URL',
        style: { text: 'Set\nURL', size: 'auto', color: WHITE, bgcolor: BLUE },
        steps: [{ down: [{ actionId: 'set_source_url', options: { url: '' } }], up: [] }],
        feedbacks: [],
      },
      dec_set_source_multicast: {
        type: 'simple',
        name: 'Set source multicast',
        style: { text: 'Set\nMcast', size: 'auto', color: WHITE, bgcolor: BLUE },
        steps: [{ down: [{ actionId: 'set_source_multicast', options: { address: '239.1.1.1' } }], up: [] }],
        feedbacks: [],
      },
      dec_connect_stream: {
        type: 'simple',
        name: 'Connect to stream',
        style: { text: 'Connect\nStream', size: 'auto', color: WHITE, bgcolor: BLUE },
        steps: [{ down: [{ actionId: 'connect_to_stream', options: { stream: 'custom', custom: '' } }], up: [] }],
        feedbacks: [],
      },
    },
  }),
}
