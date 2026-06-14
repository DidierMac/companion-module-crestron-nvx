# Wave 0 — Découvertes (Companion 4.3.4 local, 2026-06-14)

Capturé en **lecture seule** contre le Companion compose (`companion-nvx-companion-1`, port 8000) qui a 3 connexions NVX réelles en erreur (devices labo injoignables) — données réelles parfaites.

## 1. `GET /api/connections` — le statut est INLINE ✅

Renvoie un **tableau** d'objets ; chaque connexion porte **déjà son statut** :
```json
{
  "id": "jUFq3QSEiZOsg6uRoF7yc",
  "label": "Crestron_NVX_Receiver",
  "moduleId": "crestron-nvx",
  "enabled": true,
  "status": { "category": "error", "level": "Connection Failure", "message": "NVX timeout: GET /userlogin.html" }
}
```
→ **un seul appel donne id + label + statut.** `findConnectionId(label)` ET le statut viennent de là.

## 2. `GET /api/connections/:id/status` — statut NESTED sous `.status`

```json
{ "id": "...", "label": "...", "enabled": true, "status": { "category": "...", "level": "...", "message": "..." } }
```
⚠️ **Refinement pour `companion-http.ts`** : `status()` doit lire `response.status` (objet imbriqué), PAS un objet plat. `ConnectionStatus = { category, level, message }`.

### Catégories/niveaux observés
- `category: "error"` · `level: "Connection Failure"` · `message: "NVX timeout: GET /userlogin.html"` (IP injoignable — c'est NOTRE message module).
- À voir aux états restants (labo / autres configs) : `ok` · `warning` (bad_config / auth_failure — cf. [[sdk-companion]] : auth = warning par design) · `disabled`. **Le `message` reflète la cause vue par le module** → le statut REST porte déjà une partie de la cause (les logs donnent le détail `[AUTH]`/`[CONN]`).

## 3. Corrélation des logs — `docker logs --since <ISO-Z>` ✅

- Horloge conteneur == hôte (aucun décalage). Timestamp docker (`-t`) == timestamp embarqué de l'app.
- **`docker logs --since "<new Date().toISOString()>" <conteneur>`** renvoie uniquement les lignes ≥ mark. ⚠️ **le suffixe `Z` (UTC) est OBLIGATOIRE** — un timestamp sans `Z` est interprété en fuseau ambigu et élargit la fenêtre (piège rencontré et résolu). `new Date().toISOString()` produit le `Z` → le code du plan (`CompanionLogs.mark`) est correct.
- Filtrer ensuite par `label` + préfixe `[AUTH]/[CONN]/[HTTP]/[POLL]/[INIT]` (grep). Exemple réel :
  `… Instance/Connection/Crestron_NVX_Receiver [CONN] Connection failed (192.168.2.9): NVX timeout: GET /userlogin.html`
- Conteneur : `companion-nvx-companion-1` (compose). Pour les runs UAT isolés : un `companion-uat` dédié (nom configurable via `COMPANION_CONTAINER`).

## 4. Sélecteurs du formulaire de config (Chromium) — FLUX cartographié, locators précis → Vague 1 Task 1.4

Exploration Playwright (Chrome système, `companion-uat` isolé sur :8001) — **flux de navigation appris** (reste à finaliser les locators du formulaire au moment d'écrire `chromium.ts`) :

1. **Séquence de modales d'onboarding** (Companion frais) à dismisser dans l'ordre :
   - **« Welcome to Companion »** (wizard) → bouton **Cancel**.
   - **« What's New in Companion »** → **bouton X (coin haut-droit)** — ⚠️ ne se ferme PAS sur Escape ni Cancel ; cibler le X spécifiquement (c'était le blocage de l'exploration Wave 0).
2. **Add connection** : champ de recherche (`placeholder "Search ..."`) → taper « NVX » → résultat **« Crestron: DM-NVX-350; DM-NVX-351; DM-NVX-363; DM-NVX-E50 »** (= notre module crestron-nvx) avec un bouton **Add** sur la ligne.
3. Cliquer **Add** → le formulaire de config apparaît (host/port/username/password/poll/verbose, cf. `src/config.ts`).

**À finaliser en Task 1.4** : une fois le formulaire atteint, capturer la stratégie de locators. `getByLabel(...)` a renvoyé 0 (mais le form n'avait pas été atteint — non concluant) ; plan B confirmé par le dry-run 2026-06-11 (mémoire) = **pas de `data-testid` ni d'association label/for** → cibler par **texte de label → input adjacent** (`label:has-text(...) + input` ou `locator('label').filter(...).locator('xpath=following::input[1]')`). Champs (labels exacts depuis `config.ts`) : « Device IP / Hostname », « HTTPS Port », « Username », « Password », « Poll Interval (ms) », « Ignore Self-Signed Certificate », « Enable verbose logging ».

## 5. Task 2.3 — VÉRIFIÉ LIVE contre Companion 4.3.4 (`companion-nvx-companion-1`, :8000, 2026-06-14)

Run `npm run uat:journey` → **3/3 PASS** (INSTALL, CFG-NOPASS, CFG-UNREACHABLE) contre le vrai Companion. Hypothèses Wave 0 toutes réfutées-survivantes :

- **Modal d'onboarding** : en contexte `playwright-core` frais (≠ profil MCP onboardé), **seul « What's New »** apparaît, **~3 s APRÈS `domcontentloaded`** (rendu React). Bouton de fermeture = `<button class="btn btn-close" aria-label="Close">` → sélecteur `.modal.show .btn-close, button[aria-label="Close"]`. ⚠️ Le `dismissOnboarding` doit **poller** (le modal arrive tard) et **re-dismisser après chaque `page.goto`** (un rechargement complet le réaffiche).
- **Création connexion** : Add → modale « Add Crestron: … » avec champ Label (`input[name="colFormLabel"]`) → renommer → bouton **Add**. La connexion s'ouvre en deep-link **`/connections/<id>`** (le form de config y est directement accessible).
- **Locators du formulaire = VÉRIFIÉS** : inputs **sans name/id/placeholder**, labels = `<div>` (pas `<label for>`) → `getByLabel`=0. Stratégie qui marche : **`//*[normalize-space(text())="<label>"]/following::input[1]`** (nœud-feuille → input suivant en ordre documentaire ; `following::` exclut les descendants). Vérifié pour host/port/username/password/poll.
- **Sauvegarde** : pas de bouton « Save » permanent. Sans changement → Save **disabled** + « Done ». Après un changement de champ → Save **enabled** + « Cancel ». Donc `fillConfig` clique Save **seulement si `isEnabled()`**.
- **INSTALL** : `getByText('DM-NVX')` → `count()>0` (présence DOM), **PAS** `isVisible()` (la plupart des matches sont dans la sidebar Variables repliée = cachés). Si le module était absent, le label « DM-NVX » ne se rendrait pas (« Unknown module »).
- **Statut BadConfig (no-password)** : `category: "warning"` (hypothèse Wave 0 **confirmée**) · log `[CONN] No password configured — not attempting login` (immédiat, sans réseau).
- **Timing logs après `restart` REST** : `category` reste `error`/`warning` immédiatement (sticky), mais la **ligne de preuve** `[CONN]/[HTTP]` arrive **~5 s** après (timeout NVX). → le step **poll le log** (15×1 s) ; le `sleep` est injecté dans `JourneyContext` (réel en prod, no-op en test).
- **Connexion `nvx-uat` créée** dans le Companion compose (id `PrAb-tXh4zXbVP5oharQc`) — connexion de test dédiée, persiste pour les runs suivants (teardown en Wave 3).
