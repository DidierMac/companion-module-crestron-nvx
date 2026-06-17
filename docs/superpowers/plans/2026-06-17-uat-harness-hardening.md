# UAT Harness Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Éliminer la classe de bugs « config à double source de vérité non réconciliée » du harness UAT, qui produit le pattern « petits bugs + correctifs par tâtonnement » observé au 1er run réel #03-Rx (7 PASS / 5 FAIL / 13 SKIP).

**Architecture:** Le harness (`scripts/uat/`) pilote Bitfocus Companion (HTTP + Playwright) contre des devices Crestron NVX. La cause racine transversale : la config *voulue* (`JourneyConfig`, dérivée des env) et la config *appliquée* au device (via `fillConfig` dans le formulaire Companion) divergent. On propage la config voulue partout, on rend `fillConfig` idempotent, on aligne les deux chemins de provision, on ajoute les gardes de rôle manquantes, on complète la fixture layout, et on rend franches les erreurs silencieuses.

**Tech Stack:** TypeScript strict, Node.js 18+ (runner de test maison `node --test` / le runner du repo — voir `package.json` scripts), Playwright (UI Companion), `@companion-module/base` v2.

## Global Constraints

- **Zéro installation** : aucune dépendance ajoutée/mise à jour. `package.json`/lock inchangés.
- **Read-only sur le module** : ce plan ne modifie PAS `src/` — la logique de reconnexion module est vérifiée CORRECTE (`main.ts:80-89`). Seul le harness `scripts/uat/` et les fixtures/docs changent.
- **Le fake-device ignore le username** (`scripts/uat/fake-device/server.ts:145-154` : ne valide que `passwd`) → remplacer `'admin'` par `ctx.config.nvxUser` est SÛR pour les runs fake/CI. Vérifié.
- **TDD strict** : test rouge d'abord, un fix minimal, vert, commit. Un seul changement par cycle.
- **158 tests existants doivent rester verts** après chaque tâche.
- **Branche** : `fix/uat-credential-chain` (déjà créée, depuis `feature/v0.4-audio` qui porte le harness à jour).

## Causes racines confirmées (Phase 1 systematic-debugging — close)

| Cluster | Cause racine (vérifiée, fichier:ligne) | Bugs mémoire |
|---|---|---|
| **A. Credential** | `username: 'admin'` codé en dur dans `steps-local.ts:90,104` + `steps-lab.ts:400,424` (au lieu de `ctx.config.nvxUser`). Masqué car device + fake acceptent `admin`. Secondaires : fallback `?? 'admin'` (`run-journey.ts:49`) ; `fillConfig` patch partiel (`chromium.ts:116-127`) ; deux chemins provision (`ensureConnection` configure / `ensureFreshConnection` non). | #1, #1 (cascade), #2 |
| **B. Rôle** | `writeStep`/`writeStepRx` (`steps-lab.ts:157-202`) sans garde de rôle (le bon pattern existe dans `ENC-VARS`/`DEC-VARS`). `setRxScenario` fake-only jette en réel (`oracle.ts:64-68`). `baselineStep` sans garde + `restore()` no-op silencieux qui rapporte « device restored » à tort (`oracle.ts:46-47,71-72`). | #3, #5 |
| **C. Layout** | `fixtures/layout.json` ne contient QUE 4 clés encodeur ; les 5+ clés décodeur (`set_source_url`, `connect_to_stream`, `dec_enable_stream`…) absentes → write-steps décodeur SKIP silencieux, AUCUN POST. `loadLayout` avale un JSON malformé (`run-journey.ts:37`). | #1b, #4 |
| **D. Erreurs silencieuses** | `readVar` `catch {}` indiscriminé (`steps-lab.ts:64-73`) ; `fillConfig` ne clique Save que si activé (`chromium.ts:125-126`) ; corrélation logs par sous-chaîne (`companion-logs.ts:30-31`). | qualité / anti-tâtonnement |
| **E. Module reconnexion** | **PAS un bug code** — `configUpdated` lit `secrets` et relance `connect()` (`main.ts:80-89,82,87`). À VÉRIFIER au labo via le log `[CONN] configUpdated() → reconnect`. | #1 (empirique) |

