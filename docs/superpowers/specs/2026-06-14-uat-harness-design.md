# Harness UAT scriptable & déterministe — Design

**Date** : 2026-06-14
**Statut** : validé (brainstorming Didier)
**Portée** : outillage de test d'acceptation (UAT) du module Companion Crestron NVX — exécution rapide, reproductible et scriptable des scénarios de `docs/UAT.md`, avec fallback vers le `uat-runner` LLM.
**Branche** : `feature/uat-harness` (depuis `feature/v0.2-encoder` — le harness teste le code v0.2 et consomme ses scénarios UAT).
**Sources** : `docs/UAT.md` (scénarios, format, ordre), mémoire `rex-uat-scriptable` (REX du 1er run), `reference-uat-e2e-practices` (standards E2E/HIL), `scripts/capture-nvx.ts` (moule de script Node zéro-install).

---

## 1. Contexte & problème

Le 1er run UAT sur device réel (2026-06-12) via l'agent `uat-runner` en mode autonome Playwright s'est révélé **lent et fragile** : blocage avant A1, détour DB, fenêtres d'observation longues × N cas (REX `rex-uat-scriptable`). Or la majorité des scénarios `docs/UAT.md` testent la **logique du module** (auth, POST encodeur, mapping variables) contre le device — pas l'UI Companion. Ils sont donc **scriptables de façon déterministe**, rapide et lockout-sûre.

**Objectif** : un harness scriptable qui exécute les scénarios `[AUTO]` rapidement et de façon reproductible, croise l'état réel du device, et **escalade vers le `uat-runner` LLM** uniquement le résidu (échecs, cas ambigus, gestes humains).

**Décision directrice (Didier)** : concevoir les deux couches (logique + UI) ensemble ; **Playwright autorisé en devDependency** pour la couche UI (décision Zéro Installation actée par Didier).

---

## 2. Architecture — 3 tiers + fallback

| Tier | Outils | Couvre (réf `docs/UAT.md`) | Déterminisme |
|---|---|---|---|
| **0 — Logique** | `NvxApiClient` direct + GET device | A1/A2/A3 (auth-gauntlet, contrôle total des credentials) ; effet POST encodeur sur device (ENC-01/02/03) ; mapping variables sur JSON live (ENC-05 vs device) ; C2 (injoignable) ; C3 (logout) | ★★★ total |
| **1 — Intégration Companion** | HTTP API (`/api/location/.../press`, `/api/variable/<label>/<name>/value`, `/api/connections/:id/status`) + **Satellite TCP 16622** (couleur feedback résolue, `KEY-STATE`) | CAP-01 (statut+variables au connect) ; ENC-06 (feedbacks couleur) ; B1–B3 (variables via Companion) ; ENC-07 (heartbeat) | ★★☆ haut |
| **2 — UI config** | Playwright (librairie) | **couverture complète du formulaire de config DU MODULE** dans Companion (cf. §5 bis) | ★★☆ |
| **Fallback** | `uat-runner` LLM | `[HUMAN]` (C1 coupure physique) + tout cas `FAIL`/`AMBIGUOUS` remonté | n/a |

**Frontière** : le Tier 0 teste la *logique du module* (rapide, court-circuite Companion) ; le Tier 1 prouve le *câblage réel* Companion→module→device (un POST encodeur peut marcher en Tier 0 mais être mal relié à un bouton — capté seulement en Tier 1).

**Capacités d'observation sans navigateur** (vérifié, Companion v4.3.x — labo en v4.3.4) :
- Presser un bouton : `POST /api/location/<page>/<row>/<col>/press`.
- Lire une variable de module : `GET /api/variable/<label>/<name>/value` (v4.2+).
- Lire le statut de connexion : `GET /api/connections/:id/status` (v4.3.0+).
- Lire la **couleur de feedback résolue** : Satellite API TCP 16622 (`KEY-STATE` → COLOR/TEXT), seule surface l'exposant.
- Le navigateur (Playwright) n'est requis que pour l'**UI de configuration de Companion** (formulaire, états grisés) — pas pour l'état fonctionnel du module.

