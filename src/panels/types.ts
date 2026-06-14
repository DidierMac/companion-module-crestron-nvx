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

/** A panel = one NVX subsystem with its activation rule, parser, and SDK builders. */
export interface Panel {
  id: string
  /** GET endpoint polled each cycle while the panel is active. */
  endpoint: string
  /** Activation predicate (see spec §3.2). */
  gate(ctx: PanelContext): boolean
  /** Variable definitions this panel owns. */
  variableDefinitions: CompanionVariableDefinitions
  /** Pure: map the polled subsystem JSON to variable values. Sentinel-safe. */
  readVariables(json: unknown): CompanionVariableValues
  /** SDK action definitions (write path). */
  buildActions(api: NvxApiClient): CompanionActionDefinitions
  /** SDK feedback definitions; `state()` returns the latest polled variable values. */
  buildFeedbacks(state: () => CompanionVariableValues): CompanionFeedbackDefinitions
  /** Optional ready-to-use presets this panel ships: a UI section + its preset definitions. */
  buildPresets?(): { section: CompanionPresetSection; presets: CompanionPresetDefinitions }
}
