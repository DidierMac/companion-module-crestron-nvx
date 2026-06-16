/**
 * Scenario → device state mapping for the fake NVX server.
 * Pure functions — no side effects, no imports.
 *
 * RX scenarios:
 *   'idle'        → stream stopped, no codec, no resolution, no packets.
 *   'negotiating' → session started, resolution populated, but CodecReady:false (encrypted / not yet decoding).
 *   'decoding'    → full decode: CodecReady:true, 4K@30, packets > 0.
 *   (falsy)       → defaults to 'decoding' (non-regression: behaviour of the old hard-coded Start block).
 *   (unknown)     → throws (fail-fast, no silent fallback).
 *
 * TX scenarios:
 *   'stopped'   → Status:'Stream Stopped'.
 *   'streaming' → Status:'Stream started'.
 *   (unknown)   → throws.
 */

export type RxScenario = 'idle' | 'negotiating' | 'decoding'
export type TxScenario = 'stopped' | 'streaming'

export interface ReceiveState {
  Status: string
  CodecReady: boolean
  HorizontalResolution: number
  VerticalResolution: number
  FramesPerSecond: number
  NumVideoPacketsRcvd: number
}

export interface TransmitState {
  Status: string
}

/**
 * Returns the fields to write on StreamReceive Streams[0] for the given scenario.
 * Falsy name → 'decoding' (non-regression default).
 * Unknown non-empty name → throws.
 */
export function scenarioToReceiveState(name: string): ReceiveState {
  const scenario: RxScenario = name ? (name as RxScenario) : 'decoding'

  switch (scenario) {
    case 'idle':
      return {
        Status: 'Stream Stopped',
        CodecReady: false,
        HorizontalResolution: 0,
        VerticalResolution: 0,
        FramesPerSecond: 0,
        NumVideoPacketsRcvd: 0,
      }
    case 'negotiating':
      return {
        Status: 'Stream started',
        CodecReady: false,
        HorizontalResolution: 3840,
        VerticalResolution: 2160,
        FramesPerSecond: 30,
        NumVideoPacketsRcvd: 0,
      }
    case 'decoding':
      return {
        Status: 'Stream started',
        CodecReady: true,
        HorizontalResolution: 3840,
        VerticalResolution: 2160,
        FramesPerSecond: 30,
        NumVideoPacketsRcvd: 1,
      }
    default:
      throw new Error(`scenarioToReceiveState: unknown scenario '${name}'`)
  }
}

/**
 * Returns the fields to write on StreamTransmit Streams[0] for the given scenario.
 * Unknown name → throws.
 */
export function scenarioToTransmitState(name: string): TransmitState {
  switch (name as TxScenario) {
    case 'stopped':
      return { Status: 'Stream Stopped' }
    case 'streaming':
      return { Status: 'Stream started' }
    default:
      throw new Error(`scenarioToTransmitState: unknown scenario '${name}'`)
  }
}
