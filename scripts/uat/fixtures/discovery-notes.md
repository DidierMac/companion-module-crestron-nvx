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

## 4. Sélecteurs du formulaire de config (Chromium) — ⏳ À CAPTURER

Reste à faire : ouvrir le formulaire de config d'une connexion via Playwright (Chrome système) et noter les locators (rôle/texte/`title`/label-adjacent) pour : input **host**, input **username**, input **password** (secret), bouton **Save**, badge de **statut**. Pas de `data-testid` (cf. gotchas dry-run 2026-06-11 en mémoire). À faire contre un `companion-uat` isolé (ne pas modifier la config compose de Didier).
