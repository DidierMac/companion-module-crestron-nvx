# Design Spec — v0.1.1 : Logging & Documentation open-source

**Date** : 2026-05-19
**Branche** : `feature/log` (depuis `feature/v0.1-auth`)
**Version cible** : v0.1.1
**Auteur** : Didier Casalta + Claude

---

## 1. Contexte et objectif

Le module v0.1 (auth + heartbeat) est fonctionnel dans Docker mais entièrement aveugle côté debug : `api.ts` ne log rien, et `main.ts` n'a que 3 points de log. L'objectif de v0.1.1 est double :

1. **Logging structuré** — traçabilité complète de tous les flux (auth, HTTP, polling, cycle de vie) pour permettre le débogage sans accès physique à la machine.
2. **Documentation open-source** — README professionnel en anglais + arborescence `docs/` adaptée à la diffusion publique sur GitHub.

---

## 2. Contraintes

- Zéro dépendance npm nouvelle — uniquement `@companion-module/base` (déjà installé) et modules Node.js natifs.
- Compatible avec tous les scénarios de déploiement : Docker, Windows desktop, Linux/macOS desktop, serveur rack headless.
- Le toggle verbose activable à chaud depuis l'UI Companion (sans redémarrage du module).
- Le code du logger (`src/logger.ts`) doit être autonome et portable vers d'autres modules Companion.

---

## 3. Stratégie de logging

### 3.1 Approche retenue — Toggle verbose dans la config

Un `ModuleLogger` injectable, avec un flag `verbose` lu depuis la configuration Companion.

**Comportement par niveau :**

| Méthode | verbose OFF | verbose ON | Destination |
|---|---|---|---|
| `logger.debug(msg)` | silencieux | `this.log('info', msg)` | Fichier disque + UI Companion |
| `logger.info(msg)` | `this.log('info', msg)` | `this.log('info', msg)` | Fichier disque + UI Companion |
| `logger.warn(msg)` | `this.log('warn', msg)` | `this.log('warn', msg)` | Fichier disque + UI Companion |
| `logger.error(msg)` | `this.log('error', msg)` | `this.log('error', msg)` | Fichier disque + UI Companion |

**Pourquoi `this.log('info')` pour les debug promus ?**
`this.log('debug')` n'écrit pas sur disque — il n'apparaît que dans le panneau "Module debug view" de l'UI. Pour que les traces de debug soient accessibles via fichier ou export support bundle, elles doivent être promues en `info` quand verbose est activé.

### 3.2 Préfixes de composant

Chaque message porte un préfixe entre crochets identifiant le composant source :

| Préfixe | Composant |
|---|---|
| `[INIT]` | Initialisation du module (config au démarrage) |
| `[CONN]` | Gestion de la connexion (connect, reconnect, destroy) |
| `[AUTH]` | Authentification NVX (login, logout, cookies) |
| `[POLL]` | Cycle de polling (start, stop, résultats) |
| `[HTTP]` | Requêtes HTTP brutes (méthode, path, status, durée) |
| `[ACTION]` | Exécution d'actions Companion (v0.2+) |
| `[FEEDBACK]` | Évaluation des feedbacks (v0.2+) |

**Utilité pour le débogage :**
```bash
# Docker — isoler l'auth uniquement
docker compose logs companion | grep "\[AUTH\]"

# Tous les avertissements HTTP
docker compose logs companion | grep "\[HTTP\].*warn\|error"
```

### 3.3 Emplacement des fichiers de log (runtime)

Ces chemins sont gérés par Companion — le module n'a aucun contrôle dessus.

| Contexte | Chemin des fichiers de log |
|---|---|
| **Windows** | `%APPDATA%\Roaming\Bitfocus\Companion\logs\` |
| **Linux** | `~/.config/companion-nodejs/v<version>/logs/` |
| **macOS** | `~/Library/Application Support/Companion/logs/` |
| **Docker** | `/companion/logs/` (dans le volume bindé) |
| **Variable env** | `$COMPANION_CONFIG_BASEDIR/logs/` si définie |

**Export universel (tous contextes) :** UI Companion → onglet Logs → bouton "Export support bundle" → ZIP contenant les logs archivés, la config, et les métadonnées. Partageable sans accès filesystem.

**Accès Docker en temps réel :**
```bash
docker compose logs -f companion              # suivi continu
docker compose logs --since 30m companion    # dernières 30 minutes
docker exec companion-nvx-companion-1 ls /companion/logs/  # fichiers sur disque
```

---

## 4. Design du `ModuleLogger`

### 4.1 Interface

```typescript
// src/logger.ts
export class ModuleLogger {
  constructor(
    private readonly logFn: (level: LogLevel, msg: string) => void,
    private readonly prefix: string,
    private verbose: boolean,
  ) {}

  setVerbose(v: boolean): void   // appelé depuis configUpdated()
  debug(msg: string): void       // silencieux si !verbose, promu info si verbose
  info(msg: string): void        // toujours loggué
  warn(msg: string): void        // toujours loggué
  error(msg: string): void       // toujours loggué

  // Factory : crée un logger enfant avec un préfixe de composant
  child(prefix: string): ModuleLogger
}
```

### 4.2 Utilisation

```typescript
// main.ts — création du logger racine
const log = new ModuleLogger(this.log.bind(this), '', config.verbose)

// Passage à NvxApiClient
this.api = new NvxApiClient(config, log.child('[HTTP]'), log.child('[AUTH]'))

