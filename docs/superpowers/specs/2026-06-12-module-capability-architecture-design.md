# Architecture des capacités & modes du module — Design

**Date** : 2026-06-12
**Statut** : validé (brainstorming Didier)
**Portée** : modèle général du module pour gérer **tous les modèles de device NVX et leurs modes**, fondation des versions AV v0.2 → v0.5.
**Branche** : `feature/v0.2-encoder`
**Source de vérité données** : `docs/hardware-validation.md` (3 devices réels capturés) + mémoire `api-findings`.

---

## 1. Contexte & problème

Le module pilote **un seul device NVX par instance** (`docs/architecture.md` — une connexion = un device, validé v0.1). Les versions AV (v0.2 Encoder → v0.5) doivent fonctionner sur des **modèles variés** sans deviner :

- **DM-NVX-360** : commutable (peut être Transmitter **ou** Receiver).
- **DM-NVX-E30** : encodeur-pur (Transmitter uniquement).
- Modèles futurs non observés (ex. D-series décodeur-pur) : doivent être gérés **génériquement**.

Le gate hardware a fourni les signaux **observés** (pas devinés). Ce spec fige **comment le module détecte ce que le device connecté peut faire et adapte son interface** — avant d'implémenter la première tranche (v0.2).

**Décision directrice (Didier)** : détection + adaptation **dynamique**, fondée sur données observées **et** doc constructeur, jamais devinée.

---

## 2. Modèle de capacité & de mode

### 2.1 Détection de capacité (au connect — statique)

Source observée : `Device.DeviceCapabilities.PortConfig` (`raw/<host>/Device_DeviceCapabilities.json`).

```
canEncode     = NumberOfHdmiInputs  ≥ 1
canDecode     = NumberOfHdmiOutputs ≥ 1
canSwitchMode = canEncode AND canDecode
```

Observé : 360 = 1 in / 1 out → **commutable** ; E30 = 1 in / 0 out → **encode-only**. Un D-series (0 in / 1 out) serait décode-only.

**Corroboration** : la présence des sous-systèmes (`StreamTransmit`/`StreamReceive` = objet vs sentinelle) doit concorder avec `PortConfig` (garde-fou de cohérence ; E30 sans `StreamReceive` ↔ 0 sortie).

**Note doc (vérifiée)** : l'API REST NVX **n'expose aucun champ « modes supportés »** (`DeviceSpecific` = `DeviceMode` + `DeviceReady` seulement). `PortConfig` est donc le **meilleur signal programmatique disponible**, pas un contournement.

### 2.2 Rôle courant (observé — stable)

`Device.DeviceSpecific.DeviceMode` ∈ **`{"Transmitter", "Receiver"}`** (énum doc à 2 valeurs, observé sur les 3 devices ; miroir : `UserInterfaceConfig.DeviceSupport.DeviceMode`).
**Stable** : ne change qu'au **reboot** d'une bascule de mode.

### 2.3 Séparation des concerns (correction clé du design)

