/**
 * subsystem.ts — runner générique SubsystemSpec (vague 2a Green)
 *
 * Fusionne les 3 factories (writeStep / writeStepRx / writeStepRxWithScenario)
 * et les 2 pollers (pollOracle / pollOracleRx) de steps-lab.ts en 5 builders
 * paramétrés par un SubsystemSpec déclaratif.
 *
 * Comportements verrouillés par subsystem.test.ts :
 *   buildWriteStep  — garde ordonnée : device → (scenario+!isFake) → role → bouton → pollExtract
 *   buildCapStep    — garde rôle (PASS si match, SKIP sinon)
 *   buildVarsStep   — ready sur 1ʳᵉ VarCheck, str() coercion, observed { var:{companion,device} }
 *   buildBaselineStep — oracle.snapshot(spec.endpoint), role-gardé
 *   buildTeardownStep — oracle.restore + disable conditionnel
 */

import { pass, fail, skip } from '../lib/verdict.js'
import type { Verdict } from '../lib/verdict.js'
import type { JourneyStep, JourneyContext } from './types.js'
import { HttpError } from '../tools/companion-http.js'

type Json = Record<string, unknown>

// ── Constantes partagées ───────────────────────────────────────────────────────

const POLL_ATTEMPTS = 15
const POLL_DELAY_MS = 1000

// ── Contrat d'interface (figé par l'architecte) ────────────────────────────────

/**
 * Un cas de WRITE : presse un bouton, vérifie l'effet sur le device via l'oracle.
 * `scenario` est optionnel — si présent, le step est fake-only (SKIP sur vrai device).
 */
export interface WriteCase {
  id: string
  title: string
  actionKey: string
  pred: (extracted: Json) => boolean
  expected: unknown
  scenario?: string
}

/**
 * Une vérification variable : compare la valeur Companion à la valeur device.
 * `ready` sur la 1ʳᵉ VarCheck seulement (gate de polling — attend le 1ᵉʳ poll module).
 * `device` doit retourner une string ; le runner applique str() pour coercition.
 */
export interface VarCheck {
  var: string
  device: (extracted: Json) => string
  ready?: (v: string) => boolean
}

/**
 * Spec d'un sous-système NVX : contrat unique qui remplace les 3 factories
 * (writeStep / writeStepRx / writeStepRxWithScenario) et les 2 pollers
 * (pollOracle / pollOracleRx) de steps-lab.ts.
 *
 * `extract` reçoit Device[lastSegment] brut (objet subsystem complet) et
 * retourne la portion à comparer (ex. Streams[0] pour TX/RX, audio pour v0.4).
 * `buildBodies` reçoit le snapshot subsystem et retourne les bodies à POSTer.
 */
export interface SubsystemSpec {
  id: string
  role: 'Transmitter' | 'Receiver'
  endpoint: string
  extract: (subsystem: Json) => Json
  buildBodies: (baseline: Json) => unknown[]
  writes: WriteCase[]
  vars: VarCheck[]
}

// ── Utilitaires privés ─────────────────────────────────────────────────────────

/** Coercition string — reproduit str() de steps-lab.ts. */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Résumé d'erreur */
const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Steps lab nécessitent un device ; sans NVX_PASS → SKIP (pas FAIL). */
function noDevice(ctx: JourneyContext): boolean {
  return !ctx.config.nvxPass
}

/**
 * Lit une variable Companion, en pollingant tant qu'elle n'est pas définie (HTTP 404)
 * ou que `ready` n'est pas satisfait. Toute autre erreur est relancée immédiatement.
 * Reproduit readVar() de steps-lab.ts.
 */
async function readVar(
  ctx: JourneyContext,
  name: string,
  ready: (v: string) => boolean = () => true,
): Promise<string> {
  let value = ''
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    try {
      value = await ctx.http.getVariable(ctx.config.label, name)
      if (ready(value)) return value
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err
    }
    await ctx.sleep(POLL_DELAY_MS)
  }
  return value
}

/**
 * Poll le device via oracle.read(endpoint) + spec.extract jusqu'à pred satisfait.
 * Remplace pollOracle() et pollOracleRx() — générique sur tout subsystem.
 * Borné à POLL_ATTEMPTS itérations pour éviter toute boucle infinie.
 */