// Logs dans main.ts
const connLog = log.child('[CONN]')
connLog.debug('connect() triggered')
connLog.info(`Connected to NVX at ${config.host}`)
```

---

## 5. Couverture des logs par fichier

### `src/main.ts` — 9 points de log (3 existants + 6 nouveaux)

| Niveau | Préfixe | Message | Condition |
|---|---|---|---|
| debug | `[INIT]` | `Config: host=X port=Y poll=Zms verbose=true/false` | init() |
| debug | `[CONN]` | `connect() triggered` | connect() |
| info | `[CONN]` | `Connected to NVX at X` | *(existant)* |
| debug | `[CONN]` | `Polling started — interval Xms` | startPolling() |
| debug | `[CONN]` | `Polling stopped` | stopPolling() |
| warn | `[CONN]` | `Poll error: X — reconnect in 10s` | poll() catch *(existant, enrichi)* |
| debug | `[CONN]` | `Reconnect scheduled in 10s` | setTimeout connect |
| error | `[CONN]` | `Connection failed (X): msg` | *(existant)* |
| debug | `[CONN]` | `configUpdated() → reconnect` | configUpdated() |

### `src/api.ts` — 8 points de log (0 existant + 8 nouveaux)

| Niveau | Préfixe | Message | Condition |
|---|---|---|---|
| debug | `[AUTH]` | `Login step 1 — GET /userlogin.html` | login() |
| debug | `[AUTH]` | `TRACKID obtained → step 2 POST` | login() |
| debug | `[AUTH]` | `Login OK — X cookies received` | login() |
| debug | `[AUTH]` | `Logout triggered` | logout() |
| debug | `[HTTP]` | `METHOD /path → sent` | rawRequest() |
| debug | `[HTTP]` | `METHOD /path ← HTTP X (Yms)` | request() |
| warn  | `[HTTP]` | `HTTP 403 on /path → re-login triggered` | request() 403 |
| error | `[HTTP]` | `Timeout/error: METHOD /path` | timeout handler |

### `src/actions.ts` / `src/feedbacks.ts`

Préparation uniquement en v0.1.1 : logger injectable déclaré, pas de logs métier (viendront en v0.2 avec le contenu réel).

---

## 6. Champ config verbose

```typescript
// src/config.ts — ajout dans getConfigFields()
{
  type: 'checkbox',
  id: 'verbose',
  label: 'Enable verbose logging',
  default: false,
  tooltip: 'Logs all HTTP requests and authentication steps. Useful for troubleshooting. See docs/debugging.md for log file locations.',
}
```

```typescript
// src/config.ts — ajout dans ModuleConfig
verbose?: boolean
```

---

## 7. Structure documentation open-source

### 7.1 Arborescence cible

```
README.md              (EN) — vitrine GitHub, installation, usage, troubleshooting
CHANGELOG.md           (EN) — déjà prévu, une section par release
CONTRIBUTING.md        (EN) — comment contribuer
LICENSE                — MIT
docs/
  debugging.md         (EN) — verbose mode, chemins log par OS, support bundle, grep tips
  architecture.md      (EN) — structure du module, flux de données (remplace ARCHITECTURE.md actuel)
  api-reference.md     (EN) — API REST NVX : endpoints, JSON, auth (fusionne docs/api-research.md)
  superpowers/         (FR) — specs internes, plans — non ignoré, pas destiné aux contributeurs externes
```

### 7.2 Structure README.md

```markdown
# companion-module-crestron-nvx

[Badges : Companion v4 | License MIT | Node 22+]

Bitfocus Companion module for Crestron DM NVX AV-over-IP encoders and decoders.

## Features
## Requirements
## Installation        (3 étapes : Companion, Load module, Configure)
## Configuration       (tableau des champs UI)
## Actions             (liste avec paramètres)
## Feedbacks           (liste avec conditions)
## Variables           (liste $(crestron-nvx:xxx))
## Troubleshooting
    ### Enable verbose logging
    ### Log file locations    ← tableau OS → chemin
    ### Export support bundle
    ### Common issues
## Contributing        (lien vers CONTRIBUTING.md)
## License
```

### 7.3 Langue

- `README.md`, `CONTRIBUTING.md`, `docs/debugging.md`, `docs/architecture.md`, `docs/api-reference.md` : **anglais**
- `CHANGELOG.md` : **anglais** (convention GitHub)
- `docs/superpowers/` : **français** (usage interne Didier + Claude)

---

## 8. Périmètre v0.1.1

### Inclus
- `src/logger.ts` — `ModuleLogger` (nouveau)
- `src/main.ts` — intégration logger + 6 nouveaux points de log
- `src/api.ts` — intégration logger + 8 nouveaux points de log
- `src/config.ts` — champ `verbose`
- `README.md` — version complète open-source (EN)
- `CONTRIBUTING.md` — (EN)
- `LICENSE` — MIT
- `docs/debugging.md` — (EN)
- `docs/architecture.md` — (EN)
- `docs/api-reference.md` — (EN, fusionne api-research.md)

### Exclus (v0.2+)
- Logs dans `actions.ts` / `feedbacks.ts` (pas encore de contenu métier)
- Préfixes `[ACTION]` / `[FEEDBACK]`
- Granularité par composant (toggle séparé par préfixe)

---

## 9. Critères de succès

1. `docker compose logs companion | grep "\[AUTH\]"` retourne les étapes de login
2. Avec verbose OFF : aucun message `[AUTH]`/`[HTTP]`/`[POLL]` dans les logs
3. Avec verbose ON : toutes les étapes HTTP visibles dans le fichier log Companion
4. Le toggle verbose activé/désactivé dans l'UI Companion prend effet sans redémarrage
5. `ModuleLogger` réutilisable dans un autre module sans modification (zéro dépendance externe)
6. `README.md` couvre installation + troubleshooting + log locations
