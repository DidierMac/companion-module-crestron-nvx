# Design — Auth v0.1 : lecture du mot de passe (`secrets`) + gestion d'échec d'authentification

- **Date** : 2026-06-10
- **Branche** : `feature/log`
- **Cible** : v0.1.0 (auth + heartbeat)
- **Statut** : design validé, prêt pour plan d'implémentation

## 1. Contexte et problème

Le module ne parvient pas à s'authentifier sur un appareil DM NVX réel (192.168.2.9) :
chaque login renvoie **HTTP 403** à l'étape 2, alors que les identifiants saisis sont
corrects. Le module boucle alors une reconnexion toutes les 10 s, ce qui a déclenché le
**verrouillage du compte** sur l'appareil (mécanisme anti-brute-force NVX).

L'investigation a révélé **deux bugs distincts**, traités ensemble car ils touchent les
mêmes fichiers (`config.ts`, `main.ts`, `api.ts`) et se renforcent mutuellement.

### Bug A — Le mot de passe n'est jamais lu (bloquant)

En SDK v2 (`@companion-module/base`), les champs `secret-text` ne sont **pas** livrés dans
l'objet `config` mais dans un **3ᵉ paramètre `secrets`** de `init()` / `configUpdated()`.

Preuves convergentes (vérifiées) :
- **DB Companion** (`instances`, instance `Crestron_NVX`) :
  - `config` = `{ host, port, username: 'admin', pollInterval, ignoreSelfSignedCert, verbose }` — **aucune clé `password`**
  - `secrets` = `{ password: <8 chars> }` — le mot de passe est bien là, au bon endroit
- **Code** : `main.ts:20` ignore le paramètre `_secrets` ; `api.ts:48` lit `this.config.password`
  (toujours `undefined`) → envoie `passwd=undefined` → **403 garanti**.
- **SDK** : `base.d.ts:59` `init(config, isFirstInit, secrets)` ; `base.d.ts:71` « *the whole
  config object and the keys of the secrets object are reported to the webui* » — `secrets`
  est un canal séparé de `config`.

Conséquence : tant que A n'est pas corrigé, **l'authentification ne peut jamais réussir**,
quels que soient les identifiants.

### Bug B — Échec d'auth traité comme panne transitoire

Sur tout échec de `connect()` / `poll()`, `main.ts` reprogramme `setTimeout(connect, 10000)`
(`main.ts:101`, `:145`) **sans distinguer la nature de l'échec**. Un refus d'authentification
(401/403) est donc rejoué indéfiniment → martèle l'appareil → alimente le verrouillage de
compte (account lockout ~15 min, et **IP block jusqu'à 24 h** sur NVX).

## 2. Objectifs / non-objectifs

**Objectifs**
- A : lire le mot de passe depuis `secrets` ; le module s'authentifie avec les bons identifiants.
- B : un échec d'authentification (401/403) arrête les reconnexions automatiques et expose un
  statut explicite ; les pannes transitoires (réseau, timeout, 5xx) continuent de retenter.
- Aucune configuration invalide ne doit plus pouvoir marteler l'appareil.

**Non-objectifs**
- Support HTTP (en plus de HTTPS) — backlog séparé.
- Backoff exponentiel sur les erreurs réseau — amélioration future, hors périmètre.
- Action Companion « Reconnect » explicite — YAGNI (la récup passe par `configUpdated`).

## 3. Design A — Lecture du mot de passe depuis `secrets`

Le client miroite la séparation `config` / `secrets` du SDK.

### `config.ts`
- Retirer `password` de l'interface `ModuleConfig`.
- Ajouter un type `ModuleSecrets { [key: string]: JsonValue; password: string }`.
- Le champ `secret-text` `password` **reste** dans `getConfigFields()` — c'est lui qui indique
  à Companion de router la valeur vers `secrets` (confirmé par la DB ; aucun changement
  manifest requis).

### `main.ts`
- `init(config, isFirstInit, secrets)` : stocker `this.currentSecrets = secrets as ModuleSecrets`.
- `configUpdated(config, secrets)` : idem, puis propager au client.
- Construire le client avec `new NvxApiClient(this.currentConfig, this.currentSecrets, …)`.

### `api.ts`
- Constructeur : `NvxApiClient(config, secrets, authLog, httpLog)`.
- `updateConfig(config, secrets)` : met à jour les deux.
- `login()` : lire `this.secrets.password` (au lieu de `this.config.password`).

### Garde-fou « password vide »
Avant tout appel réseau, si `secrets.password` est vide/absent :
`updateStatus(InstanceStatus.BadConfig, 'No password configured')` et ne pas tenter le login.
Évite un 403 inutile et un cycle de verrouillage sur une config incomplète.

## 4. Design B — Échec d'auth = arrêt franc

Conforme à l'intention éditeur Bitfocus (issue #86 : `AuthenticationFailure` = « *the module
will not try and reconnect prior to configUpdated being called (since failure is guaranteed)* »).