async function pollExtract(
  ctx: JourneyContext,
  spec: SubsystemSpec,
  pred: (extracted: Json) => boolean,
): Promise<{ ok: boolean; extracted: Json | null }> {
  let extracted: Json | null = null
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    const subsystem = await ctx.oracle.read(spec.endpoint)
    extracted = spec.extract(subsystem)
    if (pred(extracted)) return { ok: true, extracted }
    await ctx.sleep(POLL_DELAY_MS)
  }
  return { ok: false, extracted }
}

// ── Builders exportés ──────────────────────────────────────────────────────────

/**
 * Crée un step WRITE générique à partir d'un spec et d'un cas.
 *
 * Ordre des gardes (verrouillé par subsystem.test.ts) :
 *   1. requireDevice    → SKIP si nvxPass absent
 *   2. scenario+!isFake → SKIP (fake-only AVANT role — critique pour les steps Rx/scénario)
 *   3. requireRole      → SKIP si device_role ≠ spec.role
 *   4. bouton non mappé → SKIP
 *   5. si scenario      → setRxScenario() AVANT press()
 *   6. press → pollExtract → PASS ou FAIL
 */
export function buildWriteStep(spec: SubsystemSpec, writeCase: WriteCase): JourneyStep {
  const { id, title, actionKey, scenario, pred, expected } = writeCase
  return {
    id,
    title,
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      // Garde 1 — device requis
      if (noDevice(ctx))
        return skip(id, `${title} (no device)`, 1, { note: 'NVX_PASS unset' })

      // Garde 2 — scenario fake-only (AVANT role : évite un readVar inutile)
      if (scenario && !ctx.config.isFake)
        return skip(id, `${title} (scenario fake-only)`, 1, {
          note: `scenario '${scenario}' requires fake device — SKIP on real NVX`,
        })

      // Garde 3 — rôle requis
      const role = await readVar(ctx, 'device_role')
      if (role !== spec.role)
        return skip(id, `${title} (device is not a ${spec.role})`, 1, { note: `device_role=${role}` })

      // Garde 4 — bouton mappé
      const loc = ctx.config.layout?.[actionKey]
      if (!loc)
        return skip(id, `${title} (button unmapped)`, 1, {
          note: `button '${actionKey}' not in layout — see SETUP`,
        })

      // Garde 5 — scénario positionné AVANT la pression du bouton
      if (scenario) await ctx.oracle.setRxScenario(scenario)

      // Étape 6 — pression + poll
      await ctx.http.press(loc.page, loc.row, loc.col)
      const r = await pollExtract(ctx, spec, pred)
      return r.ok
        ? pass(id, title, 1, { deviceJson: r.extracted, note: 'device changed as expected' })
        : fail(id, title, 1, { expected, observed: r.extracted })
    },
  }
}

/**
 * Crée un step CAP générique (vérifie le rôle du device, PASS ou SKIP).
 * Reproduit la logique des inline CAP / DEC-CAP de steps-lab.ts.
 */
export function buildCapStep(
  spec: SubsystemSpec,
  meta: { id: string; title: string },
): JourneyStep {
  const { id, title } = meta
  return {
    id,
    title,
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip(id, `${title} (no device)`, 1, { note: 'NVX_PASS unset' })
      const role = await readVar(ctx, 'device_role', (v) => v === spec.role)
      return role === spec.role
        ? pass(id, title, 1, { note: `device_role=${role}` })
        : skip(id, `${title} (device is not a ${spec.role})`, 1, { note: `device_role=${role}` })
    },
  }
}

/**
 * Crée un step VARS générique (compare variables Companion vs device via oracle).
 *
 * Points critiques (verrouillés par subsystem.test.ts) :
 *   (a) `ready` de chaque VarCheck utilisé si présent (polling gate individuel)
 *   (b) str() appliqué au résultat de device() — coercition non-string → ''
 *   (c) observed = { [var]: { companion, device } } pour les mismatches seulement
 *       note = "N/N match" (N = spec.vars.length)
 */