---

## File Structure

- **Modify** `scripts/uat/journey/steps-local.ts` — propager `nvxUser` (steps CFG-NOPASS/CFG-UNREACHABLE)
- **Modify** `scripts/uat/journey/steps-lab.ts` — propager `nvxUser` (CFG-WRONGPASS/CFG-GOOD) ; gardes de rôle dans `writeStep`/`writeStepRx`/`baselineStep` ; SKIP `setRxScenario` en réel
- **Modify** `scripts/uat/journey/run-journey.ts` — fallback `?? 'admin'` → échec franc en mode lab ; `loadLayout` → erreur franche sur JSON malformé ; aligner `ensureFreshConnection`
- **Modify** `scripts/uat/tools/chromium.ts` — `fillConfig` : reset complet du formulaire OU garantie de Save ; champ secret (password) écrit correctement
- **Modify** `scripts/uat/tools/oracle.ts` — `restore()`/`restoreRx()` signalent quand baseline absente
- **Modify** `scripts/uat/fixtures/layout.json` — ajouter les clés décodeur
- **Modify** `docs/uat-runs/SETUP.md` — documenter les boutons décodeur à créer + retirer le caveat « username admin codé en dur »
- **Test** : `scripts/uat/journey/steps-lab.test.ts`, `steps-local.test.ts`, `tools/ensure-connection.test.ts`, `tools/oracle.test.ts` (existants — étendre)

---

## Task 1 — Propager `nvxUser` dans les 4 steps de config (bug #1/#2, cluster A cœur)

**Files:**
- Modify: `scripts/uat/journey/steps-lab.ts:400,424`
- Modify: `scripts/uat/journey/steps-local.ts:90,104`
- Test: `scripts/uat/journey/steps-lab.test.ts`, `scripts/uat/journey/steps-local.test.ts`

**Interfaces:**
- Consomme : `ctx.config.nvxUser: string` (déjà défini, `types.ts:20`, dérivé de `NVX_USER`).
- Produit : les 4 steps appellent `setConfig`/`fillConfig` avec `username: ctx.config.nvxUser`.

- [ ] **Step 1 — Test rouge** : ajouter dans `steps-lab.test.ts` un test qui exécute `CFG-GOOD` avec un `ctx.config.nvxUser = 'didier'` et un faux `setConfig` espionné, et asserte que l'appel reçoit `username: 'didier'` (PAS `'admin'`). Idem `CFG-WRONGPASS`. Dans `steps-local.test.ts`, idem pour `CFG-NOPASS` et `CFG-UNREACHABLE`.
- [ ] **Step 2 — Vérifier l'échec** : lancer la suite ciblée ; attendu FAIL (`expected 'didier', received 'admin'`).
- [ ] **Step 3 — Fix minimal** : aux 4 lignes, remplacer `username: 'admin'` par `username: ctx.config.nvxUser`. Conserver le `password` tel quel (CFG-GOOD garde `ctx.config.nvxPass`, CFG-WRONGPASS garde `WRONG_PASSWORD`, CFG-NOPASS garde `''`).
- [ ] **Step 4 — Vert** : suite ciblée PASS.
- [ ] **Step 5 — Non-régression** : suite complète verte (158).
- [ ] **Step 6 — Commit** : `fix(uat): propager nvxUser dans les steps CFG-* (fin du username figé à admin)`

## Task 2 — Fallback credential franc en mode lab (cluster A, M4)

**Files:**
- Modify: `scripts/uat/journey/run-journey.ts:49` (et la lecture env voisine)
- Test: nouveau test dans le fichier de test de run-journey (ou `steps-*` selon où la config est construite)

**Interfaces:**
- Consomme : `env.NVX_USER`, le flag mode lab (`UAT_LAB`).
- Produit : en mode lab, `NVX_USER` absent → erreur explicite ; hors lab (fake), défaut `admin` toléré.

