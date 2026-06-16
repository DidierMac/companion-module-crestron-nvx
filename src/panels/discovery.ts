import { subsystemObject } from '../capability.js'

export interface DiscoveredStream {
  uniqueId: string
  sessionName: string
  rtspUri: string
  multicastAddress: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Normalize `Device.DiscoveredStreams.Streams` (a UUID-keyed dict) into a sorted array. Sentinel-safe. */
export function discoveredList(json: unknown): DiscoveredStream[] {
  const ds = subsystemObject(json, 'DiscoveredStreams')
  const streams = ds?.Streams
  if (typeof streams !== 'object' || streams === null) return []
  const out: DiscoveredStream[] = []
  for (const entry of Object.values(streams as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    out.push({
      uniqueId: str(e.UniqueId),
      sessionName: str(e.SessionName),
      rtspUri: str(e.RtspUri),
      multicastAddress: str(e.MulticastAddress),
    })
  }
  return out.sort((a, b) => a.sessionName.localeCompare(b.sessionName))
}

export type ResolvedSource =
  | { SessionInitiation: 'Multicast via RTSP'; MulticastAddress: string }
  | { SessionInitiation: 'ByReceiver'; StreamLocation: string }

/** Build the SetPartial coordinate for a discovered entry: multicast preferred, URL fallback. */
function coordinatesFor(s: DiscoveredStream): ResolvedSource | null {
  if (s.multicastAddress) return { SessionInitiation: 'Multicast via RTSP', MulticastAddress: s.multicastAddress }
  if (s.rtspUri) return { SessionInitiation: 'ByReceiver', StreamLocation: s.rtspUri }
  return null
}

/** Interpret a free-text value (already variable-resolved) as URL or multicast. */
function coordinatesForRaw(value: string): ResolvedSource | null {
  const v = value.trim()
  if (!v) return null
  if (v.toLowerCase().startsWith('rtsp://')) return { SessionInitiation: 'ByReceiver', StreamLocation: v }
  // bare IPv4 multicast (224.0.0.0 – 239.255.255.255)
  if (/^(22[4-9]|23\d)\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) return { SessionInitiation: 'Multicast via RTSP', MulticastAddress: v }
  // otherwise treat as a URL location (best effort)
  return { SessionInitiation: 'ByReceiver', StreamLocation: v }
}

/**
 * Resolve a connect_to_stream selection into a routing coordinate.
 * @param selection dropdown id (a discovered UniqueId) or the literal 'custom'.
 * @param customValue free-text (already variable-resolved) used when selection==='custom'.
 * @param list latest discovered streams.
 */
export function resolveSource(selection: string, customValue: string, list: DiscoveredStream[]): ResolvedSource | null {
  if (selection === 'custom') {
    const byName = list.find((s) => s.sessionName === customValue.trim())
    if (byName) return coordinatesFor(byName)
    return coordinatesForRaw(customValue)
  }
  const byId = list.find((s) => s.uniqueId === selection)
  return byId ? coordinatesFor(byId) : null
}