**Principes hérités** (REX + reference-uat-e2e-practices) :
- **Anti-faux-positif** : un `PASS` exige le **croisement device** (GET réel), jamais la seule variable Companion.
- **Lockout** : le Tier 0 **compte exactement** les logins (1 faux pour A2, jamais de retry — le harness ne boucle pas). Budget ~3 échecs (15 min/24 h) trivial à respecter.
- **Test d'absence** (pas de reconnexion, C3) : **proxy positif** (un marqueur/log prouvant que l'absence persistera), pas un simple « rien vu pendant 30 s ».

---

## 3. Orchestration d'un run & fallback LLM

**Entrée unique** `scripts/uat/run.ts` (moule `capture-nvx.ts` : env-vars + ts-resolver), respectant l'**ordre non négociable** de `docs/UAT.md` :

```
1. Tier 0 — auth-gauntlet (A1 vide → A2 faux → A3 bon)   ⟵ lockout-sensible, EN PREMIER
2. Tier 0/1 — lectures non destructives (variables, POST encodeur, feedbacks, statut)
3. Tier 2 — UI config (Playwright)
4. Tier 0 — disruptif EN DERNIER (C2 injoignable, C3 logout)
   → [HUMAN] (C1 coupure physique) jamais exécuté par le harness
```

**Modèle de verdict** — chaque cas (1 fonction → `Verdict`) produit :

| Verdict | Sens | Suite |
|---|---|---|
| `PASS` | assertion + croisement device OK | — |
| `FAIL` | assertion contredite (avec preuve) | escalade LLM (vrai bug ? ou limite harness ?) |
| `AMBIGUOUS` | le harness ne peut conclure (ex. POST inféré ENC-02/03, observation limite) | escalade LLM |
| `HUMAN` | exige un geste physique (`[HUMAN]`, C1) | escalade LLM mode assisté |
| `SKIP [-]` | précondition non remplie (ex. device en Receiver) | noté, non bloquant |

**Fallback piloté par le rapport (batch, pas inline)** :
1. Le harness scriptable tourne **jusqu'au bout** (le chemin rapide ne bloque jamais sur le LLM) et émet dans `docs/uat-runs/<date>-<version>/` :
   - `report.md` — lisible (format `docs/UAT.md` : verdict + preuve par cas) ; **rejouable sans Claude**.
   - `escalation.json` — paquet machine : cas `FAIL`/`AMBIGUOUS`/`HUMAN` **avec contexte complet** (précondition, action jouée, JSON device brut, réponses Companion, logs, attendu vs observé).
2. **Étape 2 optionnelle** : lancer le `uat-runner` LLM avec `escalation.json`. Il (a) re-juge les `FAIL`/`AMBIGUOUS`, (b) pilote en **assisté** les `[HUMAN]` (dicte les gestes, juge les observations opérateur), (c) traite les cas UI-config résiduels via Playwright MCP, puis **fusionne** ses verdicts dans `report.md`.

`AMBIGUOUS` est un verdict de **première classe** (pas un FAIL déguisé) : un POST inféré (ENC-02/03) qui « semble » marcher sans avoir été validé en écriture mérite l'œil du LLM + un `[HUMAN]` de confirmation, pas un faux PASS.

---

## 4. Configuration, secrets & bootstrap Companion (Tier 1)

**Secrets — séparation par tier** :

