import js from '@eslint/js'
import globals from 'globals'

// TypeScript parsing requires @typescript-eslint/parser (not installed).
// We lint the compiled JS output instead — catches no-console violations on the final artefact.
// To add full TS linting in v0.2: npm add -D typescript-eslint
export default [
	js.configs.recommended,
	{
		files: ['dist/**/*.js'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'no-console': 'error',
			'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
		},
	},
	{
		ignores: ['node_modules/**', 'dist/**/*.d.ts'],
	},
]