- [ ] **Step 1 — Test rouge** : test prouvant qu'en mode lab sans `NVX_USER`, la construction de config jette/échoue avec un message clair (`NVX_USER required in lab mode`). Et qu'en mode non-lab, le défaut reste toléré.
- [ ] **Step 2 — Échec** : FAIL (actuellement le `?? 'admin'` masque, pas d'erreur).
- [ ] **Step 3 — Fix** : remplacer le silencieux `?? 'admin'` par une logique : si mode lab et `!env.NVX_USER` → throw message explicite ; sinon `env.NVX_USER ?? 'admin'`.
- [ ] **Step 4 — Vert** ; **Step 5 — Non-régression** ; **Step 6 — Commit** : `fix(uat): échec franc si NVX_USER manquant en mode lab (au lieu de retomber sur admin)`

## Task 3 — `fillConfig` idempotent + écriture fiable du secret (cluster A : C2, m2)

**Files:**
- Modify: `scripts/uat/tools/chromium.ts:116-127`
- Test: `scripts/uat/tools/*` (test du remplissage de formulaire) — étendre/créer

**Interfaces:**
- Consomme : `fields: { host?, port?, username?, password? }`.
- Produit : après `fillConfig`, le formulaire reflète EXACTEMENT les champs fournis, l'état hérité n'influe pas sur le résultat des champs ciblés, et le Save est garanti (ou une erreur est levée si rien n'a pu être sauvé alors qu'un changement était demandé). Le champ password (canal `secret-text`) est écrit par son sélecteur propre.

- [ ] **Step 1 — Test rouge** : test documentant qu'un `fillConfig` qui omet `host` ne doit PAS laisser un `host` hérité fausser l'intention (selon la décision : soit reset complet, soit l'appelant fournit toujours les 4 champs). + test que si un changement est demandé mais Save reste désactivé, une erreur est levée (pas de succès silencieux).
- [ ] **Step 2 — Échec**.
- [ ] **Step 3 — Fix** : (décision d'implémentation à prendre par l'architecte/coder en lisant le fichier) soit réinitialiser les champs avant écriture, soit imposer que les steps fournissent toujours host+port+username+password ; garantir le clic Save ou lever une erreur explicite ; vérifier que le password va bien dans le champ `secret-text`.
- [ ] **Step 4 — Vert** ; **Step 5 — Non-régression** ; **Step 6 — Commit** : `fix(uat): fillConfig idempotent + Save garanti + secret écrit fiablement`

## Task 4 — Aligner les deux chemins de provision (cluster A, C3)

**Files:**
- Modify: `scripts/uat/journey/run-journey.ts:76-85` (`ensureFreshConnection`) vs `scripts/uat/tools/ensure-connection.ts:14-43`
- Test: `scripts/uat/tools/ensure-connection.test.ts`

**Interfaces:**
- Produit : le chemin défaut (`!keep`) aboutit à une connexion **configurée + enabled**, à parité avec `ensureConnection` (host/port/username/password appliqués, restart).

- [ ] **Step 1 — Test rouge** : test prouvant que `ensureFreshConnection` produit une connexion configurée (username = `ctx.config.nvxUser`) et enabled, à parité avec `ensureConnection`.
- [ ] **Step 2 — Échec** (aujourd'hui `ensureFreshConnection` ne `fillConfig` ni enable).
- [ ] **Step 3 — Fix** : faire converger les deux chemins (factoriser la config via `ensureConnection` ou appliquer `fillConfig`+enable+restart dans `ensureFreshConnection`).
- [ ] **Step 4 — Vert** ; **Step 5 — Non-régression** ; **Step 6 — Commit** : `fix(uat): provision unifiée — ensureFreshConnection configure et enable la connexion`

## Task 5 — Gardes de rôle dans `writeStep`/`writeStepRx` (bug #3, cluster B / M1)

**Files:**
- Modify: `scripts/uat/journey/steps-lab.ts:157-202`
- Test: `scripts/uat/journey/steps-lab.test.ts`

**Interfaces:**
- Consomme : `ctx` exposant le rôle device (même source que `ENC-VARS`/`DEC-VARS` qui gardent déjà via `if (role !== 'Transmitter') return skip`).
- Produit : un write-step encodeur SKIP (pas FAIL) sur un Receiver ; un write-step décodeur SKIP sur un Transmitter.

- [ ] **Step 1 — Test rouge** : test prouvant qu'un step encodeur (via `writeStep`) SKIP quand `device_role = 'Receiver'`, et qu'un step décodeur (via `writeStepRx`) SKIP quand `device_role = 'Transmitter'`.
- [ ] **Step 2 — Échec** (aujourd'hui FAIL/throw).
- [ ] **Step 3 — Fix** : ajouter la garde de rôle dans `writeStep` (skip si rôle ≠ Transmitter) et `writeStepRx` (skip si rôle ≠ Receiver), en réutilisant exactement le pattern de `ENC-VARS`/`DEC-VARS`.
- [ ] **Step 4 — Vert** ; **Step 5 — Non-régression** ; **Step 6 — Commit** : `fix(uat): gardes de rôle dans writeStep/writeStepRx (SKIP au lieu de FAIL sur mauvais rôle)`

## Task 6 — `setRxScenario` & `baselineStep` : SKIP fake-only / garde de rôle (cluster B, M2/M6)

**Files:**
- Modify: `scripts/uat/journey/steps-lab.ts:114-140` (`writeStepRxWithScenario`), `:451-464` (`baselineStep`)
- Modify: `scripts/uat/tools/oracle.ts:46-47,71-72` (`restore`/`restoreRx` signalent si baseline absente)
- Test: `scripts/uat/journey/steps-lab.test.ts`, `scripts/uat/tools/oracle.test.ts`

**Interfaces:**
- Produit : `DEC-NEGOTIATING`/`DEC-DECODING` SKIP (fake-only) sur device réel ; `baselineStep` gardé par rôle ; `TEARDOWN` ne rapporte « device restored » que si une baseline a réellement été capturée.

- [ ] **Step 1 — Test rouge** : (a) `DEC-NEGOTIATING` SKIP quand la cible est un device réel (pas de route `/_control/scenario`) ; (b) `restore()` quand `baseline === null` ne produit PAS un verdict « restored » trompeur.
- [ ] **Step 2 — Échec**.
- [ ] **Step 3 — Fix** : entourer `setRxScenario` d'une détection fake/réel → SKIP en réel ; garde de rôle sur `baselineStep` ; `restore`/`restoreRx` retournent un statut explicite « baseline absente, rien restauré » au lieu d'un no-op muet.
- [ ] **Step 4 — Vert** ; **Step 5 — Non-régression** ; **Step 6 — Commit** : `fix(uat): scenario fake-only SKIP en réel + teardown honnête si baseline absente`

## Task 7 — Compléter la fixture layout + boutons décodeur (bug #1b/#4, cluster C)

**Files:**
- Modify: `scripts/uat/fixtures/layout.json`
- Modify: `docs/uat-runs/SETUP.md` (documenter les boutons décodeur à créer dans Companion + retirer le caveat M1 « username admin »)
- Test: `scripts/uat/journey/steps-lab.test.ts` (mapping layout → press)

**Interfaces:**
- Consomme : les `actionKey` décodeur référencés par les steps : `set_source_url` (`steps-lab.ts:322`), `set_source_multicast` (`:329`), `connect_to_stream` (`:337`), `dec_enable_stream` (`:344/352/360`), `dec_disable_stream` (`:367`).
- Produit : `layout.json` mappe chaque `actionKey` décodeur vers des coordonnées de bouton ; SETUP.md décrit les boutons à créer côté Companion.

- [ ] **Step 1 — Test rouge** : test prouvant que pour chaque `actionKey` décodeur, `ctx.config.layout?.[actionKey]` est défini quand la fixture par défaut est chargée → le step PRESS (pas SKIP) sur un Receiver.
- [ ] **Step 2 — Échec** (clés absentes aujourd'hui).
- [ ] **Step 3 — Fix** : ajouter les 5+ clés décodeur à `layout.json` (coordonnées cohérentes avec la convention existante des clés encodeur) ; mettre à jour SETUP.md.
- [ ] **Step 4 — Vert** ; **Step 5 — Non-régression** ; **Step 6 — Commit** : `fix(uat): mapper les boutons décodeur dans layout.json (fin des SKIP silencieux → POST émis)`

## Task 8 — Erreurs franches : `loadLayout` + `readVar` (cluster C/D, m1/M3)

**Files:**
- Modify: `scripts/uat/journey/run-journey.ts:37-39` (`loadLayout`)
- Modify: `scripts/uat/journey/steps-lab.ts:64-73` (`readVar`)
- Test: tests associés

**Interfaces:**
- Produit : `loadLayout` jette/avertit franchement sur JSON malformé (au lieu de `undefined` silencieux) ; `readVar` distingue 404 « variable pas encore définie » d'un timeout/erreur réseau (l'evidence du FAIL indique la cause).

- [ ] **Step 1 — Test rouge** : (a) `loadLayout` sur JSON invalide → erreur explicite ; (b) `readVar` sur erreur réseau ≠ 404 → ne retourne pas `''` silencieux mais propage/qualifie l'erreur.
- [ ] **Step 2 — Échec**.
- [ ] **Step 3 — Fix** : `loadLayout` → log/throw franc sur parse error ; `readVar` → ne capter que le 404 attendu, requalifier le reste.
- [ ] **Step 4 — Vert** ; **Step 5 — Non-régression** ; **Step 6 — Commit** : `fix(uat): erreurs franches sur layout malformé et lecture de variable (fin des faux SKIP/PASS)`

## Task 9 — Verrou de non-régression credential bout-en-bout (cluster A, scellement)

**Files:**
- Test: `scripts/uat/journey/steps-lab.test.ts` (ou un test d'intégration léger du flux config)

- [ ] **Step 1 — Test** : test d'intégration prouvant que, depuis `JourneyConfig{ nvxUser: 'didier' }`, AUCUN step ne fait redescendre le username à `'admin'` (parcours provision → CFG-* → tous les steps). Verrou anti-régression de la classe entière.
- [ ] **Step 2 — Vert** (les tâches 1-8 doivent le faire passer). **Step 3 — Commit** : `test(uat): verrou bout-en-bout — le username configuré n'est jamais écrasé par admin`

---

## Item labo (NON codable — vérification empirique au prochain run)

**E. Reconnexion module #1** — La logique module est CORRECTE (vérifié). Au prochain créneau labo, après correction du password en cours de run, vérifier dans les logs (`verbose: true`) la présence de :
- `[CONN] configUpdated() → reconnect` (`main.ts:84`) → le module est réveillé.
- Ligne suivante : `connect() triggered` (OK) / `No password configured` (→ `secrets=undefined`, problème de re-saisie du champ secret côté harness/Companion) / `Auth refused` (→ creds encore mauvais).

Si `configUpdated` **absent** des logs → Companion n'a pas déclenché le hook sur correction du seul password → bug d'orchestration/harness (Task 3 sur l'écriture du secret est le candidat de fix). À trancher avec les logs en main.

---

## Self-Review

- **Couverture spec** : #1 (Tasks 1,3,4 + item E) ✓ ; #1b (Task 7) ✓ ; #2 (Tasks 1,2) ✓ ; #3 (Tasks 5,6) ✓ ; #4 (Task 7) ✓ ; #5 baseline/restore (Task 6) ✓ ; qualité anti-tâtonnement (Tasks 3,8) ✓.
- **Dépendances** : Task 1 avant 9 (verrou) ; Task 3 (fillConfig fiable) avant l'interprétation de l'item E. Tasks 5/6/7/8 indépendantes entre elles.
- **Placeholders** : les Tasks 3, 5, 6, 8 laissent le corps d'implémentation à finaliser par lecture du fichier — c'est assumé : le comportement de test (le contrat) est spécifié, l'implémentation exacte se décide sur le code réel (posture TDD). Les Tasks 1, 2, 7 sont entièrement spécifiées.
- **Cohérence des noms** : `nvxUser`, `setConfig`, `fillConfig`, `writeStep`/`writeStepRx`, `setRxScenario`, `actionKey`, `loadLayout`, `readVar` — vérifiés contre les rapports d'investigation (fichier:ligne).
