# Backlog de validation — issu de la session 2026-06-14

> Tout ce qui a été **codé ou conçu** durant la session mais reste **non vérifié sur le réel**.
> Source de vérité des scénarios : `docs/UAT.md`. Ce fichier est l'**index consolidé** + les items hors-UAT.
> Convention : `[ ]` à valider · `[x]` validé · `[~]` partiel/douteux · `[-]` non testable ce créneau.

---

## A. v0.2 Encoder — validation au labo (device NVX requis)

> Code complet sur `feature/v0.2-encoder` (13 commits), **non testé sur device**. Détail des cas : `docs/UAT.md` §v0.2.
> ⛔ **GATE (feedback-delivery-gate)** : aucun merge de v0.2 sur `develop` sans ces validations.

- [ ] **Précondition** — device en mode **Transmitter** (réglé via UI native ; le module v0.2 ne bascule pas le mode). ⚠️ L'« Environnement de test » de `docs/UAT.md` liste l'IP `.9` (un Receiver dans les fixtures) → trancher au labo : autre device, ou basculer `.9` en Transmitter.
- [ ] **CAP-01** — détection capability/role au connect → activation du panneau encoder (`device_role=Transmitter` + actions/variables/feedbacks exposés).
- [ ] **ENC-01** — `set_stream_name` → `RtspSessionName` changé **réellement** (cross-check GET device). *Seul POST testé end-to-end au gate.*
- [ ] **ENC-02** — `set_multicast_address` → **POST INFÉRÉ** (jamais validé en écriture au gate). Le run doit **confirmer ou infirmer**.
- [ ] **ENC-03** — `enable_stream`/`disable_stream` → **POST double-flag** (`{Start:true, Stop:false}` / `{Start:false, Stop:true}`). Confirmer/infirmer (1) la transition `Status` et (2) la sûreté du double-flag pour éviter le latch `Stop` observé au labo 2026-06-16.
- [ ] **ENC-05** — variables encoder (`stream_name`/`multicast_address`/`encoder_url`/`stream_enabled`) = état réel device.
- [ ] **ENC-06** — feedbacks `is_encoder` / `stream_enabled` / `stream_name_matches` (dont le cas faux pour `stream_name_matches`).
- [ ] **ENC-07** — non-régression v0.1 : heartbeat (Phase B complète) + `scheduleReconnect` (un C1) intacts après la migration `poll()`.
- [ ] **Mode-switch reboot** (reporté v0.5) — NON couvert v0.2 ; à valider quand l'action de bascule existera (`StatusId 1` = reboot).

## B. Harness UAT — découvertes empiriques (Vague 3, Companion local)

> Items que le plan `docs/superpowers/plans/2026-06-14-uat-harness.md` (Task 9) impose de **capturer avant** d'écrire le code dépendant. Companion tourne en local (image présente) — **pas besoin du labo**.

- [x] **Auth de l'API HTTP Companion** — ✅ **OUVERTE, aucune clé** (testé live, Companion 4.3.4 local : `GET /api/connections` → `[]` HTTP 200).
- [ ] **Format exact des frames Satellite `KEY-STATE`** — capturer (séquence `ADD-DEVICE`, tokens COLOR/TEXT) ; le parser Tier 1 s'écrit **contre la capture**, pas contre la doc.
- [~] **Forme JSON de `/api/connections`** — endpoint OK (`[]` sans connexion) ; forme avec instance à voir une fois une connexion créée.
- [x] **Endpoints HTTP confirmés** — ✅ live : `POST /api/location/1/0/0/press` → 204 ; `GET /api/variable/internal/time_hms/value` → 200 ; `GET /api/connections` → 200. (`:id/status` à confirmer avec une connexion.)
- [ ] **Sélecteurs DOM Tier 2** — formulaire de config du module (role/text/title, pas de data-testid dans Companion) pour UI-01..06.

### Découvertes live (2026-06-14) — recette SETUP.md Vague 3
- **Chargement du module en dev** (vérifié) : `docker run -d --name companion-uat -p 8000:8000 -v <repo>:/extra-modules/crestron-nvx ghcr.io/bitfocus/companion/companion:latest --extra-module-path /extra-modules` → logs « Connection: crestron-nvx … (Dev) ». Le flag est **`--extra-module-path <dir>`** (dir contenant les dossiers de modules). Module id = `crestron-nvx`.
- **Navigateur Tier 2 sans téléchargement** (vérifié) : `playwright-core` (installé **global** par Didier, lié au projet via `npm link` — PAS en devDep) + `chromium.launch({ channel: 'chrome' })` → pilote le Google Chrome système (149). Ouvre l'UI Companion (titre « Bitfocus Companion - Admin »). ⚠️ Le harness Tier 2 (`import 'playwright-core'`) suppose ce global+link sur la machine ; à documenter pour autre dev/CI.
- **Conteneur** `companion-uat` laissé tournant (port 8000). **2 vulnérabilités npm « high »** dans l'arbre `playwright-core` (global) — à regarder à froid, pas de `audit fix --force`.

## C. Harness UAT — à valider au 1er run réel (device + Companion)

> Le harness (Vagues 1-2, `feature/uat-harness`) est codé + testé unitairement (66 tests verts), mais jamais exécuté contre un vrai device.

- [ ] **Lockout A2** — tracé sûr dans `api.ts` (1 seul POST credentials, pas de retry), mais **confirmer empiriquement** : 1 seul échec consommé sur le device réel.
- [ ] **Restauration device** — après ENC-01/02/03, vérifier que le `finally` a bien restauré nom/multicast/état initial (device propre en fin de run).
- [ ] **Divergence session §151** (1 login/cas, assumée) — confirmer 0 verrouillage sur un run complet (bons logins gratuits).
- [ ] **C2** — host injoignable → échec rapide réel (~timeout) sans force-restart du module.
- [ ] **C3** — `logout()` émis + aucune reconnexion fantôme.
- [ ] **Escalade LLM** — un run avec FAIL/AMBIGUOUS/HUMAN → `escalation.json` non vide → handoff `uat-runner` (Vague 4).

## D. Dette & décisions différées (à reprendre, pas à valider au labo)

- [ ] **upgradeScripts** — supprimé (inerte) ; **réintroduire** (`export { UpgradeScripts }`, casse majuscule) au **1er breaking-change** de structure de config. Convention documentée dans `src/main.ts`.
- [ ] **Reporting riche** (Allure / JUnit XML) — différé (Zéro Installation) ; `report.md` markdown suffit en v1.
- [ ] **Vagues 3-4 du harness** — Tier 1 (Companion API + Satellite), Tier 2 (Playwright, devDep approuvée), escalade LLM. Plan = `docs/superpowers/plans/2026-06-14-uat-harness.md` Tasks 9-16.

---

## Pointeurs

- Scénarios UAT détaillés : `docs/UAT.md`
- Données réelles de référence : `docs/hardware-validation.md` (+ fixtures `docs/hardware-validation/raw/`)
- Spec architecture v0.2 : `docs/superpowers/specs/2026-06-12-module-capability-architecture-design.md`
- Spec + plan harness : `docs/superpowers/specs/2026-06-14-uat-harness-design.md` · `docs/superpowers/plans/2026-06-14-uat-harness.md`
- Runbook setup Tier 1 (à écrire en Vague 3) : `docs/uat-runs/SETUP.md`
