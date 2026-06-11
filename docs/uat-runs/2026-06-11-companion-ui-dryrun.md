# UAT Dry-Run — Pilotage UI Companion en autonome (Playwright MCP)

> **Type** : DRY-RUN exploratoire. **Pas un run de validation réel** — le journal de `docs/UAT.md` n'est PAS modifié.
> **Date** : 2026-06-11 · **Companion** : v4.3.4 (Docker local, http://localhost:8000) · **Module NVX** : version « Dev ».
> **Device** : DM-NVX-360 (192.168.2.9) **au labo, NON joignable aujourd'hui** → cas auth/heartbeat marqués `[-]`.
> **Outils** : Playwright MCP (`browser_navigate/snapshot/click/type/evaluate/hover/take_screenshot/close`).

## Objectifs

1. **Faisabilité A** : prouver que l'agent peut piloter l'UI Companion en autonome (naviguer, trouver une instance, lire le badge de statut, l'onglet Variables, l'onglet Log).
2. **Capturer les selectors DOM réels** pour un futur Page Object Model (POM) Playwright, Option B.

## Méthode & sécurité

- **Aucune action sur l'instance réelle `Crestron_NVX`** : elle est restée **désactivée** du début à la fin (jamais activée → 0 appel réseau, 0 tentative d'auth, budget lockout intact). Vérifié en fin de run : `enabled=false`, icône `power-off` grise, toggle « Enable connection ».
- **Instance jetable créée** : `UAT_DRYRUN_DISPOSABLE` (ID `Xya40uN-3L5miSfYderSF`), pointée vers **192.0.2.1 (TEST-NET, injoignable)** avec user/password **bidon**. Injoignable = **timeout réseau**, jamais d'auth → 0 risque de lockout. **Supprimée en fin de run** (vérifié : seule `Crestron_NVX` subsiste).

---

## 1. Faisabilité A — cas UAT v0.1 pilotables en autonome