| Secret | Tier 0 (direct device) | Tier 1 (via Companion) |
|---|---|---|
| Mot de passe NVX | `NVX_PASS` (env, jamais commité) | **stocké dans Companion** (saisi 1 fois par l'opérateur) → le harness ne le voit jamais |
| Host/port device | `NVX_HOST` / `NVX_PORT` (env) — pour le GET de croisement | idem |
| Accès Companion | — | `COMPANION_URL` (défaut `http://localhost:8000`) + `COMPANION_API_KEY` optionnel |

Le Tier 1 n'a pas besoin du mot de passe NVX (Companion détient les credentials). Le secret le plus sensible reste en un seul endroit pour ce tier.

**Bootstrap Tier 1 — setup unique documenté, pas d'auto-magie** :
- L'API HTTP de Companion **ne crée pas** de connexion ni de boutons (seulement enable/disable/restart/status). Et **éditer `db.sqlite` en live est fragile/non supporté** (REX). → On assume un **setup opérateur unique, versionné**.
- **Fixtures committées (secret-free)** :
  - `uat/companion-page.companionconfig` — export d'une page Companion : boutons liés aux actions/feedbacks du module à des positions connues.
  - `uat/layout.json` — carte `action/feedback → page/row/col` + page de surface Satellite à observer + **label** de connexion attendu.
- **Runbook** `docs/uat-runs/SETUP.md` : importer la page, créer la connexion NVX au **label connu**, taper le mot de passe une fois.
- **Garde-fou de précondition** : avant le Tier 1, le harness vérifie via `GET /api/connections` que Companion répond + que la connexion au label existe (et résout son `id`). Sinon → cas Tier 1 en `SKIP [-]` avec message « lancer le setup unique » ; **jamais** de crash ni d'édition DB.

**Décision de périmètre (REX)** : l'**auth-gauntlet (A1/A2/A3) est Tier 0 uniquement** (direct device). On ne le rejoue pas via l'UI Companion (fragile, et ça testerait Companion, pas le module).

---

## 5. Structure de code, runner & reporting

```
scripts/uat/
├── run.ts                  # orchestrateur (entrée unique, env-driven, ordre UAT.md)
├── lib/
│   ├── verdict.ts          # modèle PASS/FAIL/AMBIGUOUS/HUMAN/SKIP + helpers d'assertion
│   ├── report.ts           # émetteurs report.md + escalation.json
│   ├── companion-http.ts   # client HTTP /api/... (press, variable, connections/status)
│   └── satellite-client.ts # client TCP Satellite natif (net.Socket → parse KEY-STATE)
├── tiers/{tier0-logic,tier1-companion,tier2-ui}.ts
└── cases/{auth,encoder,…}.ts   # définitions de cas (1 cas = fn → Verdict)
uat/
├── layout.json             # committé, secret-free : button-map + label connexion
└── companion-page.companionconfig   # committé : export page Companion
docs/uat-runs/
├── SETUP.md                # runbook setup unique opérateur
└── <date>-<version>/{report.md, escalation.json}
```

**Runner & reporting** :
- **Orchestrateur dédié, pas `node:test`** : l'ordre strict (gauntlet séquentiel lockout-sensible), le contrôle des credentials et le **rapport unifié cross-tier** ne rentrent pas dans le modèle parallèle de `node:test`. `run.ts` est un script (moule `capture-nvx.ts`) ; chaque cas est une fonction → `Verdict`, séquencée dans l'ordre UAT.md.
- **Playwright en librairie** (`import { chromium } from 'playwright'`), **pas `@playwright/test`** → un seul orchestrateur, un seul rapport.
- **Lancement** : `node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs scripts/uat/run.ts` + npm scripts `uat`, `uat:tier0`. Playwright (devDep) + `npx playwright install` = partie du setup.
- **Reporting** : `report.md` (humain, format UAT.md) + `escalation.json` (machine). JUnit/Allure différés (gate Zéro Installation ; cf. reference-uat-e2e-practices).
- **Le harness teste le harness** : `verdict.ts`, `report.ts`, le parser `satellite-client` (sur frames capturées) sont unit-testables `node:test` sur fixtures, **sans device**.

---

## 5 bis. Tier 2 — couverture complète du formulaire de config (Playwright)

Périmètre = **le formulaire de configuration DU MODULE** (les 8 champs déclarés dans `src/config.ts:getConfigFields`), pas l'UI générique de Companion. Companion tourne **en local** (image `ghcr.io/bitfocus/companion/companion` présente sur la machine) — ce tier ne dépend **pas** du labo.

| Cas | Vérifie |
|---|---|
| **UI-01** | Les 8 champs s'affichent avec type/label corrects : `info` (static-text), `host` (textinput), `port` (number), `username` (textinput), `password` (secret-text), `pollInterval` (number), `ignoreSelfSignedCert` (checkbox), `verbose` (checkbox). |
| **UI-02** | `password` est un champ **secret masqué** (canal `secrets`, jamais rendu en clair) — non-régression du « Bug A » (cf. `sdk-companion`). |
| **UI-03** | Bornes des `number` appliquées par l'UI : `port` ∈ [1, 65535], `pollInterval` ∈ [500, 30000]. |
| **UI-04** | Valeurs par défaut pré-remplies : `port=443`, `username=admin`, `pollInterval=2000`, `ignoreSelfSignedCert` coché, `verbose` décoché. |
| **UI-05** | Persistance : les valeurs sauvegardées sont re-pré-remplies à la ré-ouverture de la config. |
| **UI-06** | Contrainte REX : config **non éditable quand l'instance est `disabled`** — documenter/vérifier le comportement (impacte la mise en scène UAT). |

**Hors périmètre Tier 2** : le comportement générique de l'UI Companion (layout, navigation) — on teste **notre module**, pas Companion.

---

## 6. Jalons d'implémentation

| Vague | Contenu | Dépend de | Valeur |
|---|---|---|---|
| **1 — Fondation** | verdict model + report (md+json) + squelette orchestrateur (ordre, config env, registre de cas) | rien (zéro install, zéro device) | socle testable |
| **2 — Tier 0** | auth-gauntlet + POST encodeur + mapping variables + C2/C3 via `NvxApiClient` | Vague 1 | **ROI immédiat** : tue le gauntlet LLM lent, zéro install |
| **3 — Tier 1** | `companion-http` + `satellite-client` + cas intégration (CAP-01, ENC-06 couleur, B-reads) | Companion qui tourne + fixture layout | preuve de câblage |
| **4 — Tier 2 + escalade** | cas Playwright UI-config + glue `escalation.json` → `uat-runner` + fusion rapport | Playwright + uat-runner | UI + boucle LLM |

Chaque vague = logiciel livrable et testable. **Vagues 1+2 délivrent l'essentiel du ROI sans Companion ni Playwright** (zéro install) ; 3-4 ajoutent l'intégration et l'UI.

---

## 7. Décisions validées

1. Architecture **3 tiers** (logique directe / intégration API Companion / UI Playwright) + **fallback LLM batch**.
2. **Playwright en devDependency** autorisé (décision Zéro Installation de Didier).
3. **Fallback piloté par le rapport** (`escalation.json`), pas inline — le chemin rapide reste pur.
4. **Auth-gauntlet en Tier 0 uniquement** (direct device).
5. **Setup Companion unique documenté** + fixtures committées ; jamais d'édition `db.sqlite` live ; garde-fou `SKIP`.
6. **Orchestrateur dédié** (pas `node:test`) + **Playwright en librairie** (pas `@playwright/test`) → run + rapport unifiés.

---

## 8. Hors périmètre / à confirmer

- **Reporting riche** (Allure, JUnit XML) : différé (Zéro Installation). `report.md` markdown suffit en v1.
- **Auto-setup de l'instance Companion** : non supporté par l'API → exclu (setup opérateur unique à la place).
- **Authentification de l'API HTTP Companion** : à vérifier en **local** (image Companion présente sur la machine — **non dépendant du labo**) en démarrant le conteneur au début de la Vague 3. `COMPANION_API_KEY` prévu en option si l'API exige une clé.
- **Détail du protocole Satellite** (séquence `ADD-DEVICE`, navigation de pages, parsing `KEY-STATE`) : à figer au plan d'implémentation (Vague 3) ; le parser est unit-testable sur frames capturées.
- **Cas Tier 2** : **résolus** — couverture complète du formulaire de config du module (UI-01..06, cf. §5 bis). « Tout tester » = tous nos champs de config + masquage secret + pièges REX.
