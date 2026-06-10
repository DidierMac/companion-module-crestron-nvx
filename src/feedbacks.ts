import { combineRgb } from '@companion-module/base'
import type { InstanceBase } from '@companion-module/base'

// v2 SDK: `subscribe` callback removed — only `unsubscribe` remains
export function setFeedbackDefinitions(self: InstanceBase, isConnected: () => boolean): void {
	self.setFeedbackDefinitions({
		connected: {
			type: 'boolean',
			name: 'Device connected',
			description: 'Active when the module has a working connection to the NVX device',
			defaultStyle: {
				bgcolor: combineRgb(0, 170, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => isConnected(),
		},
	})
}
