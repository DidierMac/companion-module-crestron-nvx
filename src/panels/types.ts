import type {
  CompanionVariableDefinitions,
  CompanionVariableValues,
  CompanionActionDefinitions,
  CompanionFeedbackDefinitions,
  CompanionPresetDefinitions,
  CompanionPresetSection,
} from '@companion-module/base'
import type { Capability, DeviceRole } from '../capability.js'
import type { NvxApiClient } from '../api.js'

export interface PanelContext {
  caps: Capability
  role: DeviceRole | null
}

/** Press-time accessors handed to a panel's actions (latest polled data). */
export interface PanelActionHelpers {
  /** Latest polled variable values (flat) — e.g. for a `Processing` guard. */
  state(): CompanionVariableValues
  /** Latest raw JSON of this panel's auxiliary endpoints, keyed by endpoint path. */
  aux(): Record<string, unknown>
}

/** A panel = one NVX subsystem with its activation rule, parser, and SDK builders. */
export interface Panel {
  id: string
  /** Primary GET endpoint polled each cycle while the panel is active (drives identity). */
  endpoint: string
  /** Additional GET endpoints polled alongside the primary (e.g. discovery). */
  auxEndpoints?: string[]
  /** Activation predicate (see spec §3.2). */
  gate(ctx: PanelContext): boolean
  /** Variable definitions this panel owns. */
  variableDefinitions: CompanionVariableDefinitions
  /**
   * Pure: map polled JSON to variable values. Sentinel-safe.
   * @param primary JSON of `endpoint`. @param aux map keyed by auxEndpoint path.
   */
  readVariables(primary: unknown, aux?: Record<string, unknown>): CompanionVariableValues
  /** SDK action definitions (write path). `helpers` gives press-time state/aux access. */
  buildActions(api: NvxApiClient, helpers?: PanelActionHelpers): CompanionActionDefinitions
  /** SDK feedback definitions; `state()` returns the latest polled variable values. */
  buildFeedbacks(state: () => CompanionVariableValues): CompanionFeedbackDefinitions
  /** Optional ready-to-use presets this panel ships: a UI section + its preset definitions. */
  buildPresets?(): { section: CompanionPresetSection; presets: CompanionPresetDefinitions }
}
