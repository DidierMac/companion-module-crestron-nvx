# Harness UAT — parcours utilisateur & 4 outils — Design

**Date** : 2026-06-14 (révisé — remplace la version « 3 tiers par couche technique »)
**Statut** : validé (brainstorming Didier)
**Portée** : tester **le module Crestron NVX** en rejouant le **parcours d'un utilisateur** (installer → connecter → configurer → utiliser → teardown), happy path complet **et** tous les échecs normaux, via 4 outils complémentaires.
**Branche** : `feature/uat-harness` (depuis `feature/v0.2-encoder`).
**Sources** : `docs/UAT.md`, `docs/debugging.md`, mémoire `rex-uat-scriptable` + `reference-companion-automation-api`, code existant `src/api.ts` (oracle) + socle `scripts/uat/` (Vague 1).

---

## 1. Contexte & objectif

**Objectif : tester LE MODULE comme un utilisateur l'utilise.** On exécute le parcours réel — installer le module dans Companion, créer une connexion, la paramétrer, s'en servir — et à **chaque étape on teste aussi les échecs attendus** (pas de mot de passe, mot de passe erroné, appareil injoignable). « Ne louper aucun test » : le happy path **et** chaque cas d'échec normal.

**Pourquoi ce redesign** : la version précédente s'organisait par **couche technique** (Tier 0 logique / Tier 1 API / Tier 2 UI). Le « Tier 0 » testait le module **en court-circuitant Companion** — utile pour la vitesse, mais **ce n'est pas le parcours utilisateur** (l'utilisateur ne touche jamais le device en direct). On réorganise donc **par parcours**, et le device en direct devient un **oracle de vérité terrain**, pas une couche de pilotage.

---

## 2. Les 4 outils (rôles uniques, tous vérifiés en local 2026-06-14)

| # | Outil | Mécanisme (vérifié) | Rôle |
|---|---|---|---|
| 1 | **REST API Companion** | `localhost:8000/api/…` | **Pilote + observe Companion.** `GET /api/connections` (résoudre l'`id` par `label`) · `GET /api/connections/:id/status` (`ok`/`warning`/`error`/`disabled` + message) · `POST /api/connections/:id/{enable,disable,restart}` · `GET /api/variable/<label>/<name>/value` · `POST /api/location/<p>/<r>/<c>/press`. **Ne crée/configure PAS une connexion.** Usage maximal. |
| 2 | **Logs Companion** | **`docker logs <conteneur>`** (stdout) ou `/companion/logs/` (volume) — **pas** d'endpoint REST (`/api/log*` → 404) | **Prouve la DÉTECTION d'erreur.** Grep par `label` + préfixe `[AUTH]/[CONN]/[HTTP]/[POLL]/[INIT]`. Un statut peut être bon par hasard ; le log prouve que le module a vu la **bonne cause** (ex. `[CONN] Connection failed … NVX timeout`). |
| 3 | **REST device (oracle)** | `NvxApiClient` (réutilisé de `src/api.ts`), GET sur le device | **Vérité terrain.** Baseline au début, vérification continue (anti-faux-positif), restauration au teardown. |
| 4 | **Chromium** | Playwright (`playwright-core`, GLOBAL + `npm link`) + **Google Chrome système** (`channel:'chrome'`) | **L'irréductible UX** que REST ne peut pas faire : installer le module (le voir dans *Modules*), **créer** une connexion, **remplir le formulaire** (host/user/password). |

**Principe** : on utilise au **maximum REST API Companion** ; on lit les **logs** quand on cherche une erreur ; on interroge le **device** quand on valide une modification ; on n'ouvre **Chromium** que pour l'irréductible (install + saisie config).

---

## 3. Le parcours (v0.1 = fondation traversée · **v0.2 Encoder = cœur du test**)

```
1. INSTALL                Chromium : le module crestron-nvx apparaît dans Companion (Modules)
2. CONFIG + GAUNTLET      Chromium remplit le formulaire · REST lit le statut · LOG vérifie la détection
     • pas de mdp     → statut BadConfig             + log « no password » (zéro réseau)
     • IP injoignable → statut ConnectionFailure     + log « [CONN] … NVX timeout »
     • mdp erroné     → statut AuthenticationFailure + log « [AUTH] … 401/403 »
     • bon + bonne IP → statut OK                    + ORACLE confirme la session côté device
3. BASELINE               Oracle : snapshot de l'état device de départ (détection de changement + restauration)
4. USE = v0.2 ENCODER     REST presse · ORACLE valide · REST lit variables/statut · LOG vérifie StatusId
     • CAP : device_role=Transmitter (REST /api/variable) → panneau encoder actif (actions exposées)
     • set_stream_name / set_multicast_address → ORACLE : Streams[0] changé ; LOG : StatusId 0
     • enable_stream / disable_stream → ORACLE : Status « Stream started/Stopped » (transition)
     • feedbacks is_encoder / stream_enabled / stream_name_matches ; variables stream_*
     • edge v0.2 : device en Receiver → panneau encoder ABSENT (correct, pas un échec)
5. TEARDOWN               Oracle restaure l'état device · REST/Chromium désactive la connexion · logout émis
```

**Extensible** : v0.3 Decoder, etc. réutilisent les phases 1-3 et 5 ; seule la phase 4 (USE) change de sous-système.

---

## 4. Modèle de verdict, oracle, reporting (réutilise le socle Vague 1)

- **Verdict par étape** : `PASS` / `FAIL` / `AMBIGUOUS` / `HUMAN` / `SKIP` (inchangé, `scripts/uat/lib/verdict.ts`).
- **Oracle (device)** :
  1. **Baseline** au début du parcours (snapshot `StreamTransmit` etc.).
  2. **Vérif continue** : après chaque action via Companion, comparer device-maintenant vs attendu (jamais la seule variable Companion — anti-faux-positif).
  3. **Restauration** au teardown (run idempotent, rejouable).
- **Vérification d'une erreur attendue = TRIPLE** : (a) statut Companion (REST) = l'état attendu ; (b) **log** Companion = la bonne cause détectée ; (c) le cas échéant, l'oracle confirme (ex. « bon mdp → une session existe vraiment »). Le log distingue « bon statut par hasard » de « bonne cause détectée ».
- **Reporting** : `report.md` + `escalation.json` (`scripts/uat/lib/report.ts`, avec `redact()` anti-fuite secret). Les cas `FAIL`/`AMBIGUOUS`/`HUMAN` escaladés au `uat-runner` LLM (fallback batch inchangé).
- **Lecture des logs corrélée** : avant une action, **mémoriser la position courante du log** (timestamp/nb de lignes) ; après l'action, ne lire que les **nouvelles** lignes du `label` concerné → évite de capter un log d'un run précédent.

---

## 5. Local vs labo (réalité du device)

| Étape | Local (Companion seul) | Labo (device requis) |
|---|---|---|
| 1. Install | ✅ | |
| 2a. pas de mdp → BadConfig | ✅ (garde pure, zéro réseau) | |
| 2b. IP injoignable → ConnectionFailure | ✅ (IP TEST-NET `192.0.2.1` → timeout — déjà observé live) | |
| 2c. mdp erroné → AuthenticationFailure | | ✅ (exige un device **joignable qui rejette** → 401/403) |
| 2d. bon mdp → OK | | ✅ |
| 3-4. Baseline + USE v0.2 | | ✅ (device Transmitter) |
| 5. Teardown | partiel (désactiver/logout) | restauration device au labo |

**Un seul parcours**, chaque étape marquée local/labo. Le sous-ensemble **local** (install + config + 2 échecs sur 3) est exécutable et rejouable **maintenant** ; le reste s'exécute au créneau labo.

**Discipline lockout** : seul **2c (mdp erroné)** consomme du budget (1 échec) — et le module ne retente pas sur `AuthenticationFailure` (tracé `api.ts`), donc **exactement 1 échec**. À jouer une seule fois, device en main.

---

## 6. Ce qui est réutilisé / ce qui change

**Réutilisé** (rien jeté) :
- Socle Vague 1 : `verdict.ts`, `report.ts` (+`redact()`), orchestrateur, hook test/pretest.
- `NvxApiClient` (`src/api.ts`) → devient le **client oracle** (lecture device).
- Le smoke Chromium (`playwright-core` + `channel:'chrome'`) → base de la couche Chromium.
- Les « cas » A1/A2/A3/ENC de la Vague 2 → **ré-exprimés en étapes du parcours** (la logique reste, l'orchestration change : via Companion, plus en court-circuit).

**Ce qui change vs la version « 3 tiers »** :
- Plus de « Tier 0 bypass-Companion » comme couche : le device en direct n'est plus un *chemin de test* mais un *oracle*.
- Nouvel outil **logs** (via `docker logs`) — vérification de la détection d'erreur.
- Nouvelle couche **Companion HTTP** centrée sur `/api/connections/:id/status` (statut/alerte sans navigateur).
- Le parcours remplace les « tiers » comme unité d'organisation.

---

## 7. Décisions validées

1. **Objectif = tester le module via le parcours utilisateur** (install → config → use → teardown), happy + échecs normaux.
2. **4 outils complémentaires** : REST API Companion (max) · logs (`docker logs`, détection d'erreur) · REST device (oracle : baseline/vérif/restauration) · Chromium (Google Chrome via Playwright, install+config seulement).
3. **Statut/alerte lu en REST** (`/api/connections/:id/status`) → Chromium réduit à l'irréductible.
4. **v0.2 Encoder = cœur de la phase USE** (v0.1 = fondation traversée). Extensible v0.3+.
5. **Oracle device** : baseline au début, vérif continue anti-faux-positif, restauration au teardown.
6. **Sous-ensemble local exécutable maintenant** (install + config + 2 échecs) ; happy path complet au labo.

---

## 8. Hors périmètre / à confirmer (découvertes Vague 1 du plan)

- **Forme JSON exacte de `/api/connections/:id/status`** (statut + message) : à confirmer en live (endpoint présent).
- **Sélecteurs du formulaire de config** (Chromium) : pas de `data-testid` dans Companion → POM par rôle/texte/`title` (gotchas du dry-run 2026-06-11 en mémoire) ; cibler les inputs par label → champ adjacent.
- **Lecture des logs** : `docker logs <conteneur>` confirmé ; nom du conteneur/service compose **configurable** (le harness lance une commande docker — dépendance assumée à l'accès Docker local).
- **Frames Satellite `KEY-STATE`** (couleur de feedback résolue) : à capturer si on veut vérifier la couleur d'un feedback côté UI ; sinon les feedbacks se valident via leur effet (variables/état) + l'oracle.
- **Création/config de connexion via Chromium** : reprend le REX (config éditable, création de connexion neuve évite le piège « vider un mdp stocké »).
- **Reporting riche** (Allure/JUnit) : différé. `report.md` + `escalation.json` suffisent.
