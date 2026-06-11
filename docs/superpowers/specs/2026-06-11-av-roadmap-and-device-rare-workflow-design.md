# Roadmap AV révisée & workflow « device rare » — Design

**Date** : 2026-06-11
**Statut** : validé (brainstorming Didier)
**Portée** : planification des versions v0.2 → v1.0 et processus de développement contraint par un accès rare au matériel.
**Remplace** : la numérotation des versions de `2026-05-18-crestron-nvx-design.md` §14 (la logique de séquence reste valable, seuls les numéros glissent).

---

## 1. Contexte & problème

La **v0.1.0 livrée** a absorbé deux étapes de la roadmap d'origine §14 : l'ancien `v0.1` (Authentication) **et** l'ancien `v0.2` (Device Info & Polling). Elle contient : auth via canal `secrets`, heartbeat `GET /Device/DeviceInfo`, 4 variables de connexion, logging structuré. Validée en UAT réel (DM-NVX-360, fw 7.1.5259).

Conséquences :

1. **Dérive de numérotation** — ce que la mémoire appelait « v0.2 = actions routing/audio/stream + feedbacks » correspond en réalité aux anciens `v0.3 → v0.6`. Empilé en un seul bloc, c'est un gros livrable à risque.
2. **Gate hardware non franchi** — `docs/hardware-validation.md` est **absent**. Les chemins JSON exacts des endpoints AV n'ont jamais été capturés sur un appareil réel.
3. **Risque historique** — le code d'origine avait 14 bugs critiques nés de **chemins JSON devinés** depuis la doc, sans appareil. Réimplémenter les actions AV à l'aveugle reproduit ce piège.

**Décision** : revisiter la roadmap pour livrer par **petits incréments fonctionnels cohérents**, chacun fondé sur du JSON **observé**, jamais deviné.

---

## 2. Principe directeur

> **Chaque version = une tranche verticale complète et autonome** : capturer le JSON réel de son endpoint → implémenter actions **+ feedbacks + variables** → tester → livrer. **Aucune version ne sort sur des données devinées.**

Les feedbacks ne sont pas une version séparée : un feedback lit l'**état** de l'appareil, qui provient du **même GET** que les actions de la version. Les feedbacks de l'encoder se livrent donc avec v0.2, ceux du decoder avec v0.3, etc.

---

## 3. Roadmap révisée

| Nouveau | Contenu | Endpoint NVX | Dépend de |
|---|---|---|---|
| **GATE** (pas une version) | Capture JSON réelle → `docs/hardware-validation.md`, **GET complet** (état pour feedbacks) **+ forme POST** (actions) des 4 familles | tous AV | device dispo |
| **v0.2** | **Encoder** — set stream name, multicast, enable/disable stream, mode→Encoder ; feedbacks `is_encoder`, `stream_enabled`, `stream_name_matches` ; variables `stream_name`, `multicast_address`, `encoder_url`, `stream_enabled`, `stream_mode` | `GET/POST /Device/StreamTransmit` | GATE |
| **v0.3** | **Decoder** — set stream URL, connect-by-name (discovery), mode→Decoder ; feedbacks `is_decoder`, `stream_url_matches` ; variable `stream_url` | `GET/POST /Device/StreamReceive` + `GET /Device/DiscoveryConfig` | v0.2 (source de test) |
| **v0.4** | **Audio & Vidéo I/O** — mute/unmute, toggle mute, volume (absolu+relatif), sélection entrée HDMI ; feedbacks audio/signal ; variables `audio_muted`, `audio_volume`, `video_source`, `hdmi_*_signal` | `GET/POST /Device/AudioVideoInputOutput` | v0.3 |
| **v0.5** | **Device Operations & Mode** — reboot ; détection auto encoder/decoder/both | `POST /Device/DeviceOperations` | v0.2 + v0.3 |
| **v1.0** | **Production** — SDK compliance, presets prêts à l'emploi, packaging, doc, soumission Companion | — | toutes |
| **v1.1+** | WebSocket/XioSubscription, monitoring hardware, ports réseau (post-release) | `XioSubscription`… | v1.0 |

### Logique de séquence (inchangée depuis §14)

1. **Encoder (v0.2) avant Decoder (v0.3)** — tester un décodeur exige une source connue ; un encodeur actif la fournit.
2. **Audio/Vidéo (v0.4) après le routing** — indépendant du mode, mais en installation réelle on configure le routing d'abord.
3. **Device-Ops (v0.5) en dernier des 0.x** — la détection auto encoder/decoder/both a besoin que v0.2 et v0.3 existent pour distinguer les 3 cas.
4. **v1.0 en fin de cycle** — tout le travail « meta » (compliance, packaging) regroupé juste avant la soumission.

---

## 4. Workflow « device rare »

**Contrainte** : le matériel est dans un labo de test isolé d'internet ; l'accès est ponctuel et le planning fluctue. La règle de livraison interdit tout merge sur `develop` sans **UAT réel validé** (cf. mémoire `feedback-delivery-gate`).