- **Quel panneau afficher** ← **`DeviceMode` courant seul** (état observé). `mode==Transmitter ⟹ canEncode` (la capacité est redondante pour l'affichage).
- **Peut-on / vers quoi basculer** ← **`PortConfig`** (capacité physique). N'intervient QUE pour l'action de changement de mode.

---

## 3. Modèle de panneaux (un module par sous-système)

### 3.1 Contrat de panneau

```
{ id,
  endpoint,                    // GET (+ forme POST des actions)
  gate(caps, mode) → bool,     // prédicat d'activation
  parse(json) → state,         // tolère sentinelle/absence
  actions[], feedbacks[], variables[] }
```

### 3.2 Gates — un prédicat uniforme pour tout

| Panneau | Gate |
|---|---|
| **Encoder** | `mode == "Transmitter"` |
| **Decoder** | `mode == "Receiver"` |
| **Toujours visible** | `subsystemPresent` |
| **Action bascule de mode** | `canSwitchMode` ; cibles du dropdown = {`Transmitter` si `canEncode`, `Receiver` si `canDecode`} |

**L'exclusivité Encoder/Decoder est émergente**, pas un mécanisme spécial : `DeviceMode` valant exactement un de Tx/Rx, exactement un des deux gates passe. Toutes les classes de visibilité (toujours-visible, exclusif, conditionnel) sont **le même prédicat** `gate(caps, mode)`.

### 3.3 Mapping sous-système → panneau → version

| Panneau | Sous-système | Gate | Version |
|---|---|---|---|
| Device info (heartbeat) | `DeviceInfo` | toujours | v0.1 ✓ |
| **Encoder** | `StreamTransmit` | `mode==Transmitter` | **v0.2** |
| Decoder | `StreamReceive` | `mode==Receiver` | v0.3 |
| Audio/Vidéo I/O | `AudioVideoInputOutput` | `subsystemPresent` | v0.4 |
| Mode & Device-Ops | `DeviceSpecific` + `DeviceOperations` | bascule si `canSwitchMode` ; reboot toujours | v0.5 |

### 3.4 Structure de code — approche **B** (module par panneau)

Aujourd'hui : `actions.ts`/`feedbacks.ts`/`variables.ts` plats. Cible : **un module par panneau** (`panels/encoder.ts`, `panels/decoder.ts`…), chacun exportant son contrat complet ; un **registre** compose les panneaux dont le gate passe. Le `poll()` généralisé itère les **panneaux actifs**.

→ Ajouter une version = **ajouter un module panneau** (+ fixtures + tests), sans toucher aux autres. Unités bornées, testables isolément.

*(Réserve technique : le re-`setActionDefinitions()` à chaud — pour ré-exposer le bon jeu de panneaux après reconnexion — est un pattern Companion connu, **à confirmer en doc SDK** au stade writing-plans. Non bloquant.)*

---

## 4. Flux de données & robustesse

### 4.1 Cycle de vie

```
CONNECT  → détecter capacité (PortConfig) + lire DeviceMode
         → registre : pour chaque panneau, si gate(caps, mode) → activer
           (enregistrer actions/feedbacks/variables)
POLL     → pour chaque panneau ACTIF :
           GET sous-système → parse() → setVariableValues + checkFeedbacks
           (inclut DeviceSpecific → device_role / is_encoder frais)
RE-CONNEXION → re-détecter → reconstruire le jeu de panneaux
```

Le `poll()` généralisé **conserve** la détection de déconnexion + `scheduleReconnect` existante (`main.ts:174-189`, à ne pas casser). Une bascule de mode (qui **reboote** → déconnexion) est rattrapée par la reconnexion qui re-détecte le nouveau mode — y compris un changement fait depuis l'UI native du device.

### 4.2 Robustesse / gestion d'erreurs

- **Sentinelle / absence** : `parse()` teste `typeof === 'object'` ; chaîne `"UNSUPPORTED PROPERTY, CHECK REST API!!!"` ou clé absente → **N/A** (variable vide, feedback `false`, **pas de crash**). Défensif même si le gate l'évite.
- **Écriture (`StatusId`)** : POST → lire `Actions[].Results[].StatusId` → `0`=OK · `1`=reboot attendu (bascule mode) · autre=erreur (log + action signalée en échec).
- **Reboot (bascule de mode)** : après POST `DeviceMode` (StatusId 1) → log, statut « rebooting », **pas de poll-spam**, on laisse la reconnexion re-détecter.
- **Tableaux par position** : les actions stream ciblent `Streams[0]` (primaire) **par position** (contrat §4 de `hardware-validation.md`).

### 4.3 Filet de tests (fixtures)

Les **captures du gate deviennent des fixtures** : StreamTransmit actif (`raw/192.168.2.10/`) / au repos (`raw/192.168.2.9/`), sentinelle StreamReceive (`raw/192.168.2.11/`).
Tests offline `node:test` : `parse(fixture) → état attendu` ; `gate(caps, mode) → exposition attendue` ; sentinelle → N/A. L'**UAT** confirme seulement que le live = la fixture (renversement anti-14-bugs).

---

## 5. Portée — architecture vs versions

- **Cette architecture** (détection de capacité, registre de panneaux, `poll()` généralisé) = **1er commit de `feature/v0.2-encoder`** (la fondation identifiée par l'architecte, cf. `architecture-v0.2-foundations`). Le panneau Device-info v0.1 est migré dans ce modèle.
- **Chaque version ajoute son module panneau** : v0.2 encoder, v0.3 decoder, v0.4 audio/vidéo, v0.5 mode & device-ops.
- **v0.2 n'inclut PAS l'action de bascule de mode** (reboot, non testé empiriquement) → reportée à **v0.5**. v0.2 **LIT** le mode (variables `device_role`, `is_encoder`).

---

## 6. Décisions validées

1. **Single-device** : une instance = un device (inchangé).
2. **Détection + adaptation dynamique** des panneaux selon le device connecté.
3. **Affichage par mode courant** ; la capacité (`PortConfig`) ne gouverne **que** l'action de bascule.
4. **Structure B** : un module par panneau + registre.
5. **Action de changement de mode** (reboot) → **v0.5**, pas v0.2.

---

## 7. Non résolu / à confirmer (avant ou pendant le plan d'implémentation)

- **Re-`setActionDefinitions()` à chaud** : confirmer le pattern/limites en doc SDK Companion (writing-plans).
- **Sous-panneaux Audio/Vidéo I/O** (entrée vs sortie selon capacité) : détail de design **v0.4**, pas maintenant.
- **Détection de switchability** : `PortConfig` est un proxy robuste (aucun champ REST dédié) — à re-confirmer si un modèle exotique apparaît un jour.
