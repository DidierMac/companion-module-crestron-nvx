import type {
  CompanionVariableDefinitions,
  CompanionPresetDefinitions,
  CompanionPresetSection,
} from '@companion-module/base'
import type { Panel, PanelContext } from './types.js'

export function activePanels(panels: Panel[], ctx: PanelContext): Panel[] {
  return panels.filter((p) => p.gate(ctx))
}

export function composeVariableDefinitions(panels: Panel[]): CompanionVariableDefinitions {
  return panels.reduce<CompanionVariableDefinitions>(
    (acc, p) => ({ ...acc, ...p.variableDefinitions }),
    {},
  )
}

/** Collect the preset sections + definitions shipped by each panel that defines any. */
export function composePresets(panels: Panel[]): {
  structure: CompanionPresetSection[]
  presets: CompanionPresetDefinitions
} {
  const structure: CompanionPresetSection[] = []
  let presets: CompanionPresetDefinitions = {}
  for (const p of panels) {
    const built = p.buildPresets?.()
    if (!built) continue
    structure.push(built.section)
    presets = { ...presets, ...built.presets }
  }
  return { structure, presets }
}
