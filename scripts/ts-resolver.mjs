/**
 * ESM loader hook: resolves `.js` imports to `.ts` source files.
 * Used by `node --test` so test files can import with `.js` extension
 * (TypeScript/ESM convention) while running directly from source.
 */
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.js')) {
    const base = context.parentURL ?? 'file://'
    const resolved = new URL(specifier, base)
    const tsPath = fileURLToPath(resolved).replace(/\.js$/, '.ts')
    if (existsSync(tsPath)) {
      return { url: resolved.href.replace(/\.js$/, '.ts'), shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}
