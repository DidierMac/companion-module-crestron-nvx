/**
 * streams-body.ts — builder de corps CresNext pour les subsystems Streams.
 *
 * Relocalisé depuis scripts/uat/tools/oracle.ts (vague 2a) pour permettre
 * aux specs encoder.ts / decoder.ts de l'importer directement, sans dépendre
 * de l'oracle. Importé par oracle.ts à la place de sa définition locale.
 *
 * NE PAS importer depuis src/panels — ce fichier est la source unique en UAT.
 */

/**
 * Construit `{ Device: { [subsystem]: { Streams: [{…}, …, props, …] } } }`
 * en plaçant `props` à la position `index` (les autres slots = `{}`).
 * L'oracle utilise toujours index 0 ; paramètre conservé pour alignement
 * avec les specs encoder/decoder qui pourront en avoir besoin.
 */
export function streamsSetBody(
  subsystem: 'StreamTransmit' | 'StreamReceive',
  index: number,
  props: Record<string, unknown>,
): unknown {
  const streams = Array.from({ length: index + 1 }, (_, i) => (i === index ? props : {}))
  return { Device: { [subsystem]: { Streams: streams } } }
}
