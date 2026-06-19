# UAT Evolution — Phase 2 (Verdict non-concluant + câblage escalade) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire émettre au harness `AMBIGUOUS` (au lieu de `FAIL`) quand la précondition d'observation manque (le test n'a rien pu prouver), et câbler la glue d'escalade morte (`escalate.ts`) pour produire un prompt prêt à l'emploi + une instruction opérateur — adjudication LLM manuelle, zéro appel in-process.

**Architecture :** 4 tâches. (1+2) Sémantique de verdict non-concluant sur le gauntlet CFG, via le discriminant d'observation déjà présent (`logged` / `oracleOk`). (3) `main()` produit `escalation-prompt.md` quand des cas sont escaladés, et imprime l'instruction pour lancer l'agent `uat-runner`. (4) Boucle retour : persister le `RunResult` complet + un point d'entrée `applyAdjudication` (npm `uat:adjudicate`) qui ré-ingère les verdicts LLM via `mergeVerdicts` et réécrit le rapport. Tout offline, couvert par `npm test`, aucun créneau labo.

**Tech Stack :** TypeScript strict (ESM, imports `.js`), tests `node:test` + `node:assert/strict`, `npm test`.

## Global Constraints

- **Zéro installation** : aucune dépendance ajoutée/modifiée. La Tâche 4 ajoute un script `uat:adjudicate` dans `package.json` (section `scripts` seule) — `git diff package.json` ne doit pas toucher `dependencies`/`devDependencies`.
- **Zéro LLM in-process** : décision Didier — « glue pure, adjudication manuelle ». Le harness ne fait AUCUN appel LLM ; il produit un prompt + une instruction. Lancer `uat-runner` est un geste opérateur.
- **Critère AMBIGUOUS (décision Q1)** : pour un step du gauntlet, *précondition d'observation absente* → `AMBIGUOUS` ; *précondition réunie mais résultat contraire prouvé* → `FAIL`. Concrètement sur les steps à preuve-par-log : **`!logged` → `AMBIGUOUS`** ; `logged && mauvaise catégorie` → `FAIL`.
- **Oracle injoignable reste FAIL (décision Q2)** : ne PAS retravailler le chemin `throw → FAIL` (verrouillé par le filet Task 8 de Phase 1) ; « oracle injoignable → AMBIGUOUS » est explicitement HORS périmètre Phase 2.
- **Préserver** : les gardes `noDevice(ctx) → SKIP` (jamais AMBIGUOUS), et le filtre `ESCALATED = ['FAIL','AMBIGUOUS','HUMAN']` (déjà dans `report.ts:6`) — la plomberie aval est prête, on n'émet que l'amont.
- **ESM** : imports internes en `.js`. **Branche** : `refactor/uat-evolution`.
- **Anti-cycle** : composer le prompt dans `main()` (run-journey.ts), PAS dans `report.ts` — `escalate.ts` importe déjà le type `EscalationPacket` de `report.ts` ; importer `escalate.ts` depuis `report.ts` créerait un cycle.

---

### Task 1: `AMBIGUOUS` dans `configFailureStep` (CFG-NOPASS, CFG-UNREACHABLE)

`configFailureStep` (`steps-local.ts`) est partagé par CFG-NOPASS et CFG-UNREACHABLE. Aujourd'hui : `category===expectCat && logged → PASS`, sinon `FAIL`. On scinde le `else` : `!logged → AMBIGUOUS` (cause non observée — non concluant, cas F-A), sinon `FAIL` (catégorie contraire prouvée par log).

**Files:**
- Modify: `scripts/uat/journey/steps-local.ts:1` (import), `:56-63` (le retour triple-check)
- Test: `scripts/uat/journey/steps-local.test.ts`

**Interfaces:**
- Consumes: `ambiguous` de `../lib/verdict.js`.
- Produces: `configFailureStep` retourne `PASS | AMBIGUOUS | FAIL` (au lieu de `PASS | FAIL`).

- [ ] **Step 1: Écrire les tests de la nouvelle sémantique**