export function buildVarsStep(
  spec: SubsystemSpec,
  meta: { id: string; title: string },
): JourneyStep {
  const { id, title } = meta
  return {
    id,
    title,
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip(id, `${title} (no device)`, 1, { note: 'NVX_PASS unset' })
      const role = await readVar(ctx, 'device_role')
      if (role !== spec.role)
        return skip(id, `${title} (device is not a ${spec.role})`, 1, { note: `device_role=${role}` })

      // Lecture oracle unique — le subsystem est capturé une seule fois pour toutes les VarChecks.
      const subsystem = await ctx.oracle.read(spec.endpoint)
      const extracted = spec.extract(subsystem)

      const mismatches: Record<string, { companion: string; device: string }> = {}
      const total = spec.vars.length

      for (const vc of spec.vars) {
        // Utilise ready si présent (polling), sinon immédiat (() => true par défaut dans readVar).
        const companion = await readVar(ctx, vc.var, vc.ready)
        // str() coercition : device() peut retourner number ou autre → force ''
        const device = str(vc.device(extracted))
        if (companion !== device) {
          mismatches[vc.var] = { companion, device }
        }
      }

      return Object.keys(mismatches).length === 0
        ? pass(id, title, 1, { note: `${total}/${total} match` })
        : fail(id, title, 1, { observed: mismatches })
    },
  }
}

/**
 * Crée un step BASELINE générique (oracle.snapshot, role-gardé).
 *
 * ⚠️ Asymétrie de note SKIP : paramètre `skipNote` pour préserver les wordings
 * actuels des steps BASELINE (Tx, ajoute "— StreamTransmit absent on Receiver")
 * et BASELINE-RX (Rx, pas de suffixe). Omis → note = "device_role=${role}".
 */
export function buildBaselineStep(
  spec: SubsystemSpec,
  meta: { id: string; title: string; skipNote?: string },
): JourneyStep {
  const { id, title } = meta
  return {
    id,
    title,
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip(id, `${title} (no device)`, 1, { note: 'NVX_PASS unset' })
      const role = await readVar(ctx, 'device_role')
      if (role !== spec.role) {
        const noteSkip = meta.skipNote
          ? `device_role=${role} ${meta.skipNote}`
          : `device_role=${role}`
        return skip(id, `${title} (device is not a ${spec.role})`, 1, { note: noteSkip })
      }
      try {
        await ctx.oracle.snapshot(spec.endpoint)
        return pass(id, title, 1, { note: 'stored for TEARDOWN restore' })
      } catch (err) {
        return fail(id, title, 1, { note: msg(err) })
      }
    },
  }
}

/**
 * Crée un step TEARDOWN générique (oracle.restore + disable conditionnel).
 *
 * Wordings paramétrables pour préserver les notes exactes des steps legacy :
 *   - TEARDOWN (Tx) : skippedNote='no baseline…', restoredNote='device restored', failNote='restore failed'
 *   - TEARDOWN-RX (Rx) : skippedNote='no baselineRx…', restoredNote='StreamReceive baseline re-applied',
 *                        failNote='decoder restore failed'
 *
 * Défauts génériques : ne contiennent PAS le mot "restored" (cf. test subsystem.test.ts §8).
 */
export function buildTeardownStep(
  spec: SubsystemSpec,
  meta: {
    id: string
    title: string
    disableConnection?: boolean
    restoredNote?: string
    skippedNote?: string
    failNote?: string
  },
): JourneyStep {
  const { id, title, disableConnection = false } = meta
  const restoredNote = meta.restoredNote ?? 'baseline re-applied'
  const skippedNote = meta.skippedNote ?? 'no baseline (SKIP capture) — not applied'
  const failNote = meta.failNote ?? 'restore failed'

  return {
    id,
    title,
    scope: 'lab',
    run: async (ctx): Promise<Verdict> => {
      if (noDevice(ctx)) return skip(id, `${title} (no device)`, 1, { note: 'NVX_PASS unset' })

      const notes: string[] = []
      let ok = true

      // Restauration via oracle.restore générique
      try {
        const r = await ctx.oracle.restore(spec.endpoint, spec.buildBodies)
        notes.push(r.skipped ? skippedNote : restoredNote)
      } catch (err) {
        ok = false
        notes.push(`${failNote}: ${msg(err)}`)
      }

      // Désactivation conditionnelle de la connexion Companion (TEARDOWN Tx seulement)
      if (disableConnection) {
        const connId = await ctx.http.findConnectionId(ctx.config.label)
        if (connId) {
          try {
            await ctx.http.disable(connId)
            notes.push('connection disabled')
          } catch (err) {
            ok = false
            notes.push(`disable failed: ${msg(err)}`)
          }
        }
      }

      return ok
        ? pass(id, `${title} complete`, 1, { note: notes.join('; ') })
        : fail(id, `${title} incomplete`, 1, { note: notes.join('; ') })
    },
  }
}