Verdict de **pilotabilité** (≠ verdict PASS/FAIL ; ici on évalue seulement si l'agent peut conduire le cas via l'UI, et ce que le device manquant interdit aujourd'hui).

| Cas | `[AUTO]`/`[HUMAN]` | Pilotable en autonome ? | Aujourd'hui (device absent) | Justification (observé sauf mention) |
|---|---|---|---|---|
| **A1 · AUTH-EMPTY** | AUTO | **Oui** | **Jouable** | Pilotable **sans device** : host valide + password vide, ré-init, lecture statut/log. **Observé** : avec host non vide + password vide, le module loggue `[CONN] No host configured — not attempting login` côté garde-fou. Le cas exact A1 (BadConfig **sans** appel réseau, password vide alors que host valide) est vérifiable via le statut + l'**absence de `[AUTH]`/`[HTTP]`** dans le log. ⚠️ La preuve d'absence d'appel se lit dans l'onglet Log (filtrable par niveau). |
| **A2 · AUTH-WRONG** | AUTO | **Oui (techniquement)** | **`[-]` aujourd'hui** | Exige un device **joignable** qui **rejette** le login (401/403) pour produire `AuthenticationFailure`. 192.168.2.9 absent → impossible. ⚠️ **Lockout : 1 seule tentative** — ne jamais reboucler. Pilotable le jour du créneau labo. |
| **A3 · AUTH-GOOD** | AUTO | **Oui** | **`[-]` aujourd'hui** | Exige le device réel + le bon mot de passe. Pilotable en autonome (saisie config, save, lecture statut vert + `[AUTH]` 200 frais dans le log) **mais nécessite le device**. |
| **B1 · HB-NAME** | AUTO | **Oui** | **`[-]` aujourd'hui** | Lecture variable `device_name` faisable (onglet Variables capturé). Mais la **vérité terrain** (nom réel dans l'appareil) exige le device → `[-]`. |
| **B2 · HB-FW** | AUTO | **Oui** | **`[-]` aujourd'hui** | Idem : `firmware_version` lisible, mais comparaison à `7.1.5259.00090` exige le device. |
| **B3 · HB-STATE** | AUTO | **Oui** | **`[-]` aujourd'hui** | `ip_address` + `connection_status` lisibles (capturés). État connecté réel exige le device. **Observé** : `connection_status` reflète en direct l'erreur (« Error: NVX timeout… ») / « Connecting… » sur l'instance jetable → le mécanisme de lecture est prouvé. |
| **B4 · FB-CONNECTED** | AUTO | **Oui** | **`[-]` aujourd'hui** | Poser un feedback sur un bouton est pilotable via l'UI (page Buttons). La **couleur active** exige l'état connecté → device. **Non exploré ce run** (hors périmètre du dry-run UI de base). |
| **B5 · LOG-VERBOSE** | AUTO | **Oui** | **Partiellement jouable** | Le toggle **« Enable verbose logging »** existe dans la config (capturé). Bascule OFF→ON pilotable + ré-init. La **différence de verbosité** des logs est lisible dans l'onglet Log. La preuve complète (préfixes `[INIT]/[POLL]` détaillés) sera plus riche avec un device, mais le mécanisme est jouable. |
| **C1 · CONN-DROP** | **HUMAN** | **Non (checkpoint humain)** | **`[-]` aujourd'hui** | Action physique (couper le réseau/alim du device). L'agent **observe** les transitions vert→rouge→vert mais **ne réalise pas** la coupure. Exige device + opérateur. |
| **C2 · CONN-UNREACHABLE** | AUTO | **Oui — pleinement jouable sans device** | **Jouable** | C'est précisément le scénario joué ce run avec 192.0.2.1. **Observé** : init non bloquant (UI réactive), statut « Connecting » puis « Connection Failure: NVX timeout: GET /userlogin.html », logs `[HTTP] Timeout` / `[CONN] Connection failed`. Reste à instrumenter la **preuve d'absence de force-restart du process module** (chercher des relances `node dist/main.js` — via `docker compose logs`, pas seulement l'UI). |
| **C3 · CONN-DESTROY** | AUTO | **Oui** | **`[-]` pour la preuve complète** | Destroy d'instance pilotable (bouton Delete + modale de confirmation capturés). La preuve **`GET /logout` puis silence** exige une **session active** (donc device) avant destroy → `[-]` aujourd'hui pour le cas nominal. La mécanique destroy/silence sur instance injoignable est partiellement observable mais ne couvre pas le `/logout`. |

### Synthèse faisabilité
- **Jouables aujourd'hui sans device** : **A1**, **C2** (pleinement) ; **B5** (mécanisme) ; **B3** (mécanisme de lecture seulement).
- **Pilotables en autonome mais bloqués par l'absence du device** (`[-]` ce créneau) : **A2, A3, B1, B2, B4, C3**.
- **Non automatisable (checkpoint humain obligatoire)** : **C1** (et la partie physique implicite de tout cas device).
- **Conclusion Objectif 1** : ✅ le pilotage autonome de l'UI Companion est **démontré** (navigation, création/édition/suppression d'instance, lecture statut, Variables, Log). Aucun blocage technique côté Playwright MCP.

---

## 2. Selectors capturés (Objectif 2 — base du POM Option B)

> ⚠️ **Contrainte forte observée** : **aucun `data-testid` dans l'UI Companion** (`document.querySelectorAll('[data-testid]')` → 0). Le POM devra s'appuyer sur **rôles + texte + `title` + classes Bootstrap/applicatives**. Les classes `collections-nesting-table*`, `variable-style`, `log-line`, `inline-help-outer` sont **applicatives et stables** ; les classes purement Bootstrap (`btn-success`, etc.) sont stables mais sémantiquement faibles.

### 2.1 Navigation (sidebar)
| Élément | Locator stable |
|---|---|
| Onglet Connections | `a[href="/connections"]` (role link « Connections ») |
| Onglet Variables | `a[href="/variables"]` |
| Onglet Log | `a[href="/log"]` |
| Onglet Buttons | `a[href="/buttons"]` |
| Version Companion | texte `v4.3.4` en bas de sidebar |