### Taxonomie d'erreur

| Échec | Statut SDK | Boucle reconnect |
|---|---|---|
| 401/403 login (identifiants refusés / compte verrouillé) | `InstanceStatus.AuthenticationFailure` | **stoppée** |
| Réseau, timeout, 5xx, TRACKID absent | `InstanceStatus.ConnectionFailure` | conservée (10 s) |
| Password vide (garde-fou A) | `InstanceStatus.BadConfig` | non démarrée |

### Mécanisme : erreur typée (`NvxAuthError`)

Choix retenu après comparaison (erreur typée vs callback `setStatus` vs gate-on-status) :
l'erreur typée est la meilleure pour *ce* codebase car (1) `api.ts` lève déjà des exceptions
partout, (2) elle préserve le découplage existant (`NvxApiClient` ne connaît pas l'instance),
(3) `updateStatus` du SDK est write-only — pas de statut lisible, donc gate-on-status imposerait
un champ miroir dupliqué. Voir §7 pour le détail de la décision.

### `api.ts`
- `export class NvxAuthError extends Error {}`.
- `login()` : si l'étape 2 renvoie **401 ou 403**, lever `NvxAuthError` (au lieu d'un `Error`
  générique). Les autres statuts ≠ 302 → `Error` générique (transitoire/inattendu).
- `request()` (retry interne session expirée) : si le re-login échoue en 401/403, propager
  `NvxAuthError` (au lieu de l'`Error` générique actuel après re-login).

### `main.ts`
- Dans les `catch` de `connect()` **et** `poll()` :
  ```ts
  if (err instanceof NvxAuthError) {
    this.updateStatus(InstanceStatus.AuthenticationFailure, err.message)
    // pas de setTimeout → boucle stoppée
  } else {
    this.updateStatus(InstanceStatus.ConnectionFailure, msg)
    setTimeout(() => void this.connect(), 10000)  // transitoire → retry
  }
  ```

## 5. Récupération

Aucun nouveau mécanisme : `configUpdated()` (`main.ts:58`) relance déjà `connect()`. Après
correction des identifiants et sauvegarde dans Companion, la reconnexion repart automatiquement.

## 6. Tests (`node:test`)

- **A** : `login()` envoie le mot de passe issu de `secrets` — mock de `rawRequest`, assertion
  que le body du POST contient `passwd=<valeur de secrets>` et non `undefined`.
- **A (garde-fou)** : password vide → pas d'appel réseau, statut `BadConfig`.
- **B** : `login()` lève `NvxAuthError` sur 401 et sur 403 à l'étape 2.
- **B** : un statut ≠ 302/401/403 lève un `Error` générique (chemin transitoire conservé).

## 7. Décision d'architecture — pourquoi `NvxAuthError`

Trois plomberies évaluées pour transporter « auth refusée » de `api.ts` vers `main.ts` :

| Option | Verdict |
|---|---|
| **Erreur typée `NvxAuthError`** (retenue) | Idiomatique en flux à exceptions ; préserve le découplage api/instance ; testable sans mock d'instance ; source de vérité unique. |
| Callback `setStatus` injecté dans `api.ts` | Couple la couche transport au SDK ; statut posé à deux endroits ; régresse le découplage actuel. |
| Gate-on-status dans `main.ts` | `updateStatus` write-only → impose un champ miroir dupliqué (désync possible) ; surcharge l'enum de statut avec de la logique de contrôle. |

Le pattern communautaire majoritaire (callback / champ-miroir, ex. sony-bravia, sony-ptz)
répond à des modules **moins découplés** (ils passent `self` au client). Notre `NvxApiClient`
ne reçoit que des loggers : l'erreur typée est l'ajustement supérieur ici.

## 8. Risques et points à vérifier en implémentation

- Confirmer que le manifest n'a pas besoin d'une déclaration `secrets` explicite (la DB montre
  que le stockage fonctionne déjà via le type `secret-text`).
- `secrets` peut être `undefined` (password effacé) → traité par le garde-fou §3.
- Vérifier qu'aucun autre point du code ne lit `config.password` (recherche à faire).

## 9. Références

- SDK `@companion-module/base` v2.0.4 — `dist/module-api/enums.d.ts` (`InstanceStatus`,
  `AuthenticationFailure`), `dist/module-api/base.d.ts:59,71,183` (`init`/`secrets`/`updateStatus`).
- Bitfocus issue [#86](https://github.com/bitfocus/companion-module-base/issues/86) — intention
  de `AuthenticationFailure` (vérifiée à la source).
- Précédent communautaire : `companion-module-obs-studio` PR « Prevent authentication error loop ».
- Recherche verrouillage NVX (account lockout ~15 min, IP block ≤ 24 h) — voir historique session.
