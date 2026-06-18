# UAT Evolution — Phase 1 (Hygiène) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supprimer la complexité accidentelle « morte » de l'outillage UAT (fossile `tiers/`, champ de config inutilisé, affichage parasite) et réduire la friction de lancement, sans toucher la mécanique de verdict.

**Architecture :** 4 tâches indépendantes et offline. (1) reloger `makeClient` hors du dossier-fossile `tiers/` et supprimer la fonction morte `hasDevice` ; (2) retirer le champ mort `HarnessConfig.tiers` ; (3) rendre le rapport lisible (retirer `(tier N)`, capper `observed`, sortir l'évidence complète dans `details.json`) ; (4) profils de lancement nommés (`UAT_PROFILE`) pour remplacer la matrice de 6-7 variables d'env composées à la main. Aucun créneau labo requis — toute la non-régression passe par le filet de tests existant (`npm test`).

**Tech Stack :** TypeScript strict (ESM, extensions `.js` à l'import), tests `node:test` + `node:assert/strict`, runner via `npm test` (loader `scripts/ts-resolver.mjs`).

## Global Constraints

- **Zéro installation** : aucune dépendance ajoutée/modifiée. La Tâche 4 édite la section `scripts` de `package.json` (≠ dépendance) — vérifier `git diff package.json` ne touche pas `dependencies`/`devDependencies`.
- **ESM** : tous les imports internes portent l'extension `.js` même pour des sources `.ts` (convention du repo, cf. `import { ... } from './verdict.js'`).
- **Tests** : commande unique `npm test` (lance `tsc --noEmit` en `pretest` puis `node --test` sur `src/**` + `scripts/uat/**`). Un test isolé : `node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs --test <fichier.ts>`.
- **Branche** : `refactor/uat-evolution` (déjà créée depuis `feature/v0.4-audio`). Ne pas merger sans validation Didier.
- **Hors périmètre Phase 1** : la suppression du *type* `Tier` et du *paramètre* `tier` des factories de verdict (`pass/fail/skip(id, title, tier, …)`) est volontairement reportée à la Phase 3 (refonte), où les factories sont de toute façon retouchées. Phase 1 ne retire que l'**affichage** du tier et le **champ de config** mort.

---

### Task 1: Reloger `makeClient` hors de `tiers/`, supprimer `hasDevice` mort

Le dossier `scripts/uat/tiers/` est un vestige de l'ancienne architecture « 3 tiers » abandonnée par le redesign « par parcours » (cf. `docs/superpowers/specs/2026-06-14-uat-harness-design.md`). Il ne survit que pour exporter `makeClient` (fabrique du client oracle, réellement utilisée) ; `hasDevice` n'est importé nulle part hors de son propre test.

**Files:**
- Create: `scripts/uat/tools/nvx-client.ts`
- Create: `scripts/uat/tools/nvx-client.test.ts`
- Modify: `scripts/uat/journey/run-journey.ts:11` (import)
- Delete: `scripts/uat/tiers/tier0-logic.ts`
- Delete: `scripts/uat/tiers/tier0-logic.test.ts`

**Interfaces:**
- Consumes: `HarnessConfig` depuis `../lib/case.js` ; `NvxApiClient`, `ModuleLogger`, `ModuleConfig`, `ModuleSecrets` depuis `src/`.
- Produces: `makeClient(config: HarnessConfig, opts?: { password?: string }): NvxApiClient` — consommé par `run-journey.ts` (`new Oracle(() => makeClient(harness))`).

- [ ] **Step 1: Créer le nouveau module avec `makeClient` (sans `hasDevice`)**

Create `scripts/uat/tools/nvx-client.ts` :

```ts
import { NvxApiClient } from '../../../src/api.js'
import { ModuleLogger } from '../../../src/logger.js'
import type { ModuleConfig, ModuleSecrets } from '../../../src/config.js'
import type { HarnessConfig } from '../lib/case.js'

/** Build an NvxApiClient from harness config. Mirrors scripts/capture-nvx.ts wiring. */
export function makeClient(config: HarnessConfig, opts: { password?: string } = {}): NvxApiClient {
  const moduleConfig: ModuleConfig = {
    host: config.nvxHost,
    port: config.nvxPort,
    username: config.nvxUser,
    pollInterval: 2000,
    ignoreSelfSignedCert: true,
    verbose: false,
  }
  const secrets: ModuleSecrets = { password: opts.password ?? config.nvxPass }

  // Silent logger — no output during UAT unit tests; mirrors capture-nvx.ts pattern.
  const rootLogger = new ModuleLogger(() => {}, '[UAT]', false)
  const authLogger = rootLogger.child('[AUTH]')
  const httpLogger = rootLogger.child('[HTTP]')

  return new NvxApiClient(moduleConfig, secrets, authLogger, httpLogger)
}
```

- [ ] **Step 2: Déplacer le test de `makeClient` (sans le test de `hasDevice`)**

Create `scripts/uat/tools/nvx-client.test.ts` :

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeClient } from './nvx-client.js'
import type { HarnessConfig } from '../lib/case.js'

const cfg = (over: Partial<HarnessConfig> = {}): HarnessConfig => ({
  nvxHost: '192.168.1.50', nvxPort: 443, nvxUser: 'admin', nvxPass: '',
  companionUrl: 'http://localhost:8000', tiers: [0], ...over,
})

test('makeClient builds an NvxApiClient from harness config', () => {
  const client = makeClient(cfg({ nvxPass: 'secret' }))
  assert.ok(client)
  assert.equal(typeof client.login, 'function')
})
```

> Note : le helper `cfg` conserve `tiers: [0]` ici pour compiler contre le `HarnessConfig` **actuel** ; la Tâche 2 retire ce champ ET cette ligne.

- [ ] **Step 3: Lancer le nouveau test — doit passer**

Run: `node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs --test scripts/uat/tools/nvx-client.test.ts`
Expected: PASS (1 test).

- [ ] **Step 4: Mettre à jour l'import dans `run-journey.ts`**

Modify `scripts/uat/journey/run-journey.ts:11`, remplacer :

```ts
import { makeClient } from '../tiers/tier0-logic.js'
```

par :

```ts
import { makeClient } from '../tools/nvx-client.js'
```

- [ ] **Step 5: Supprimer le dossier-fossile `tiers/`**

```bash
git rm scripts/uat/tiers/tier0-logic.ts scripts/uat/tiers/tier0-logic.test.ts
```

- [ ] **Step 6: Suite complète + typecheck — tout vert**

Run: `npm test`
Expected: PASS, aucun fichier ne référence plus `tiers/tier0-logic` ni `hasDevice`. (Le compte de tests baisse de 2 : les deux tests `hasDevice` supprimés.)

- [ ] **Step 7: Commit**

```bash
git add scripts/uat/tools/nvx-client.ts scripts/uat/tools/nvx-client.test.ts scripts/uat/journey/run-journey.ts
git commit -m "refactor(uat): reloge makeClient dans tools/nvx-client, supprime le fossile tiers/ et hasDevice mort"
```

---

### Task 2: Supprimer le champ mort `HarnessConfig.tiers`

Le champ `tiers: Tier[]` de `HarnessConfig` est annoté « legacy » : il est **écrit** (`buildContext` met `tiers: [0]`) mais **jamais lu**. Le parcours sélectionne par `step.scope`, pas par tiers.

**Files:**
- Modify: `scripts/uat/lib/case.ts:1,10`
- Modify: `scripts/uat/journey/run-journey.ts:74`
- Modify: `scripts/uat/tools/nvx-client.test.ts` (helper `cfg`, créé en Tâche 1)

**Interfaces:**
- Produces: `HarnessConfig` sans le champ `tiers`. Consommé par `nvx-client.ts` (`makeClient`) et `run-journey.ts` (`buildContext`).

- [ ] **Step 1: Retirer `tiers` du helper de test (le test devient la spec)**

Modify `scripts/uat/tools/nvx-client.test.ts`, helper `cfg` — retirer `tiers: [0]` :

```ts
const cfg = (over: Partial<HarnessConfig> = {}): HarnessConfig => ({
  nvxHost: '192.168.1.50', nvxPort: 443, nvxUser: 'admin', nvxPass: '',
  companionUrl: 'http://localhost:8000', ...over,
})
```

- [ ] **Step 2: Lancer le typecheck — doit ÉCHOUER**

> Le runner de test isolé (`node --test`) utilise `--experimental-transform-types` qui **strippe** les types sans les vérifier : le rouge n'y apparaîtrait pas. La phase rouge passe donc par `tsc`.

Run: `npm run typecheck`
Expected: FAIL — TS2741 : la propriété `tiers` manque dans l'objet retourné par `cfg`, alors qu'elle est requise par `HarnessConfig`. (Rouge attendu : prouve que le champ est bien encore requis.)

- [ ] **Step 3: Retirer le champ de `HarnessConfig` et l'import `Tier` devenu inutile**

Modify `scripts/uat/lib/case.ts`. Ligne 1, retirer `Tier` de l'import (il n'est plus utilisé dans ce fichier) :

```ts
import type { Verdict } from './verdict.js'
```

Retirer la ligne 10 (`tiers: Tier[] // legacy field…`) du bloc `HarnessConfig`. Le résultat :

```ts
export interface HarnessConfig {
  nvxHost: string
  nvxPort: number
  nvxUser: string
  nvxPass: string // from NVX_PASS env; never logged in full
  companionUrl: string
  companionApiKey?: string
}
```

> `Tier` reste exporté par `verdict.ts` (toujours utilisé par les factories) — on ne touche pas à `verdict.ts` en Phase 1.

- [ ] **Step 4: Retirer `tiers: [0]` de `buildContext`**

Modify `scripts/uat/journey/run-journey.ts:74`. Le bloc `buildContext` construit `harness` ; retirer la ligne `tiers: [0],` :

```ts
  const harness: HarnessConfig = {
    nvxHost: cfg.oracleHost ?? cfg.nvxHost, // oracle (host process) may reach the device differently
    nvxPort: cfg.nvxPort,
    nvxUser: cfg.nvxUser,
    nvxPass: cfg.nvxPass,
    companionUrl: cfg.companionUrl,
  }
```

- [ ] **Step 5: Suite complète + typecheck — tout vert**

Run: `npm test`
Expected: PASS. Plus aucune référence à `.tiers` dans `scripts/uat/`.

- [ ] **Step 6: Commit**

```bash
git add scripts/uat/lib/case.ts scripts/uat/journey/run-journey.ts scripts/uat/tools/nvx-client.test.ts
git commit -m "refactor(uat): supprime le champ mort HarnessConfig.tiers"
```

---

### Task 3: Reporting compact — retirer `(tier N)`, capper `observed`, sortir `details.json`

Le rapport `report.md` (lu par l'opérateur) affiche `(tier 1)` sur chaque ligne (bruit sans information) et déverse l'objet device entier via `JSON.stringify(ev.observed)` — sur un run réel, l'objet `StreamTransmit` complet (~40 champs) apparaît plusieurs fois, nuisant à la lisibilité et élargissant la surface de fuite. On retire l'affichage du tier, on cappe `observed` dans le `.md`, et on écrit l'évidence complète (redactée) dans un artefact séparé `details.json`.

**Files:**
- Modify: `scripts/uat/lib/report.ts`
- Modify: `scripts/uat/lib/report.test.ts`

**Interfaces:**
- Consumes: `RunResult`, `Verdict`, `VerdictStatus`, `Evidence` depuis `./verdict.js` / `./case.js`.
- Produces: `renderDetails(run: RunResult): DetailRecord[]` (export nouveau) ; `writeRun` écrit désormais aussi `details.json`. `renderMarkdown` n'affiche plus le tier et tronque `observed`.

- [ ] **Step 1: Écrire les tests de la nouvelle forme de rapport**

Modify `scripts/uat/lib/report.test.ts`. Ajouter en tête l'import `renderDetails` :

```ts
import { renderMarkdown, renderEscalation, renderDetails, resolveRunDir } from './report.js'
```

Ajouter ces tests (après les tests existants `renderMarkdown`/`renderEscalation`) :

```ts
test('renderMarkdown ne mentionne plus le tier', () => {
  const md = renderMarkdown(run)
  assert.doesNotMatch(md, /tier/i)
})

test('renderMarkdown tronque un observed volumineux et renvoie vers details.json', () => {
  const big = { blob: 'x'.repeat(500) }
  const r: RunResult = {
    startedAt: '2026-06-18T10:00:00.000Z', version: 'v0.4',
    verdicts: [fail('B1', 'big observed', 1, { observed: big })],
  }
  const md = renderMarkdown(r)
  assert.match(md, /truncated — full evidence in details\.json/)
  assert.ok(md.length < JSON.stringify(big).length + 400) // pas de dump intégral
})

test('renderDetails renvoie chaque verdict avec son évidence redactée', () => {
  const r: RunResult = {
    startedAt: '2026-06-18T10:00:00.000Z', version: 'v0.4',
    verdicts: [pass('P1', 'ok', 1, { observed: { sessionid: 'leak-me', value: 42 } })],
  }
  const details = renderDetails(r)
  assert.equal(details.length, 1)
  assert.equal(details[0].id, 'P1')
  assert.equal((details[0].evidence.observed as Record<string, unknown>).sessionid, '***')
  assert.equal((details[0].evidence.observed as Record<string, unknown>).value, 42)
})
```

- [ ] **Step 2: Lancer les tests — doivent ÉCHOUER**

Run: `node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs --test scripts/uat/lib/report.test.ts`
Expected: FAIL — `renderDetails` n'existe pas encore ; `renderMarkdown` affiche `tier` et dump l'observed.

- [ ] **Step 3: Implémenter la troncature, retirer le tier, ajouter `renderDetails`**

Modify `scripts/uat/lib/report.ts`.

(a) Ligne 3 : ajouter `Evidence` à l'import de types :

```ts
import type { Verdict, VerdictStatus, Evidence } from './verdict.js'
```

(b) Après la fonction `redact` (autour de la ligne 26), ajouter la constante + le helper de troncature :

```ts
const MAX_OBSERVED = 200

/** JSON compact, tronqué au-delà de MAX_OBSERVED — l'évidence complète vit dans details.json. */
function compactJson(value: unknown): string {
  const s = JSON.stringify(value)
  return s.length > MAX_OBSERVED
    ? `${s.slice(0, MAX_OBSERVED)}… (truncated — full evidence in details.json)`
    : s
}
```

(c) Dans `renderMarkdown`, ligne 55, retirer `(tier ${v.tier})` :

```ts
    lines.push(`### ${ICON[v.status]} ${v.id} · ${v.title}`)
```

(d) Ligne 57, utiliser `compactJson` pour `observed` (laisser `expected` inchangé, il est petit) :

```ts
    if (ev.observed !== undefined) lines.push(`- observed: \`${compactJson(ev.observed)}\``)
```

(e) Après `renderEscalation` (autour de la ligne 78), ajouter l'export `renderDetails` :

```ts
export interface DetailRecord {
  id: string
  status: VerdictStatus
  evidence: Evidence
}

/** Évidence complète (redactée) de TOUS les verdicts — l'artefact détaillé que le .md résume. */
export function renderDetails(run: RunResult): DetailRecord[] {
  return run.verdicts.map((v) => ({
    id: v.id,
    status: v.status,
    evidence: redact(v.evidence) as Evidence,
  }))
}
```

- [ ] **Step 4: Écrire `details.json` dans `writeRun`**

Modify `scripts/uat/lib/report.ts`, fonction `writeRun` (lignes 99-103), ajouter l'écriture de `details.json` :

```ts
export function writeRun(dir: string, run: RunResult): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'report.md'), renderMarkdown(run), 'utf8')
  writeFileSync(path.join(dir, 'escalation.json'), JSON.stringify(renderEscalation(run), null, 2), 'utf8')
  writeFileSync(path.join(dir, 'details.json'), JSON.stringify(renderDetails(run), null, 2), 'utf8')
}
```

- [ ] **Step 5: Suite complète — tout vert**

Run: `npm test`
Expected: PASS (les tests existants `renderMarkdown`/`renderEscalation`/`resolveRunDir` restent verts ; ils n'asseraient pas la présence de `tier`).

- [ ] **Step 6: Commit**

```bash
git add scripts/uat/lib/report.ts scripts/uat/lib/report.test.ts
git commit -m "feat(uat): rapport compact — retire l'affichage tier, tronque observed, ajoute details.json"
```

---

### Task 4: Profils de lancement nommés (`UAT_PROFILE`)

Lancer un run exige aujourd'hui de composer 6-7 variables d'env de tête ; oublier `UAT_FAKE=1` fait silencieusement SKIP les steps scénario (piège déjà tombé en run réel). On introduit des profils nommés qui encapsulent les flags **structurels** (les coordonnées device et secrets du labo restent dans l'env / `.env.local`, jamais codés en dur).

**Files:**
- Create: `scripts/uat/profiles.ts`
- Create: `scripts/uat/profiles.test.ts`
- Modify: `scripts/uat/journey/run-journey.ts` (`loadJourneyConfig` + `main`)
- Modify: `package.json` (section `scripts` uniquement)

**Interfaces:**
- Produces: `PROFILES: Record<string, Record<string, string>>` ; `applyProfile(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv`.
- Consumes: appelé en tête de `loadJourneyConfig` et dans `main` — l'env explicite l'emporte toujours sur les défauts du profil ; profil inconnu → throw (fail-fast).

- [ ] **Step 1: Écrire les tests de `applyProfile`**

Create `scripts/uat/profiles.test.ts` :

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyProfile, PROFILES } from './profiles.js'

test('sans UAT_PROFILE, l’env est renvoyé tel quel', () => {
  const env = { FOO: 'bar' }
  assert.equal(applyProfile(env), env)
})

test('le profil fake fournit les flags structurels manquants', () => {
  const out = applyProfile({ UAT_PROFILE: 'fake', NVX_PASS: 'test123' })
  assert.equal(out.UAT_FAKE, '1')
  assert.equal(out.UAT_LAB, '1')
  assert.equal(out.NVX_PORT, '8443')
})

test('l’env explicite l’emporte sur le défaut du profil', () => {
  const out = applyProfile({ UAT_PROFILE: 'fake', NVX_PORT: '9000' })
  assert.equal(out.NVX_PORT, '9000')
})

test('le profil lab ne code AUCUNE coordonnée device (host/pass restent à l’env)', () => {
  assert.equal(PROFILES.lab.NVX_HOST, undefined)
  assert.equal(PROFILES.lab.NVX_PASS, undefined)
  assert.equal(PROFILES.lab.UAT_LAB, '1')
})

test('un profil inconnu jette', () => {
  assert.throws(() => applyProfile({ UAT_PROFILE: 'nope' }), /Unknown UAT_PROFILE/)
})
```

- [ ] **Step 2: Lancer les tests — doivent ÉCHOUER**

Run: `node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs --test scripts/uat/profiles.test.ts`
Expected: FAIL — module `./profiles.js` introuvable.

- [ ] **Step 3: Implémenter `profiles.ts`**

Create `scripts/uat/profiles.ts` :

```ts
/** Named launch profiles: encapsulate the STRUCTURAL env flags so an operator runs
 *  `UAT_PROFILE=fake npm run uat:journey` instead of composing 6-7 vars by hand.
 *  Device coordinates/secrets for the LAB stay in env (.env.local) — never hardcoded here.
 *  Explicit env vars always override profile defaults. */
export const PROFILES: Record<string, Record<string, string>> = {
  // Full offline journey against the local fake-device (no real hardware).
  // NVX_PASS defaults to the fake's throwaway password (matches FAKE_NVX_PASS in SETUP.md).
  fake: {
    UAT_LAB: '1',
    UAT_FAKE: '1',
    NVX_HOST: 'host.docker.internal',
    NVX_PORT: '8443',
    ORACLE_HOST: '127.0.0.1',
    NVX_PASS: 'test123',
    COMPANION_CONTAINER: 'companion-nvx-companion-1',
  },
  // Local-only: install + config failures. No device, no lab steps.
  local: {
    COMPANION_CONTAINER: 'companion-nvx-companion-1',
  },
  // Lab: real device. Host/user/password come from env (.env.local) — NOT set here.
  lab: {
    UAT_LAB: '1',
    COMPANION_CONTAINER: 'companion-nvx-companion-1',
  },
}

/** Merge the named profile (if UAT_PROFILE is set) UNDER the real env: explicit env wins.
 *  Unknown profile name throws — fail fast rather than silently running the default.
 *  Idempotent: applyProfile(applyProfile(env)) === applyProfile(env). */
export function applyProfile(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const name = env.UAT_PROFILE
  if (!name) return env
  const profile = PROFILES[name]
  if (!profile) {
    throw new Error(`Unknown UAT_PROFILE '${name}' — known: ${Object.keys(PROFILES).join(', ')}`)
  }
  return { ...profile, ...env }
}
```

- [ ] **Step 4: Lancer les tests — doivent passer**

Run: `node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs --test scripts/uat/profiles.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Brancher `applyProfile` dans `loadJourneyConfig`**

Modify `scripts/uat/journey/run-journey.ts`. Ajouter l'import (après la ligne 12) :

```ts
import { applyProfile } from '../profiles.js'
```

Au début de `loadJourneyConfig` (ligne 48), appliquer le profil et lire depuis l'env résolu :

```ts
export function loadJourneyConfig(env: NodeJS.ProcessEnv): JourneyConfig {
  const e = applyProfile(env)
  const isLab = e.UAT_LAB === '1'
  if (isLab && !e.NVX_USER) {
    throw new Error('NVX_USER required in lab mode — set it explicitly to avoid silently falling back to admin')
  }
  return {
    companionUrl: e.COMPANION_URL ?? 'http://localhost:8000',
    container: e.COMPANION_CONTAINER ?? 'companion-nvx-companion-1',
    label: e.UAT_LABEL ?? 'nvx-uat',
    nvxHost: e.NVX_HOST ?? '192.0.2.1',
    nvxPort: Number(e.NVX_PORT ?? 443),
    nvxUser: e.NVX_USER ?? 'admin',
    nvxPass: e.NVX_PASS ?? '',
    isFake: e.UAT_FAKE === '1',
    oracleHost: e.ORACLE_HOST,
    layout: loadLayout(e),
  }
}
```

> `loadLayout(e)` reçoit l'env résolu (un profil pourrait fixer `UAT_LAYOUT`) — inchangé sinon.

- [ ] **Step 6: Appliquer le profil aussi dans `main` (flags lus directement)**

Modify `scripts/uat/journey/run-journey.ts`, fonction `main` (lignes 142-182). `main` lit `UAT_PROVISION`/`UAT_KEEP`/`UAT_LAB`/`UAT_VERSION` directement sur `process.env` — résoudre une fois en tête et lire depuis cet env (idempotent avec le `applyProfile` interne de `loadJourneyConfig`) :

```ts
async function main(): Promise<void> {
  const env = applyProfile(process.env)
  const cfg = loadJourneyConfig(env)
  const ctx = buildContext(cfg)

  const provision = env.UAT_PROVISION === '1'
  let keep = env.UAT_KEEP === '1'
  if (provision) {
    keep = true
    const page = await ctx.ui.open()
    try {
      console.log(`[provision] ${cfg.label}: provisioning connection…`)
      await ensureConnection(
        { http: ctx.http, ui: ctx.ui, page },
        cfg.label,
        { host: cfg.nvxHost, port: cfg.nvxPort, username: cfg.nvxUser, password: cfg.nvxPass },
      )
      console.log(`[provision] ${cfg.label}: done`)
    } finally {
      await ctx.ui.close()
    }
  } else if (!keep) {
    await ensureFreshConnection(ctx)
  }

  const steps = env.UAT_LAB === '1' ? [...localSteps, ...labSteps] : localSteps
  const verdicts = await runJourney(steps, ctx)
  const startedAt = new Date().toISOString()
  const run: RunResult = { startedAt, version: env.UAT_VERSION ?? 'journey', verdicts }
  const moduleTag = deriveModule(env)
  const dir = resolveRunDir('docs/uat-runs', startedAt.slice(0, 10), moduleTag)
  writeRun(dir, run)

  if (!keep) await removeConnection(ctx)

  const failed = verdicts.filter((v) => v.status === 'FAIL').length
  console.log(`UAT journey: ${verdicts.length} steps, ${failed} FAIL → ${dir}`)
  process.exitCode = failed > 0 ? 1 : 0
}
```

> `deriveModule(env)` au lieu de `deriveModule(process.env)` : un profil pourrait porter `UAT_LABEL`/`UAT_MODULE`. Comportement inchangé sans profil.

- [ ] **Step 7: Ajouter les alias npm**

Modify `package.json`, section `scripts` — ajouter après `uat:journey` :

```json
    "uat:fake": "UAT_PROFILE=fake npm run uat:journey",
    "uat:local": "UAT_PROFILE=local npm run uat:journey",
```

> Le profil `lab` n'a pas d'alias bare : il exige les coordonnées device → `UAT_PROFILE=lab NVX_HOST=<ip> NVX_PASS=<pass> npm run uat:journey`.

- [ ] **Step 8: Vérifier l'absence de changement de dépendances**

Run: `git diff package.json`
Expected: seules des lignes ajoutées dans `"scripts"` ; `dependencies`/`devDependencies` intouchés.

- [ ] **Step 9: Suite complète — tout vert**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add scripts/uat/profiles.ts scripts/uat/profiles.test.ts scripts/uat/journey/run-journey.ts package.json
git commit -m "feat(uat): profils de lancement nommés (UAT_PROFILE fake/local/lab) + alias npm"
```

---

## Notes de fin de phase

- **Mettre à jour `docs/uat-runs/SETUP.md`** (hors TDD, doc) : documenter `UAT_PROFILE` (fake/local/lab) comme chemin nominal de lancement, et mentionner le nouvel artefact `details.json` à côté de `report.md`/`escalation.json`. À faire en fin de phase ou déléguer à `docs-writer`.
- **Reporté à la Phase 2** : sémantique de verdict non-concluant (émettre `AMBIGUOUS`/`HUMAN` au lieu de FAIL quand la précondition d'observation manque) + câblage réel de l'escalade LLM `uat-runner` (`escalate.ts` aujourd'hui mort).
- **Reporté à la Phase 3** : suppression du paramètre `tier` des factories de verdict (ripple sur tous les call-sites) ; refonte du modèle d'extension (registre de sous-systèmes déclaratifs) ; découplage de l'oracle de `Streams[0]` ; routage fake par table + garde mono-rôle.

## Self-review (effectuée)

- **Couverture du périmètre Phase 1** : reloger `makeClient` + supprimer `hasDevice` (T1) ✓ ; supprimer fossile `tiers/` (T1) ✓ ; retirer champ mort `HarnessConfig.tiers` (T2) ✓ ; retirer affichage tier + capper observed + details.json (T3) ✓ ; profils de lancement (T4) ✓.
- **Placeholders** : aucun — chaque step porte le code réel.
- **Cohérence des types** : `makeClient` signature identique avant/après ; `HarnessConfig` perd `tiers` partout où il était écrit (case.ts, buildContext, helper de test) ; `applyProfile`/`PROFILES` nommés de façon cohérente entre `profiles.ts`, son test et les deux call-sites de `run-journey.ts` ; `renderDetails`/`DetailRecord` cohérents entre report.ts et report.test.ts.
