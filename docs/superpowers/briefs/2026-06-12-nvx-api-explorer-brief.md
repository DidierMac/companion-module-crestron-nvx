# Brief — Session GATE HARDWARE (agent `nvx-api-explorer`)

> **À donner à l'agent `nvx-api-explorer` au démarrage de la session du 2026-06-12.**
> L'agent démarre en contexte frais : ce document est sa seule source de vérité sur le pourquoi, le quoi et le comment. Lis-le en entier avant d'agir.

---

## 1. Contexte — où on en est et pourquoi cette session existe

Projet : **module Bitfocus Companion pour Crestron DM NVX** (encodeurs/décodeurs AV-over-IP, API REST).

- **v0.1.0 est livrée** : authentification (2 étapes, cookies), heartbeat `GET /Device/DeviceInfo`, polling, 4 variables de connexion, logging. **Validée en UAT réel** sur l'appareil cible.
- On est maintenant au **GATE HARDWARE** : le jalon obligatoire **avant** de coder les actions AV (v0.2 Encoder, v0.3 Decoder, v0.4 Audio/Vidéo, v0.5 Device-Ops).

**Pourquoi ce gate existe (à intérioriser absolument).** Le code d'origine du module avait **14 bugs critiques**, dont la moitié venaient de **chemins JSON et d'endpoints devinés** depuis la documentation, jamais vérifiés sur un appareil. Exemple déjà avéré : la doc Crestron 7.3.5 laissait croire qu'un login réussi renvoie HTTP 302 → sur le firmware réel (7.1.5259) c'est **HTTP 200**. **La documentation ment ou diverge selon le firmware.** La seule donnée fiable est ce que l'appareil renvoie réellement.

**La règle d'or de cette session** : on ne fige **aucun** chemin JSON dans le code futur s'il n'a pas été **observé** sur l'appareil et consigné ici. Ta mission produit cette observation.

---

## 2. Ce qu'on a préparé aujourd'hui (2026-06-11)

Un **script de capture** : `scripts/capture-nvx.ts`.

- Il **réutilise le client `NvxApiClient` validé** (`src/api.ts`) — donc la même authentification que celle qui marche en production. Ne réimplémente pas l'auth.
- Il s'authentifie **une seule fois**, puis fait un `GET` sur 6 endpoints et écrit le **JSON brut** dans `docs/hardware-validation/raw/<endpoint>.json`.
- Il **ne nécessite aucun `npm install`** (tous les imports SDK sont `import type`, effacés au runtime).
- **Lancement** (depuis la racine du repo, Didier fournit le mot de passe) :
  ```bash
  NVX_PASS=<mot_de_passe> node --experimental-transform-types --no-warnings \
    --loader ./scripts/ts-resolver.mjs scripts/capture-nvx.ts
  ```
  Variables optionnelles : `NVX_HOST` (défaut `192.168.2.9`), `NVX_PORT` (443), `NVX_USER` (admin), `NVX_VERBOSE`.

Appareil cible : **DM-NVX-360, firmware 7.1.5259**, sur `192.168.2.9`. Machine bridgée (atteint le device **et** internet → tu peux travailler en direct).

---

## 3. ⚠️ Sécurité NON NÉGOCIABLE — verrouillage de compte NVX

L'appareil a une protection anti-brute-force **agressive** :
- ~3 échecs d'auth → **compte verrouillé ~15 min** (auto-déblocage).
- ~3 échecs → **IP bloquée jusqu'à 24 h** (déblocage seulement par console USB Crestron Toolbox : `remblockedip` / `remlockeduser`).

**Conséquences impératives :**
- **JAMAIS reboucler sur un échec d'authentification (401/403).** Le script est déjà conçu pour s'arrêter net sur échec auth — ne contourne pas ce garde-fou, ne relance pas en boucle.
- Si le login échoue : **STOP**, rapporte, demande à Didier de vérifier le mot de passe. **Une seule tentative à la fois**, jamais d'essais successifs rapides.
- Un mauvais mot de passe au labo peut bloquer l'IP pour 24 h et faire perdre la fenêtre device entière (rare et précieuse). La prudence prime sur la vitesse.

---

## 4. Ta mission — dans l'ordre

### Étape A — Capture brute (sûre, lecture seule)
1. Faire lancer le script de capture par Didier (il fournit `NVX_PASS`).
2. Vérifier que `docs/hardware-validation/raw/*.json` est bien produit (6 fichiers attendus, ou moins si endpoints absents).
3. Si un endpoint échoue (404/500) : c'est une **donnée** (absent sur ce firmware), pas un blocage — continuer.