Ouvre `scripts/uat/journey/steps-local.test.ts`, lis comment il fabrique un `ctx` factice pour `configFailureStep`/CFG-NOPASS (spies sur `http.status`, `logs.detect`/`mark`, `ui`). En suivant ce pattern existant, ajoute trois tests qui exercent CFG-NOPASS (ou directement `configFailureStep`) :

```ts
// status attendu + log présent → PASS
test('configFailureStep — catégorie attendue + log présent → PASS', async () => {
  // ctx où http.status renvoie { category: 'warning' } et logs.detect renvoie true
  // … (réutilise le helper de fabrication de ctx du fichier)
  // assert verdict.status === 'PASS'
})

// log absent → AMBIGUOUS (non concluant — cas flaky F-A)
test('configFailureStep — log de cause absent → AMBIGUOUS (non concluant)', async () => {
  // ctx où logs.detect renvoie TOUJOURS false (cause jamais observée),
  // http.status renvoie { category: 'good' } (statut inattendu)
  // assert verdict.status === 'AMBIGUOUS'
})

// catégorie contraire MAIS log présent → FAIL (vrai défaut)
test('configFailureStep — log présent mais mauvaise catégorie → FAIL', async () => {
  // ctx où logs.detect renvoie true mais http.status renvoie une catégorie ≠ attendue
  // assert verdict.status === 'FAIL'
})
```