### 2.2 Page Connections — liste & statut
| Élément | Locator stable | Notes |
|---|---|---|
| En-tête tableau connexions | `.collections-nesting-table-header` | contient les filtres de statut |
| Filtres de statut (toggles) | `.table-header-buttons button` → textes `Disabled`/`OK`/`Warning`/`Error` ; classes `btn-secondary`/`btn-success`/`btn-warning`/`btn-danger` | code couleur du module |
| Ligne d'une connexion | `.collections-nesting-table-row-item` (filtrer par texte du label) | ex. `:has-text("Crestron_NVX")` |
| Label de la connexion | `<b>` dans la ligne (ex. `<b>Crestron_NVX</b>`) | |
| Nom du module | `.auto-ellipsis` (« Crestron: DM-NVX-350; … ») | |
| Version du module | `.no-break` (« Dev ») | |
| Ouvrir la config | `.collections-nesting-table-row-item ... .hand` (le bloc `div.hand[title^="Click to configure"]`) | navigue vers `/connections/<id>` |
| **Toggle Enable/Disable** | `[title="Enable connection"]` (désactivé) / `[title="Disable connection"]` (activé) → `input[type="checkbox"]` à l'intérieur | **le `title` bascule** selon l'état — sert d'oracle d'état |
| Menu options (3 points) | `button[title="Click for additional options."]` | |
| **Badge de statut — DÉSACTIVÉ** | `svg[data-icon="power-off"]` avec **attribut `color`** (ex. `color="gray"`) | pas de texte de statut quand désactivé |
| **Badge de statut — ACTIVÉ** | `span.inline-help-outer > svg[data-icon]` avec **attribut `color`** (hex) | `data-icon` = forme, `color` = sévérité |
| → exemples de statut activé | `data-icon="triangle-exclamation"` + `color="#d50215"` (rouge, erreur) ; spinner `visually-hidden`=« Loading… » (transitoire) | |
| **Texte du statut** | au survol du badge → popover `.popover.bs-popover-auto.show` contenant le message (« Connecting », « Connection Failure: NVX timeout: GET /userlogin.html ») | **lecture via `hover()` puis lire le popover** |

