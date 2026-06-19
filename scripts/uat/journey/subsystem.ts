/**
 * subsystem.ts — contrat générique SubsystemSpec (stub TDD vague 2a)
 *
 * Ce fichier est un squelette de contrat : les types sont figés par l'architecte,
 * les fonctions lèvent "not implemented" pour permettre la phase Red TDD.
 * Le coder remplace les throws par la vraie logique.
 *
 * Contrat verrouillé par subsystem.test.ts :
 *   buildWriteStep  — garde ordonnée + setRxScenario-avant-press + pollExtract générique
 *   buildCapStep    — garde rôle
 *   buildVarsStep   — ready sur 1ʳᵉ VarCheck, str() coercion, observed format
 *   buildBaselineStep — oracle.snapshot(spec.endpoint)
 *   buildTeardownStep — oracle.restore + disable conditionnel
 */

import type { JourneyStep } from './types.js'

type Json = Record<string, unknown>

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

// ── Stubs (remplacés par le coder) ────────────────────────────────────────────

/** Crée un step WRITE générique à partir d'un spec et d'un cas.
 *  Garde ordonnée : requireDevice → (scenario+!isFake) → requireRole → bouton → pollExtract. */
export function buildWriteStep(_spec: SubsystemSpec, _writeCase: WriteCase): JourneyStep {
  throw new Error('not implemented — stub vague 2a')
}

/** Crée un step CAP générique (vérifie le rôle du device, PASS ou SKIP). */
export function buildCapStep(_spec: SubsystemSpec, _meta: { id: string; title: string }): JourneyStep {
  throw new Error('not implemented — stub vague 2a')
}

/** Crée un step VARS générique (compare variables Companion vs device via oracle). */
export function buildVarsStep(_spec: SubsystemSpec, _meta: { id: string; title: string }): JourneyStep {
  throw new Error('not implemented — stub vague 2a')
}

/** Crée un step BASELINE générique (oracle.snapshot, role-guardé). */
export function buildBaselineStep(_spec: SubsystemSpec, _meta: { id: string; title: string }): JourneyStep {
  throw new Error('not implemented — stub vague 2a')
}

/** Crée un step TEARDOWN générique (oracle.restore + disable conditionnel). */
export function buildTeardownStep(
  _spec: SubsystemSpec,
  _meta: { id: string; title: string; disableConnection?: boolean },
): JourneyStep {
  throw new Error('not implemented — stub vague 2a')
}