### Étape B — Validation du flux d'auth (checklist §11 de la spec 2026-05-18)
- [ ] `GET /userlogin.html` retourne bien un `TRACKID` ?
- [ ] `POST /userlogin.html` retourne les cookies de session (le code en gère 6 : `AuthByPasswd`, `TRACKID`, `iv`, `tag`, `userid`, `userstr`) ?
- [ ] `AuthByPasswd` change-t-il **à chaque réponse** (rolling) ?
- [ ] Durée de session (laisser expirer, observer le 403 → re-login) — **uniquement si le temps le permet**, sans risque de lockout.
- [ ] `GET /logout` fonctionne ?

### Étape C — Confirmer / RÉFUTER les chemins JSON présumés
À partir des dumps bruts, pour **chaque** propriété ci-dessous, marque : **CONFIRMÉ** (chemin exact identique) / **DIFFÉRENT** (chemin réel observé = …) / **ABSENT**. Ne force jamais une structure présumée sur le JSON réel — si ça diffère, **c'est un résultat**, documente-le.

Chemins présumés (recherche doc — à vérifier, peuvent être faux sur 7.1.5259) :

| Endpoint | Structure présumée | Clés présumées |
|---|---|---|
| `DeviceInfo` (GET) | `Device.DeviceInfo` | `Name`, `DeviceVersion`, `Model`, `MacAddress` (Name/DeviceVersion déjà confirmés en v0.1) |
| `StreamTransmit` (GET) — encodeur | `Device.StreamTransmit.Streams[0]` | `MulticastAddress`, `TransportMode` ("RTP"/"RTSP"/"TS"), `Start`, `Stop`, `RtspPort` (554), `RtpVideoPort` (40000), `RtpAudioPort` (40002), `BitrateMode`, `Status` (ro), `Bitrate` (ro) |
| `StreamReceive` (GET) — décodeur | `Device.StreamReceive.Streams[0]` | `StreamLocation` (URL), `MulticastAddress`, `InitiatorAddress`, `Start`, `Stop`, `RtspPort`, `Status` (ro), `HorizontalResolution` (ro), `FramesPerSecond` (ro) |
| `AudioVideoInputOutput` (GET) | `Device.AudioVideoInputOutput.Inputs[0].Ports[0]` | `Audio.{Mute, Volume (-100..100), AudioTypeSelect (0-3)}`, `VideoPortTypeSelect` ("Hdmi"/"Vga"/"Bnc"/"Auto") |
| `DiscoveryConfig` (GET) | ? | format de la liste des streams découverts (pour le decoder connect-by-name) |
| `DeviceOperations` (POST) | `Device.DeviceOperations` | `Reboot = true` |

### Étape D — Répondre aux questions précises dont v0.2 (Encoder) a besoin
v0.2 = Encoder. Pour chaque besoin v0.2, identifie le **champ JSON exact** :

| Besoin v0.2 | Question à laquelle le JSON réel doit répondre |
|---|---|
| Action `set_stream_name` | Quel champ porte le **nom du stream** encodeur ? (pas listé clairement dans les présumés — à trouver : `SessionName`? `MulticastAddress`? autre ?) |
| Action `set_multicast_address` | Champ multicast exact + son chemin de tableau (`Streams[0]` ?) |
| Action `enable_stream` / `disable_stream` | `Start`/`Stop` sont-ils des booléens ? des commandes ? |
| Action `set_stream_mode → Encoder` | **Où se lit/s'écrit le MODE** (encoder vs decoder) ? C'est le point le plus important et le moins documenté. Le device est-il en mode fixe, ou bascule-t-il ? |
| Feedback `is_encoder` / variable `stream_mode` | Même champ de mode — confirme comment distinguer encoder/decoder/both |
| Feedback `stream_enabled` | Quel champ (`Status` ? `Start` ?) indique qu'un stream est actif |
| Variable `encoder_url` | Comment l'URL publiée par l'encodeur est-elle représentée (RTSP ? multicast) ? |

### Étape E — Comportement de parallélisme (décision d'architecture)
- [ ] Tester **2 requêtes GET simultanées** avec le même `AuthByPasswd`.
  - Acceptées → `Promise.all` autorisé (polling parallèle).
  - Rejetées → file séquentielle obligatoire.
