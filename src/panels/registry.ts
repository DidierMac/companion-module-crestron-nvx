import type { CompanionVariableDefinitions } from '@companion-module/base'
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