Si un test existant affirme `FAIL` dans le cas « statut inattendu + log absent » (l'ancienne sémantique), **mets-le à jour** pour attendre `AMBIGUOUS` (changement de spec, pas régression — il cassera en rouge à l'étape 2, c'est voulu).

- [ ] **Step 2: Lancer les tests — RED**

Run: `node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs --test scripts/uat/journey/steps-local.test.ts`
Expected: FAIL — le cas « log absent » retourne aujourd'hui `FAIL`, le test attend `AMBIGUOUS`.

- [ ] **Step 3: Implémenter la scission du verdict**

Dans `scripts/uat/journey/steps-local.ts`, ligne 1, ajoute `ambiguous` à l'import :

```ts
import { pass, fail, ambiguous } from '../lib/verdict.js'
```

Remplace le retour triple-check (lignes 56-63) par :

```ts
  // 5. Triple-check : catégorie REST + preuve par log.
  //    - attendu + log présent           → PASS
  //    - log absent (cause non observée)  → AMBIGUOUS (non concluant : l'env/UI n'a pas permis de tester — cf. F-A)
  //    - log présent mais mauvaise cat.   → FAIL (défaut réel prouvé)
  const st = await ctx.http.status(connId)
  if (st.category === expectCat && logged) {
    return pass(id, title, 1, { companion: st, note: `status=${expectCat} + cause logged` })
  }
  if (!logged) {
    return ambiguous(id, title, 1, {
      expected: { category: expectCat, cause: String(causeRe) },
      observed: { status: st, logged },
      note: 'cause non observée dans les logs — non concluant (env/UI), pas un défaut module',
    })
  }
  return fail(id, title, 1, {
    expected: { category: expectCat, cause: String(causeRe) },
    observed: { status: st, logged },
  })
```

- [ ] **Step 4: GREEN**

Run: `npm test`
Expected: PASS (les 3 nouveaux tests verts ; les tests INSTALL/connexion-absente inchangés).

- [ ] **Step 5: Commit**

```bash
git add scripts/uat/journey/steps-local.ts scripts/uat/journey/steps-local.test.ts
git commit -m "feat(uat): CFG-NOPASS/UNREACHABLE émettent AMBIGUOUS quand la cause n'est pas observée (non concluant)"
```

---

### Task 2: `AMBIGUOUS` dans CFG-WRONGPASS et CFG-GOOD (steps-lab)

Même principe sur les deux steps d'auth labo. **CFG-WRONGPASS** (preuve = `logged`) : `!logged → AMBIGUOUS`. **CFG-GOOD** (preuve = connexion saine + session oracle) : `category!=='good' → AMBIGUOUS` (la connexion n'a jamais été saine → on n'a pas pu tester la session) ; `category==='good' && !oracleOk → FAIL` (saine mais pas de session = défaut, inclut le cas oracle-injoignable qui reste FAIL per Q2). Les gardes `noDevice → SKIP` restent intactes.

**Files:**
- Modify: `scripts/uat/journey/steps-lab.ts:1` (import), `:422-427` (CFG-WRONGPASS retour), `:454-459` (CFG-GOOD retour)
- Test: `scripts/uat/journey/steps-lab.test.ts`

**Interfaces:**
- Consumes: `ambiguous` de `../lib/verdict.js` (ajouté à l'import existant `{ pass, fail, skip }`).

- [ ] **Step 1: Écrire les tests**

Dans `scripts/uat/journey/steps-lab.test.ts`, en suivant le pattern de fabrication de `ctx` du fichier, ajoute :

```ts
// CFG-WRONGPASS
test('CFG-WRONGPASS — log absent → AMBIGUOUS', async () => {
  // ctx avec nvxPass défini (pas de SKIP), logs.detect → false, http.status → { category:'good' }
  // assert status === 'AMBIGUOUS'
})
test('CFG-WRONGPASS — warning + log présent → PASS', async () => {
  // logs.detect → true, http.status → { category:'warning' } ; assert 'PASS'
})

// CFG-GOOD
test('CFG-GOOD — catégorie jamais good → AMBIGUOUS (connexion non établie)', async () => {
  // pollStatusCategory ne voit jamais 'good' (http.status → { category:'error' } en boucle)
  // assert status === 'AMBIGUOUS'
})
test('CFG-GOOD — good mais oracle échoue → FAIL', async () => {
  // http.status → { category:'good' }, oracle.readStream0 throw ; assert status === 'FAIL'
})
test('CFG-WRONGPASS — sans device (noDevice) → SKIP', async () => {
  // ctx.config.nvxPass = '' ; assert status === 'SKIP'  (garde préservée)
})
```

- [ ] **Step 2: RED**

Run: `node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs --test scripts/uat/journey/steps-lab.test.ts`
Expected: FAIL — les cas « log absent » / « catégorie jamais good » retournent aujourd'hui `FAIL`.

- [ ] **Step 3: Implémenter — import**

`scripts/uat/journey/steps-lab.ts` ligne 1 :

```ts
import { pass, fail, skip, ambiguous } from '../lib/verdict.js'
```

- [ ] **Step 4: Implémenter — CFG-WRONGPASS**

Remplace le retour (lignes 422-427) par :

```ts
      if (st.category === 'warning' && logged) {
        return pass('CFG-WRONGPASS', 'wrong password → AuthenticationFailure', 1, { companion: st, note: 'auth failure + logged (1 login used)' })
      }
      if (!logged) {
        return ambiguous('CFG-WRONGPASS', 'wrong password → AuthenticationFailure', 1, {
          expected: { category: 'warning', cause: 'auth 401/403' },
          observed: { status: st, logged },
          note: 'cause auth non observée dans les logs — non concluant (env/UI)',
        })
      }
      return fail('CFG-WRONGPASS', 'wrong password → AuthenticationFailure', 1, {
        expected: { category: 'warning', cause: 'auth 401/403' },
        observed: { status: st, logged },
      })
```

- [ ] **Step 5: Implémenter — CFG-GOOD**

Remplace le retour (lignes 454-459) par :

```ts
      if (category === 'good' && oracleOk) {
        return pass('CFG-GOOD', 'connected (oracle confirms session)', 1, { companion: { category }, note: 'status good + oracle read stream' })
      }
      if (category !== 'good') {
        return ambiguous('CFG-GOOD', 'connected (oracle confirms session)', 1, {
          expected: { category: 'good', oracle: 'readStream0 succeeds' },
          observed: { category, oracleOk, oracleErr },
          note: 'connexion jamais saine — non concluant (env/UI), session non testable',
        })
      }
      return fail('CFG-GOOD', 'connected (oracle confirms session)', 1, {
        expected: { category: 'good', oracle: 'readStream0 succeeds' },
        observed: { category, oracleOk, oracleErr },
      })
```

- [ ] **Step 6: GREEN + commit**

Run: `npm test` → PASS.

```bash
git add scripts/uat/journey/steps-lab.ts scripts/uat/journey/steps-lab.test.ts
git commit -m "feat(uat): CFG-WRONGPASS/CFG-GOOD émettent AMBIGUOUS quand la condition n'est pas observable"
```

---

### Task 3: Câbler la glue d'escalade — `main()` produit `escalation-prompt.md` + instruction opérateur

Quand un run contient des cas escaladés (FAIL/AMBIGUOUS/HUMAN), `main()` compose le prompt d'adjudication (`buildEscalationPrompt` sur le `EscalationPacket` déjà calculé par `renderEscalation`), l'écrit en `escalation-prompt.md` dans le dossier du run, et imprime l'instruction pour lancer l'agent `uat-runner`. `escalate.ts` cesse d'être du code mort.

**Files:**
- Modify: `scripts/uat/journey/run-journey.ts` (imports + `main()` après `writeRun`)
- Test: `scripts/uat/lib/report.test.ts` (couvre `buildEscalationPrompt` via un test d'intégration léger) — OU `scripts/uat/lib/escalate.test.ts` si tu y ajoutes un cas

**Interfaces:**
- Consumes: `renderEscalation` (`../lib/report.js`), `buildEscalationPrompt` (`../lib/escalate.js`), `writeFileSync`/`path` (déjà importés indirectement — vérifie).
- Produces: artefact `escalation-prompt.md` (conditionnel) à côté de `report.md`/`details.json`/`escalation.json`.

- [ ] **Step 1: Écrire le test de `buildEscalationPrompt` sur un packet avec AMBIGUOUS**

Dans `scripts/uat/lib/escalate.test.ts` (qui importe déjà `buildEscalationPrompt`), ajoute :

```ts
test('buildEscalationPrompt inclut les cas AMBIGUOUS et demande un JSON', () => {
  const packet = {
    version: 'v0.4', startedAt: '2026-06-18T00:00:00.000Z',
    cases: [
      { id: 'CFG-NOPASS', title: 'empty password → BadConfig', tier: 1, status: 'AMBIGUOUS' as const, evidence: { note: 'cause non observée' } },
    ],
  }
  const prompt = buildEscalationPrompt(packet)
  assert.match(prompt, /CFG-NOPASS/)
  assert.match(prompt, /current: AMBIGUOUS/)
  assert.match(prompt, /Reply as JSON/)
})
```

- [ ] **Step 2: RED**

Run: `node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs --test scripts/uat/lib/escalate.test.ts`
Expected: PASS si l'API le permet déjà — sinon ajuste le test à l'API réelle. (Ce test verrouille le contrat avant le câblage ; il peut être vert d'emblée car `buildEscalationPrompt` existe. Le RED réel est au Step 3 côté `main()`, prouvé par l'absence de l'artefact — voir Step 4.)

- [ ] **Step 3: Câbler dans `main()`**

Dans `scripts/uat/journey/run-journey.ts`, ajoute aux imports (près de `import { writeRun, resolveRunDir } from '../lib/report.js'`) :

```ts
import { writeRun, resolveRunDir, renderEscalation } from '../lib/report.js'
import { buildEscalationPrompt } from '../lib/escalate.js'
```

(et assure-toi que `writeFileSync` et `path` sont importés en tête — `path` l'est déjà ; ajoute `import { writeFileSync } from 'node:fs'` à côté du `readFileSync` existant si absent.)

Juste après `writeRun(dir, run)` dans `main()`, ajoute :

```ts
  // Escalade (glue pure — adjudication manuelle) : si des cas sont escaladés, produire le
  // prompt prêt à l'emploi pour l'agent uat-runner. AUCUN appel LLM in-process.
  const packet = renderEscalation(run)
  if (packet.cases.length > 0) {
    writeFileSync(path.join(dir, 'escalation-prompt.md'), buildEscalationPrompt(packet), 'utf8')
    console.log(
      `UAT escalade : ${packet.cases.length} cas (FAIL/AMBIGUOUS/HUMAN). ` +
        `Adjudication : lancer l'agent uat-runner sur ${path.join(dir, 'escalation-prompt.md')}, ` +
        `puis 'npm run uat:adjudicate -- ${dir} <llm-verdicts.json>'.`,
    )
  }
```

- [ ] **Step 4: Vérifier l'artefact (test manuel ciblé, offline)**

Run (fake nécessaire pour un run complet — sinon vérifie le bloc en lecture) : confirme que, sur un run contenant des cas escaladés, `escalation-prompt.md` apparaît dans le dossier de run et contient les cas. Si pas d'env fake sous la main, repose-toi sur le test unitaire du Step 1 + une revue du diff.

- [ ] **Step 5: GREEN + commit**

Run: `npm test` → PASS.

```bash
git add scripts/uat/journey/run-journey.ts scripts/uat/lib/escalate.test.ts
git commit -m "feat(uat): câble l'escalade — main() produit escalation-prompt.md + instruction uat-runner (glue pure)"
```

---

### Task 4: Boucle retour — persister `run.json` + `applyAdjudication` + `npm run uat:adjudicate`

Pour ré-ingérer l'adjudication LLM, il faut le `RunResult` complet (le `report.md` est rendu, `details.json`/`escalation.json` sont partiels). On persiste `run.json` au run, et on ajoute un point d'entrée qui lit `run.json` + un fichier de verdicts LLM, applique `mergeVerdicts`, et réécrit `report.md`/`details.json`/`escalation.json`. `escalate.ts`'s `mergeVerdicts` cesse d'être mort.

**Files:**
- Modify: `scripts/uat/lib/report.ts` (`writeRun` écrit aussi `run.json`)
- Create: `scripts/uat/adjudicate.ts` (entrypoint `applyAdjudication` + CLI)
- Create: `scripts/uat/adjudicate.test.ts`
- Modify: `package.json` (script `uat:adjudicate`)

**Interfaces:**
- Produces: `applyAdjudication(dir: string, llmVerdictsPath: string): void` ; artefact `run.json` (= `RunResult` complet).
- Consumes: `mergeVerdicts` (`./lib/escalate.js`), `writeRun` (`./lib/report.js`), `LlmVerdict`.

- [ ] **Step 1: Test — `writeRun` persiste `run.json` rechargeable**

Dans `scripts/uat/lib/report.test.ts`, ajoute :

```ts
test('writeRun écrit run.json contenant le RunResult complet', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'uat-run-'))
  writeRun(dir, run) // `run` = fixture existante en tête du fichier
  const reloaded = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'))
  assert.equal(reloaded.version, run.version)
  assert.equal(reloaded.verdicts.length, run.verdicts.length)
  rmSync(dir, { recursive: true, force: true })
})
```

(Ajoute `readFileSync` à l'import `node:fs` du test s'il manque.)

- [ ] **Step 2: RED**

Run: `node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs --test scripts/uat/lib/report.test.ts`
Expected: FAIL — `run.json` n'existe pas.

- [ ] **Step 3: `writeRun` écrit `run.json`**

Dans `scripts/uat/lib/report.ts`, fonction `writeRun`, ajoute :

```ts
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run, null, 2), 'utf8')
```

- [ ] **Step 4: Test de `applyAdjudication`**

Create `scripts/uat/adjudicate.test.ts` :

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyAdjudication } from './adjudicate.js'
import { writeRun } from './lib/report.js'
import type { RunResult } from './lib/case.js'

test('applyAdjudication remplace le statut des cas adjugés et réécrit le rapport', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'uat-adj-'))
  const run: RunResult = {
    startedAt: '2026-06-18T00:00:00.000Z', version: 'v0.4',
    verdicts: [
      { id: 'CFG-NOPASS', title: 'empty password', tier: 1, status: 'AMBIGUOUS', evidence: { note: 'non concluant' } },
      { id: 'INSTALL', title: 'module available', tier: 1, status: 'PASS', evidence: {} },
    ],
  }
  writeRun(dir, run)
  writeFileSync(path.join(dir, 'llm.json'), JSON.stringify([{ id: 'CFG-NOPASS', status: 'FAIL', reason: 'env ok, real defect' }]), 'utf8')

  applyAdjudication(dir, path.join(dir, 'llm.json'))

  const merged = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'))
  const cfg = merged.verdicts.find((v: { id: string }) => v.id === 'CFG-NOPASS')
  assert.equal(cfg.status, 'FAIL')
  assert.match(cfg.evidence.note, /LLM: FAIL/)
  rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 5: RED**

Run: `node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs --test scripts/uat/adjudicate.test.ts`
Expected: FAIL — `./adjudicate.js` introuvable.

- [ ] **Step 6: Implémenter `adjudicate.ts`**

Create `scripts/uat/adjudicate.ts` :

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeRun } from './lib/report.js'
import { mergeVerdicts, type LlmVerdict } from './lib/escalate.js'
import type { RunResult } from './lib/case.js'

/** Ré-ingère une adjudication LLM dans un dossier de run : lit run.json + un fichier de
 *  LlmVerdict[], fusionne via mergeVerdicts, et réécrit report.md/details.json/escalation.json/run.json. */
export function applyAdjudication(dir: string, llmVerdictsPath: string): void {
  const run = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')) as RunResult
  const llm = JSON.parse(readFileSync(llmVerdictsPath, 'utf8')) as LlmVerdict[]
  const merged: RunResult = { ...run, verdicts: mergeVerdicts(run.verdicts, llm) }
  writeRun(dir, merged)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, llmPath] = process.argv.slice(2)
  if (!dir || !llmPath) {
    console.error('usage: uat:adjudicate <run-dir> <llm-verdicts.json>')
    process.exitCode = 1
  } else {
    applyAdjudication(dir, llmPath)
    console.log(`adjudication appliquée → ${dir}`)
  }
}
```