- Consigne la décision : elle conditionne l'implémentation du polling multi-endpoints en v0.2.

### Étape F — POST/actions : NE PAS exécuter sans accord explicite de Didier
Les POST **modifient l'état de l'appareil** (changer un stream, rebooter). La capture GET (étapes A–E) est **non destructive** et suffit à débloquer le code v0.2. Les tests POST (changer un nom de stream, reboot) sont **sensibles** :
- Ne lance **aucun** POST sans demander à Didier endpoint par endpoint.
- **Jamais** de reboot sans accord explicite (coupe la session et l'appareil).
- Si Didier valide un POST : capture l'état AVANT, fais le POST, capture APRÈS, et restaure l'état initial si possible.

---

## 5. Livrable — `docs/hardware-validation.md`

Produis un document structuré qui devient **la source de vérité unique** des chemins JSON. Il doit contenir :

1. **Métadonnées** : modèle, firmware, IP, date, qui a capturé.
2. **Auth** : résultats de la checklist §11 (TRACKID, cookies, AuthByPasswd rolling, logout).
3. **Par endpoint** : le chemin/structure JSON **réel** observé, avec pour chaque propriété : nom exact, type, lecture seule ou écriture, exemple de valeur. Marque CONFIRMÉ/DIFFÉRENT/ABSENT vs les présumés du §4.C.
4. **Réponses aux questions v0.2** (§4.D) — surtout le champ de **mode** encoder/decoder.
5. **Décision parallélisme** (§4.E).
6. **Écarts notables doc↔réel** (comme le 302→200) — précieux pour les firmwares futurs.
7. Conserver les dumps bruts dans `docs/hardware-validation/raw/` (référence brute non éditée).

---

## 6. Critères de qualité — comment mesurer que ton livrable est bon

Ton travail est réussi si :
- ✅ **Chaque** endpoint de la liste a son JSON brut capturé, ou est explicitement marqué absent/erreur (aucun trou silencieux).
- ✅ **Chaque** chemin présumé du §4.C est tranché : CONFIRMÉ / DIFFÉRENT (avec le chemin réel) / ABSENT. Aucun « probablement ».
- ✅ Le **champ de mode encoder/decoder** est identifié sans ambiguïté (sinon v0.2 est bloqué — signale-le clairement comme manquant).
- ✅ Chaque champ utile à v0.2 (§4.D) est relié à un chemin JSON réel ou marqué « introuvable, à investiguer ».
- ✅ La décision parallélisme est prise sur observation, pas sur supposition.
- ✅ Aucune affirmation présentée comme un fait sans l'avoir observée. Distingue explicitement **observé** (vu dans le dump) vs **inféré** (déduit) vs **inconnu**.

**Anti-objectif** : un `hardware-validation.md` qui « a l'air complet » mais recopie les chemins présumés sans les avoir vérifiés contre les dumps. C'est exactement le piège des 14 bugs. Mieux vaut « ce champ reste inconnu, dump ne le montre pas » qu'un chemin inventé.

---

## 7. Détection et gestion d'erreurs en cours de route

| Situation | Conduite à tenir |
|---|---|
| Login échoue (401/403) | **STOP immédiat**, pas de retry (lockout). Rapporter, demander vérif mot de passe à Didier. |
| Un GET renvoie 404/500 | Endpoint probablement absent sur ce firmware. Le consigner, **continuer** les autres. |
| Structure JSON ≠ présumée | C'est un **résultat**, pas une erreur. Documenter le réel, marquer DIFFÉRENT. Ne pas forcer. |
| Champ attendu introuvable dans le dump | Marquer « ABSENT / à investiguer ». Ne **jamais** inventer un chemin plausible. |
| Réponse incohérente / inattendue | Dire « je ne comprends pas ce résultat, voici le dump brut exact ». Ne pas rationaliser une explication. |
| Device injoignable en cours de session | Sauver ce qui est capturé, rapporter l'état partiel à Didier. |
| Doute sur un POST | Ne pas l'exécuter. Demander. |

---

## 8. Après la session (pour info — pas ton périmètre direct)

Les dumps + `hardware-validation.md` serviront à : (1) créer des **fixtures de test** (`src/*.test.ts`) reproduisant les vraies réponses JSON ; (2) écrire le spec d'implémentation **v0.2 Encoder** sur des chemins vérifiés ; (3) coder hors-ligne avec ces fixtures comme filet. Ton livrable est donc la **fondation** de tout le cycle AV — sa qualité conditionne 4 versions.
