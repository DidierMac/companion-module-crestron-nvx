export type DeviceRole = 'Transmitter' | 'Receiver'

export interface Capability {
  canEncode: boolean
  canDecode: boolean
  canSwitchMode: boolean
}

/**
 * Sentinel-safe extractor for `Device.<subsystem>`.
 * Returns the object, or null if the subsystem is absent OR is the
 * string sentinel `"UNSUPPORTED PROPERTY, CHECK REST API!!!"` (model-dependent).
 */
export function subsystemObject(json: unknown, subsystem: string): Record<string, unknown> | null {
  if (typeof json !== 'object' || json === null) return null
  const device = (json as Record<string, unknown>).Device
  if (typeof device !== 'object' || device === null) return null
  const sub = (device as Record<string, unknown>)[subsystem]
  if (typeof sub !== 'object' || sub === null || Array.isArray(sub)) return null
  return sub as Record<string, unknown>
}

export function detectCapability(deviceCapabilitiesJson: unknown): Capability {
  const dc = subsystemObject(deviceCapabilitiesJson, 'DeviceCapabilities')
  const pc = dc && typeof dc.PortConfig === 'object' && dc.PortConfig !== null
    ? (dc.PortConfig as Record<string, unknown>)
    : null
  const inputs = pc ? Number(pc.NumberOfHdmiInputs ?? 0) : 0
  const outputs = pc ? Number(pc.NumberOfHdmiOutputs ?? 0) : 0
  const canEncode = inputs >= 1
  const canDecode = outputs >= 1
  return { canEncode, canDecode, canSwitchMode: canEncode && canDecode }
}

export function parseDeviceMode(deviceSpecificJson: unknown): DeviceRole | null {
  const ds = subsystemObject(deviceSpecificJson, 'DeviceSpecific')
  const mode = ds?.DeviceMode
  return mode === 'Transmitter' || mode === 'Receiver' ? mode : null
}