> **Modèle de lecture du statut pour le POM** : (1) si `power-off` gris → désactivé ; (2) sinon, lire `svg[data-icon]`+`color` dans `.inline-help-outer` pour la **sévérité**, et **hover** pour le **message exact**. Croiser avec la variable `connection_status` (cf. 2.4) — exigé par la philosophie anti-faux-positif (piège #2).

### 2.3 Config d'instance (`/connections/<id>`)
| Élément | Locator stable | Notes |
|---|---|---|
| Panneau d'édition | `.secondary-panel-simple` ; formulaire `form.secondary-panel-simple-body` | |
| Bloc d'un champ | `div.row.edit-connection` contient des paires **`label.form-label.col-sm-4`** + **`div.col-sm-8.fieldtype-<type>`** (le contrôle est dans la colonne) | label et contrôle **frère immédiat** : `label` → `nextElementSibling` = colonne du contrôle |
| Champ « Label » | label `Label` → input texte | |
| Champ « Enabled » | label `Enabled` → checkbox | |
| **Device IP / Hostname** | label `Device IP / Hostname` → `input[type=text]` | vide par défaut |
| **HTTPS Port** | label `HTTPS Port` → `input[type=number]` (défaut **443**) | |
| **Username** | label `Username` → `input[type=text]` (défaut **admin**) | |
| **Password** | label `Password` → `input[type=password]` + bouton œil (show/hide) | |
| **Poll Interval (ms)** | label `Poll Interval (ms)` → `input[type=number]` (défaut **2000**) | |
| **Ignore Self-Signed Certificate** | label `Ignore Self-Signed Certificate` → checkbox (défaut **coché**) | |
| **Enable verbose logging** | label `Enable verbose logging` → checkbox (défaut **décoché**) | cible du cas B5 |
| Bouton **Save** | `button.btn-success` texte « Save » | **déclenche le ré-init** |
| Bouton Done | `button` texte « Done » | ferme le panneau |
| Bouton Delete | `button.btn-danger` texte « Delete » | ouvre la modale de confirmation |

> ⚠️ **Contrainte majeure capturée** : *« Connection configuration cannot be edited while it is disabled. »* Les champs **host/port/user/password/poll/verbose n'apparaissent QUE si la connexion est ENABLED**. Le POM doit **activer** la connexion avant d'éditer la config module.
>
> **Astuce POM** : les inputs module **n'ont ni `name` ni `id` ni `placeholder`** → cibler par **texte du label puis `nextElementSibling`**. La saisie programmatique via le setter natif `HTMLInputElement.prototype.value` + events `input`/`change` fonctionne sur ces inputs contrôlés React (vérifié : valeurs persistées après Save).

### 2.4 Onglet Variables (`/variables/connection/<LABEL>`)
| Élément | Locator stable | Notes |
|---|---|---|
| Liste des groupes par connexion | page `/variables` ; ligne par connexion avec « N variables » | navigation : cliquer le groupe → `/variables/connection/<LABEL>` (**clé = label**, pas l'ID) |
| Filtre des variables | `input[placeholder="Filter ..."]` | |
| Tableau | `table` avec en-têtes **Variable** / **Value** | |
| Nom de variable | `span.variable-style[title="$(LABEL:varname)"]` | **le `title` = la référence complète** → locator le plus stable |
| Valeur d'une variable | 2e `<td>` de la ligne (`tr`) ; pastille de type « T » + texte de valeur | |
| Bouton copie | `button[title="Copy variable name"]` | |

**Variables exposées hors-connexion (instance jetable, 4)** : `connection_status`, `device_name`, `firmware_version`, `ip_address`.
**Observé** : `connection_status` reflète l'état live (« Connecting… » / « Error: NVX timeout: GET /userlogin.html ») ; les 3 autres **vides** (pas de cache sur instance neuve — confirme qu'une valeur peuplée prouverait une connexion, cf. piège #2).
⚠️ **Inféré** (non vérifié) : les ~10 autres variables listées dans CLAUDE.md n'apparaissent qu'une fois la connexion établie/le polling actif (donc avec device). À confirmer le jour du créneau labo.

### 2.5 Onglet Log (`/log`)
| Élément | Locator stable | Notes |
|---|---|---|
| Ligne de log | `div.log-line.log-type-<level>` (`log-type-error`, `log-type-debug`, …) | alternance `ListItemOdd`/`ListItemEven` sur le conteneur |
| Source/niveau dans la ligne | `<strong>` (ex. `log:`) | |
| Message | `span.log-message` | contient les préfixes module |
| Filtres de niveau | `button` textes `Warning`/`Info`/`Debug` (classes `btn-warning`/`btn-info`/`btn-secondary`, `+active` si actif) | toggles inclusifs |
| Actions | `button` « Clear log », « Export support bundle », « Hide Module Variables » | |
| **Pas de recherche texte** | `input` absents de la page Log (observé) | filtrage **par niveau** uniquement, pas par mot-clé |

**Préfixes module observés en direct** (instance jetable, host injoignable) :
- ✅ `[CONN]` — ex. `[CONN] No host configured — not attempting login` ; `[CONN] Connection failed (192.0.2.1): NVX timeout: GET /userlogin.html`
- ✅ `[HTTP]` — ex. `[HTTP] Timeout: GET /userlogin.html`
- ⚪ `[AUTH]` = **0** — **attendu et correct** : host injoignable → timeout **avant** toute auth → aucun login tenté (confirme le modèle de sécurité lockout : injoignable = 0 échec d'auth).
- ⚪ `[INIT]` / `[POLL]` = **0 dans la fenêtre visible** — **inféré** : probablement de niveau debug (toggle Debug inactif) et/ou non émis dans ce scénario. À reconfirmer avec verbose ON + device.

> Format des lignes : `AA.MM.JJ HH:MM:SS Instance/Connection/<LABEL>: [PREFIX] message`. Lisibles aussi via `docker compose logs` depuis le worktree si l'UI ne suffit pas (mémoire `ops-workflow`).

---

## 3. Limites & écarts (observé vs inféré)

- **Observé** :
  - Aucun `data-testid` dans toute l'UI → POM basé rôle/texte/`title`/classes.
  - La config module n'est éditable **que connexion activée** (message explicite UI).
  - Le statut activé est porté par **icône (`data-icon`+`color`)** + **message en popover au survol** ; le statut désactivé par `power-off` gris.
  - `connection_status` (variable) = miroir live du message de statut → bon **point de croisement** pour l'anti-faux-positif.
  - Préfixes `[CONN]`/`[HTTP]` réellement émis et visibles dans l'UI Log.
  - Une modale « What's New » s'ouvre au chargement et **masque** la page → le POM doit la fermer (`button` « Close ») en préambule.
  - La modale de confirmation de **suppression** confirme via un bouton **`btn-primary`** (pas `btn-danger`) — piège pour le POM.
- **Inféré (à confirmer)** :
  - Le jeu complet des 14 variables n'apparaît qu'avec une connexion vive / polling actif.
  - Couleurs/icônes exactes pour `OK` (vert) et `AuthenticationFailure` (non observées faute de device).
  - Preuve d'absence de **force-restart du process module** (C2) : nécessite d'inspecter `docker compose logs` à la recherche de relances `node dist/main.js` — **non instrumenté ce run** (l'UI seule ne le montre pas).
- **Introuvable / non exploré** :
  - Pas de champ de recherche texte sur la page Log.
  - Page Buttons / pose de feedback (B4) non explorée ce run.

---

## 4. Recommandations pour le POM Option B

1. **Préambule global** : fermer la modale « What's New » si présente.
2. **Helper `statusOf(label)`** : combiner (a) icône `power-off` gris → `disabled` ; (b) sinon `inline-help-outer svg[data-icon]`+`color` → sévérité ; (c) `hover` + popover → message exact ; (d) croiser avec la variable `connection_status`.
3. **Helper `editConfig(label, {host,port,user,pass,verbose})`** : garantir Enabled d'abord, puis label→`nextElementSibling`, puis Save (`btn-success`).
4. **Helper `varValue(label, name)`** : `span.variable-style[title="$(label:name)"]` → ligne → 2e `td`.
5. **Helper `logLines({level})`** : activer le toggle de niveau voulu, lire `div.log-line span.log-message`, matcher les préfixes.
6. **Discipline lockout** dans le POM : **jamais** de retry automatique sur un login échoué ; AUTH-WRONG = exactement 1 save+observe.

---

## Annexe — Preuves (screenshots)

Dossier : `docs/uat-runs/assets/2026-06-11-dryrun/`

| Fichier | Contenu |
|---|---|
| `dryrun-02-connections-clean.png` | Page Connections, instance `Crestron_NVX` désactivée (toggle gris) |
| `dryrun-03-config-disabled.png` | Config en lecture seule : « cannot be edited while disabled » |
| `dryrun-04-add-new.png` | Dialogue d'ajout de connexion Crestron NVX |
| `dryrun-05-after-add.png` | Instance jetable créée + **champs module** (host/port/user/pass) visibles |
| `dryrun-06-status-connecting.png` | **Badge rouge + popover « Connection Failure: NVX timeout: GET /userlogin.html »** |
| `dryrun-07-variables-list.png` | Page Variables : groupe `UAT_DRYRUN_DISPOSABLE` (4 variables) |
| `dryrun-08-variables-detail.png` | Détail variables : `connection_status` = « Connecting… », 3 autres vides |
| `dryrun-09-log.png` | Onglet Log avec lignes `[CONN]`/`[HTTP]` du module |

## Nettoyage effectué

- ✅ Instance jetable `UAT_DRYRUN_DISPOSABLE` **supprimée** (vérifié : seule `Crestron_NVX` subsiste).
- ✅ Instance réelle `Crestron_NVX` **inchangée** (restée désactivée, jamais activée).
- ✅ Navigateur fermé.
- ℹ️ Le journal de `docs/UAT.md` **n'a pas été touché** (dry-run, pas un run de validation).