- [ ] **Step 7: Script npm**

`package.json`, section `scripts`, ajoute :

```json
    "uat:adjudicate": "node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs scripts/uat/adjudicate.ts",
```

- [ ] **Step 8: GREEN + vérif deps**

Run: `npm test` → PASS.
Run: `git diff package.json` → seul `scripts` modifié.

- [ ] **Step 9: Commit**

```bash
git add scripts/uat/lib/report.ts scripts/uat/lib/report.test.ts scripts/uat/adjudicate.ts scripts/uat/adjudicate.test.ts package.json
git commit -m "feat(uat): boucle d'adjudication — run.json + applyAdjudication (mergeVerdicts) + npm uat:adjudicate"
```

---

## Notes de fin de phase

- **Doc SETUP.md** : documenter le cycle d'escalade (artefact `escalation-prompt.md`, lancer `uat-runner`, `npm run uat:adjudicate`) et le nouvel artefact `run.json`. À faire en fin de phase ou déléguer à `docs-writer`.
- **Hors périmètre (reporté)** : « oracle injoignable → AMBIGUOUS » (décision Q2 = reste FAIL) ; émission AMBIGUOUS au-delà du gauntlet CFG (ex. steps USE/ENC sur précondition absente) ; la refonte du modèle d'extension (Phase 3).
- **F-A** : après Phase 2, un gauntlet CFG flaky produit des `AMBIGUOUS` escaladés (non plus des `FAIL`) — le rapport distingue enfin « env n'a pas permis de tester » de « bug module ».

## Self-review (effectuée)

- **Couverture** : Q1 (critère `!logged → AMBIGUOUS`) → T1+T2 ✓ ; Q2 (oracle injoignable reste FAIL) → respecté (CFG-GOOD `good && !oracleOk → FAIL`) ✓ ; glue pure forward → T3 ✓ ; boucle retour `mergeVerdicts` → T4 ✓ ; gardes `noDevice→SKIP` préservées (testé T2 Step 1) ✓.
- **Placeholders** : production code exact (configFailureStep, CFG-WRONGPASS/GOOD, main(), adjudicate.ts) ; les tests des steps renvoient au pattern de fabrication de `ctx` du fichier (l'implémenteur lit le helper existant) — instructions concrètes, assertions exactes.
- **Cohérence types** : `ambiguous(id,title,tier,evidence)` = même signature que `fail` (verdict.ts) ; `EscalationPacket`/`renderEscalation`/`buildEscalationPrompt`/`mergeVerdicts`/`LlmVerdict` repris de l'API réelle lue ; `applyAdjudication(dir, llmVerdictsPath)` cohérent entre adjudicate.ts, son test, et le script npm.
