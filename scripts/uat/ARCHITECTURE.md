# Architecture — outillage UAT (`scripts/uat/`)

> Source de vérité de l'outillage UAT du module Companion Crestron NVX.
> État : post-Phase 3 (registre de sous-systèmes + oracle transport pur + fake mono-rôle).
> Lis ce fichier AVANT de modifier le harness. Pour le module testé, voir `CLAUDE.md` racine.

## 1. Vue d'ensemble

Le harness exécute un **parcours (journey)** de bout en bout qui valide le module Companion
contre un appareil NVX — **réel** (labo) ou **fake** (local, hors-labo). Chaque étape (`JourneyStep`)
produit un `Verdict` (`PASS`/`FAIL`/`SKIP`/`AMBIGUOUS`/`HUMAN`). Le rapport est écrit, versionné,
et les cas non-PASS peuvent être escaladés à un agent (glue pure, voir `lib/escalate.ts`).

Le parcours s'appuie sur **4 outils-sondes** (`tools/`) :
- `companion-http.ts` — API REST Companion (connexions, statut, variables, press boutons). `HttpError` typé.
- `companion-logs.ts` — `docker logs --since` (détection de causes dans les logs du conteneur).
- `oracle.ts` — **vérité terrain de l'appareil** : lit/écrit le NVX directement, indépendamment de Companion.
- `chromium.ts` — Playwright (Chrome système) pour le peu d'UI Companion non scriptable en REST (config connexion).