**Solution** : découpler le **code (hors-ligne)** de tout ce qui exige l'appareil (**capture + UAT**), et regrouper ce dernier en créneaux.

### 4.1 Deux types de créneaux device

| Créneau | Quand | Produit |
|---|---|---|
| **Capture** (une fois, en amont) | Prochaine dispo (prévue : 2026-06-12) | `docs/hardware-validation.md` — JSON réel des 4 familles d'endpoints |
| **UAT batch** (événementiel) | Quand des versions codées attendent ET qu'un créneau labo s'ouvre | Validation réelle → merge + tag des versions qui passent |

### 4.2 Le pont : le JSON capturé devient des fixtures de test

```
docs/hardware-validation.md  →  fixtures JSON  →  tests node:test (offline)  →  UAT confirme
   (observé sur device)          (src/*.test.ts)     (safety net permanent)      (créneau device)
```

Chaque action/feedback est testée unitairement contre la **vraie forme JSON** capturée. L'UAT ne fait que confirmer que le device live se comporte comme la fixture. C'est le renversement qui élimine le piège des 14 bugs : le JSON est **observé d'abord**, figé en fixture, et le code est contraint de s'y conformer dès l'écriture.

### 4.3 Cadence : événementielle, pas fixe

Le planning de Didier fluctue → **aucune cadence de batch figée**. Politique : coder ce qui peut l'être hors-ligne ; quand un créneau labo s'ouvre, UAT-cascade de **tout ce qui est prêt** (1 à 4 versions), merge au fil de l'eau.

### 4.4 Stratégie de branches (stack linéaire = ordre de dépendance)

Les 4 versions partagent `actions.ts` / `feedbacks.ts` / `variables.ts`. Pour éviter les conflits et coller à l'ordre de dépendance UAT :

```
develop
  └─▶ feature/v0.2-encoder        (codé hors-ligne, tests sur fixtures)
        └─▶ feature/v0.3-decoder         (branché sur v0.2)
              └─▶ feature/v0.4-audio-video
                    └─▶ feature/v0.5-device-ops
```

Au créneau UAT : valider v0.2 → merge `develop` → valider v0.3 → merge → … en cascade. Merge **uniquement** après UAT de la version. La coquille `feature/v0.2` vide actuelle sera supprimée et recréée proprement (`feature/v0.2-encoder`).

---

## 5. Session de capture (2026-06-12)

**Conditions confirmées** : Claude Code actif, machine bridgée (atteint le device 192.168.2.9 **et** internet). → pilotage **en direct** par l'agent `nvx-api-explorer` (pas de script autonome nécessaire).

**Périmètre de capture** (objectif : ne plus jamais avoir à deviner un chemin JSON) :

- `GET /Device/DeviceInfo` (re-confirmer la base)
- `GET /Device/StreamTransmit` — **état complet** (encoder)
- `GET /Device/StreamReceive` — **état complet** (decoder)
- `GET /Device/DiscoveryConfig` — liste des streams découverts
- `GET /Device/AudioVideoInputOutput` — **état complet** (audio + HDMI in/out)
- `GET /Device/DeviceOperations` — capacités exposées
- Pour chaque action prévue (v0.2→v0.5) : forme exacte du **POST** attendu (structure `Device > Subsystem > Property`)

**Livrable** : `docs/hardware-validation.md` complet (checklist §11 de la spec 2026-05-18), committé directement après la session (c'est de l'observation, pas du code module → pas d'UAT requise pour le merger).

---

## 6. Point ouvert — avant le spec d'implémentation v0.2

**A-t-on tout pour l'encoder, ou faut-il des étapes intermédiaires ?** À déterminer par une **évaluation de fondations** menée par l'architecte (lecture de `api.ts`, `index.ts`, `actions.ts`) — travail **hors-ligne**, sans device. Briques à vérifier :

- POST générique « commande subsystem » dans `api.ts` (v0.1 ne faisait peut-être que des GET).
- Polling généralisé à plusieurs endpoints (pas seulement DeviceInfo).
- Plumbing d'enregistrement actions/feedbacks/variables/presets dans `index.ts`.

Si des briques manquent, elles deviennent soit le premier sous-bloc de v0.2, soit une micro-étape `feature/v0.2-foundation` qui la précède. L'architecte tranche.

---

## 7. Prochaines étapes (ordre)

1. **(Aujourd'hui)** Spec validé + committé ; évaluation de fondations par l'architecte (hors-ligne, parallélisable).
2. **(2026-06-12)** Session de capture `nvx-api-explorer` → `docs/hardware-validation.md`.
3. **(Après capture)** Spec d'implémentation v0.2 (Encoder) sur JSON vérifié → writing-plans → code hors-ligne + fixtures.
4. **(Créneau labo suivant)** UAT-cascade de ce qui est prêt → merge + tag.

---

## 8. Critères de succès du processus

- Aucune version AV mergée sur `develop` sans UAT réel.
- Aucun chemin JSON dans le code qui ne soit adossé à `docs/hardware-validation.md`.
- Chaque version testable et défendable isolément.
- Le développement hors-ligne reste possible et sûr entre deux créneaux labo grâce aux fixtures.
