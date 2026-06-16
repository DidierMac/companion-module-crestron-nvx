import { combineRgb } from '@companion-module/base'
import type { Panel } from './types.js'
import { subsystemObject } from '../capability.js'

const WHITE = combineRgb(255, 255, 255)
const GREEN = combineRgb(0, 170, 0)
const BLUE = combineRgb(0, 51, 102)
const DARKRED = combineRgb(102, 0, 0)
const BLACK = combineRgb(0, 0, 0)

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
    stream_processing: { name: 'Encoder: processing (transition)' },
  },
  readVariables(json) {
    const s = stream0(json)
    return {
      stream_name: str(s?.RtspSessionName),
      multicast_address: str(s?.MulticastAddress),
      encoder_url: str(s?.StreamLocation),
      stream_enabled: str(s?.Status) === 'Stream started',
      stream_processing: s?.Processing === true,
    }
  },
  buildActions: (api, helpers) => {
    const isProcessing = (): boolean => helpers?.state().stream_processing === true
    const post = async (props: Record<string, unknown>): Promise<void> => {
      if (isProcessing()) return // device in transition — drop write until Processing===false
      await api.postSetPartial(streamTransmitBody(0, props))
    }
    return {
      set_stream_name: {
        name: 'Encoder: set stream name',
        options: [{ type: 'textinput', id: 'name', label: 'Stream name', default: '' }],
        callback: async (ev) => {
          await post({ RtspSessionName: String(ev.options.name ?? '') })
        },
      },
      set_multicast_address: {
        name: 'Encoder: set multicast address',
        options: [{ type: 'textinput', id: 'address', label: 'Multicast address', default: '239.1.1.1' }],
        callback: async (ev) => {
          await post({ MulticastAddress: String(ev.options.address ?? '') })
        },
      },
      enable_stream: {
        name: 'Encoder: start stream',
        options: [],
        callback: async () => {
          await post({ Start: true })
        },
      },
      disable_stream: {
        name: 'Encoder: stop stream',
        options: [],
        callback: async () => {
          await post({ Stop: true })
        },
      },
    }
  },
  buildFeedbacks: (state) => ({
    stream_enabled: {
      type: 'boolean',
      name: 'Encoder: stream enabled',
      description: 'Active when the encoder stream is started',
      defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [],
      callback: () => state().stream_enabled === true,
    },
    stream_name_matches: {
      type: 'boolean',
      name: 'Encoder: stream name matches',
      description: 'Active when the encoder stream name equals the given value',
      defaultStyle: { bgcolor: combineRgb(0, 102, 204), color: WHITE },
      options: [{ type: 'textinput', id: 'name', label: 'Stream name', default: '' }],
      callback: (fb) => state().stream_name === String(fb.options.name ?? ''),
    },
    stream_processing: {
      type: 'boolean',
      name: 'Encoder: processing (transition)',
      description: 'Active while the device is transitioning (commands should wait)',
      defaultStyle: { bgcolor: combineRgb(153, 102, 0), color: WHITE },
      options: [],
      callback: () => state().stream_processing === true,
    },
  }),
  buildPresets: () => ({
    section: {
      id: 'encoder',
      name: 'Encoder',
      description: 'Ready-to-use buttons for the encoder (StreamTransmit) stream.',
      definitions: ['enc_start_stream', 'enc_stop_stream', 'enc_set_stream_name', 'enc_set_multicast'],
    },
    presets: {
      enc_start_stream: {
        type: 'simple',
        name: 'Start stream',
        style: { text: 'Start\nStream', size: 'auto', color: WHITE, bgcolor: BLACK },
        steps: [{ down: [{ actionId: 'enable_stream', options: {} }], up: [] }],
        // turns green while the stream is started
        feedbacks: [{ feedbackId: 'stream_enabled', options: {}, style: { bgcolor: GREEN, color: WHITE } }],
      },
      enc_stop_stream: {
        type: 'simple',
        name: 'Stop stream',
        style: { text: 'Stop\nStream', size: 'auto', color: WHITE, bgcolor: DARKRED },
        steps: [{ down: [{ actionId: 'disable_stream', options: {} }], up: [] }],
        feedbacks: [],
      },
      enc_set_stream_name: {
        type: 'simple',
        name: 'Set stream name',
        style: { text: 'Set\nName', size: 'auto', color: WHITE, bgcolor: BLUE },
        steps: [{ down: [{ actionId: 'set_stream_name', options: { name: '' } }], up: [] }],
        feedbacks: [],
      },
      enc_set_multicast: {
        type: 'simple',
        name: 'Set multicast address',
        style: { text: 'Set\nMcast', size: 'auto', color: WHITE, bgcolor: BLUE },
        steps: [{ down: [{ actionId: 'set_multicast_address', options: { address: '239.1.1.1' } }], up: [] }],
        feedbacks: [],
      },
    },
  }),
}