Lancement : `npm run uat:fake` (offline) / `npm run uat:local` / profil `lab` (device réel).
Profils dans `profiles.ts` (encapsulent les flags d'env structurants).

### Carte des fichiers
```
journey/        run-journey.ts (entrypoint main/loadConfig/buildContext/runJourney)
                types.ts (JourneyConfig/Context/Step) · steps-local.ts (INSTALL + CFG offline)
                steps-lab.ts (assemble labSteps : auth gauntlet + specs encoder/decoder + teardown)
                subsystem.ts (contrat SubsystemSpec + 5 builders + gardes/poller partagés)
                subsystems/ encoder.ts · decoder.ts (specs déclaratifs) · streams-body.ts (builder CresNext "famille Streams")
tools/          companion-http · companion-logs · oracle · chromium · ensure-connection · nvx-client
lib/            verdict (5 états + factories) · case (HarnessConfig/RunResult) · report (markdown + escalation) · escalate (prompt LLM + merge)
fake-device/    server.ts (createFakeDevice : HTTPS, rejoue les RAW captures, routage par table, garde mono-rôle)
                scenarios.ts (RX/TX scenario → device state, pur)
```

## 2. Oracle = transport pur (Phase 3)

`oracle.ts` ne connaît **que** le transport HTTP NVX (login/get/post/logout via `NvxApiClient`).
API générique, **paramétrée par endpoint** :

| Méthode | Rôle |
|---------|------|
| `read(endpoint)` | GET endpoint → retourne `Device[<dernier-segment>]` **BRUT** (throw si absent). N'extrait RIEN au-delà. |
| `snapshot(endpoint)` | capture une baseline, **clé = endpoint** (Map interne). |
| `restore(endpoint, buildBodies)` | re-poste `buildBodies(baseline)` dans l'ordre ; `{skipped:true}` sans baseline. |
| `setRxScenario(scenario)` | POST `/_control/scenario` (route fake-only). |

**Invariant clé** : l'oracle ne contient **aucune** connaissance de `Streams[0]`, ni d'import de `src/panels`.
L'extraction (`Streams[0]` aujourd'hui ; `Outputs[0].Ports[0].Audio` pour l'audio v0.4) et la construction
des bodies de restore sont des **données du `SubsystemSpec`** (cf. §3). Un test de régression d'architecture
(`oracle.test.ts`) casse si un import `src/panels` réapparaît. C'est ce qui rend l'ajout d'un sous-système
futur (audio) **purement déclaratif**.

## 3. Registre `SubsystemSpec` + runner générique (Phase 3)

Le module testé possède déjà un registre+contrat (`src/panels/`). Le harness reproduit ce modèle.

**Contrat** (`subsystem.ts`) — chaque sous-système exporte un spec en **données** :
```
SubsystemSpec { id, role:'Transmitter'|'Receiver', endpoint,
                extract(subsystem)→objet comparé,   // ex. Streams[0]
                buildBodies(baseline)→bodies POST,   // séquence de restore
                writes: WriteCase[], vars: VarCheck[] }
```
`subsystems/encoder.ts` et `subsystems/decoder.ts` sont des specs déclaratifs. `buildBodies` y porte
la logique de restore (ex-`txBuilder`/`rxBuilder`, relocalisée depuis l'oracle).

**Runner** — 5 builders transforment un spec (+ métadonnées) en `JourneyStep`, en mutualisant
les gardes (`requireDevice`/rôle), le poller (`pollExtract`, fusion des 2 pollers Tx/Rx), et le
pattern press→poll→compare :
- `buildWriteStep(spec, writeCase)` — fusionne les 3 ex-factories ; gère le `scenario` fake-only
  (SKIP si `!isFake`) et l'ordre **`setRxScenario` AVANT `press`**.
- `buildCapStep` / `buildVarsStep` / `buildBaselineStep` / `buildTeardownStep`.

**Préservation du wording** : les builders acceptent des paramètres `titles` (objet `IssueTitles` :
step/pass/fail/skipRole/noDevice) et des `*Note` (passNote/skipNote/restoredNote/skippedNote/failNote)
pour reproduire à l'identique les titres/notes hétérogènes des steps historiques. ⚠️ Voir réserve §6.

**Assemblage explicite** — `labSteps` (`steps-lab.ts`) est assemblé **à la main**, PAS auto-émis,
car encoder et decoder ne sont pas symétriques :
- `BASELINE`(Tx) est **hors-bloc**, avant le bloc encoder ; `TEARDOWN`(Tx) est **global-dernier** ET
  désactive la connexion (`disableConnection:true`).
- `BASELINE-RX`/`TEARDOWN-RX` vivent **dans** le bloc decoder.
Ordre : `[...auth, BASELINE, CAP, ENC-VARS, ENC-FEEDBACKS, ...enc.writes, DEC-CAP, BASELINE-RX, DEC-VARS, ...dec.writes, TEARDOWN-RX, TEARDOWN]`.

**3 steps bespoke restants** (non spec-driven, à dessein) :
- `ENC-FEEDBACKS` — pas de jumeau decoder, check d'une seule variable ; rien à généraliser.
- `CFG-WRONGPASS` / `CFG-GOOD` — auth gauntlet, role-agnostiques (connexion, pas sous-système).
  `CFG-GOOD` prouve la session via `read('/Device/DeviceInfo')` (endpoint **role-neutre** — cf. §4/§6).

## 4. Fake-device : routage par table + garde mono-rôle (Phase 3)

`fake-device/server.ts` expose `createFakeDevice({rawDir,password})` → `{ handler }` (état en closure,
isolé par instance → testable, cf. `server.test.ts`). Le fake rejoue les **vraies captures** RAW
(`docs/hardware-validation/raw/<ip>/Device_*.json`) et mime le contrat auth + SetPartial de `src/api.ts`.

- **Routage par table** `SUBSYSTEMS` : `{ StreamTransmit:{state,apply,role:'Transmitter'}, StreamReceive:{…role:'Receiver'} }`.
  POST → applique par clé du body ; GET → `state()` table, sinon fallback `loadSub` (read-only role-agnostiques : DeviceInfo, DeviceSpecific…).
- **Garde mono-rôle** : `deriveFakeRole()` lit `DeviceSpecific.DeviceMode` (fail-fast si absent). Un vrai NVX
  est **mono-rôle** ; le fake refuse donc le sous-système du rôle opposé en **GET ET POST → 404 `<name> absent on <role>`**
  (ex. device Transmitter → StreamReceive 404), même si le RAW expose le fichier. Ferme une divergence bi-rôle latente.
  Les sous-systèmes role-agnostiques ne sont jamais gardés.

⚠️ Le fake valide le **câblage du harness contre notre MODÈLE** de l'appareil, pas le firmware. Il ne remplace
pas le gate UAT sur device réel.

## 5. Invariant golden (à préserver à chaque commit)

- `npm test` **vert** (filet unitaire ; le routeur du fake est désormais couvert par `server.test.ts`).
- `npm run uat:fake` (device Tx `.10`) → **12 PASS / 3 FAIL / 10 SKIP**.

⚠️ Ce golden encode des **conditions connues** (voir §6) :
- Les **3 FAIL** = ENC-NAME/ENC-MULTICAST/ENC-DISABLE (finding F-B, non résolu) — **attendus**.
- `CFG-NOPASS`/`CFG-WRONGPASS` sont **flaky** (F-A) → tolérés en `PASS` **ou** `AMBIGUOUS`.
Toute évolution de ces chiffres doit être **consciente** (un fix de F-A/F-B changera le golden).

## 6. Findings & dette connus

- **F-A — gauntlet CFG flaky.** Race sur la lecture des logs Docker (`companion-logs`) → la cause auth/conn
  n'est pas toujours observée à temps. Traité Phase 2 : verdict **AMBIGUOUS** sur `!logged` (non concluant),
  toléré. Pas un bug du module.

- **F-B — 3 ENC writes FAIL sur le fake (OUVERT).** Investigation sourcée (run `docs/uat-runs/2026-06-21#02`) :
  l'observed reste au **baseline RAW** (writes sans effet). **Ni bug du fake** (`applySetPartial` correct,
  verrouillé par `server.test.ts`) **ni bug du module** (action correcte, `Processing=False` → garde non
  déclenchée). Les boutons encodeur **existent et sont configurés** (page « Transmitter », connexion
  `nvx-fake-tx`, valeur `UAT-STREAM`). Le repointage du fixture (page 1→2) **a été tenté et réfuté** par un run :
  les writes via `nvx-fake-tx` ne se matérialisent pas sur le fake. **Cause exacte non établie côté outillage** ;
  validation = **labo / device réel**. ENC-ENABLE « passe » par coïncidence (Status RAW déjà `Stream started`).

- **Design-smell — double connexion.** La connexion **monitorée** par le journey (`nvx-uat`, éphémère :
  recréée/détruite à chaque run → id changeant) ≠ la connexion **d'écriture** liée aux boutons
  (`nvx-fake-tx`, persistante, car on ne peut pas lier un bouton à une connexion éphémère). Fonctionne pour
  les asserts via oracle (lecture device directe) mais fragile. À étudier hors Phase 3 (ex. journey utilisant
  une connexion stable `UAT_KEEP`). Lié à F-B.

- **Réserve d'audit — params de préservation du wording.** Les `IssueTitles` + 5 `*Note` (≈10 paramètres
  introduits Phase 3 pour reproduire les libellés historiques) sont des **candidats à simplification** si ces
  libellés ne sont pas contractuels (ils ne sont pas asservis par le golden, seulement par des tests unitaires).
  **Gate de validité de l'architecture** : l'audio v0.4 doit pouvoir s'ajouter en **1 fichier spec**
  (`subsystems/audio.ts`, `role:'Receiver'`, `extract`=Audio path, `buildBodies` propres) **sans toucher**
  l'oracle, le runner ni le fake. Si ce n'est pas le cas, revoir le contrat.

- **Reporté v0.4** : retrait du paramètre `tier` des factories de verdict ; ajout de `subsystems/audio.ts` (1er client réel du modèle).
