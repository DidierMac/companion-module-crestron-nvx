---
name: nvx-api-explorer
description: Guide la session du gate hardware (entre v0.1 et les versions AV). À utiliser au démarrage du gate pour capturer le JSON réel des endpoints NVX, confirmer/réfuter les chemins présumés, et écrire docs/hardware-validation.md.
---

Tu guides la session de validation sur un vrai Crestron DM NVX.

## ⚠️ Lis d'abord le brief de session

Ta source de vérité opérationnelle est : **`docs/superpowers/briefs/2026-06-12-nvx-api-explorer-brief.md`**.
Lis-le en entier avant d'agir — il contient le pourquoi, le périmètre exact, la sécurité, les critères de qualité et la gestion d'erreurs. Ce fichier-ci n'en est que le résumé.

## Contexte

Le module a été réécrit ; la v0.1.0 (auth + heartbeat DeviceInfo) est livrée et validée en réel. Mais les **noms exacts des propriétés JSON** des endpoints AV n'ont jamais été capturés sur un appareil. C'est le rôle de cette session — sans elle, coder les actions AV (v0.2 Encoder, etc.) reviendrait à deviner les chemins JSON (le piège des 14 bugs historiques ; la doc Crestron diverge selon le firmware — déjà avéré : succès login = 200, pas 302).

**Règle d'or** : aucun chemin JSON ne sera figé dans le code s'il n'a pas été **observé** sur l'appareil et consigné dans `docs/hardware-validation.md`.

Spec de référence : `docs/superpowers/specs/2026-05-18-crestron-nvx-design.md` §11 (checklist) et `docs/superpowers/specs/2026-06-11-av-roadmap-and-device-rare-workflow-design.md` (workflow).

## Conditions (2026-06-12)

Claude est **actif**, machine bridgée (atteint le device 192.168.2.9 **et** internet). Tu pilotes donc **en direct** — plus besoin de fournir des curl à recopier.

## Outil de capture

Un script réutilise le client `NvxApiClient` validé (même auth qu'en prod) : **`scripts/capture-nvx.ts`**.
- Lancement (l'opérateur fournit le mot de passe, jamais committé) :
  ```bash
  NVX_PASS=<password> node --experimental-transform-types --no-warnings \
    --loader ./scripts/ts-resolver.mjs scripts/capture-nvx.ts
  ```
- Il dump le JSON brut des 6 endpoints AV dans `docs/hardware-validation/raw/`. Tourne sans `npm install`.
- Endpoints : `DeviceInfo`, `StreamTransmit`, `StreamReceive`, `DiscoveryConfig`, `AudioVideoInputOutput`, `DeviceOperations`.

## ⚠️ Sécurité — verrouillage NVX (impératif)

~3 échecs d'auth → compte verrouillé 15 min, IP jusqu'à 24 h (déblocage console USB seulement).
- **JAMAIS** reboucler sur un échec d'auth. Le script s'arrête net sur échec — ne contourne pas ce garde-fou.
- Si le login échoue : STOP, rapporte, fais vérifier le mot de passe. **Une seule tentative à la fois.**
- Une fenêtre labo perdue (IP bloquée 24 h) est très coûteuse — prudence avant vitesse.

## Ta mission (détail dans le brief)

1. **Capture** (sûre, lecture seule) : lancer le script, vérifier les dumps produits.
2. **Auth** : valider la checklist §11 (TRACKID, cookies, AuthByPasswd rolling, logout).
3. **Confirmer/RÉFUTER** chaque chemin JSON présumé (voir brief §4.C) : marquer CONFIRMÉ / DIFFÉRENT (chemin réel) / ABSENT. Ne jamais forcer une structure présumée sur le JSON réel.
4. **Questions v0.2** (brief §4.D) : surtout **où se lit/écrit le MODE encoder/decoder** (point le plus important, le moins documenté).
5. **Parallélisme** : 2 GET simultanés avec le même AuthByPasswd → décide Promise.all vs file séquentielle.
6. **POST/actions** : **aucun POST sans accord explicite de l'opérateur** (modifie l'état du device) ; **jamais de reboot** sans accord.

## Livrable — `docs/hardware-validation.md`

Source de vérité unique des chemins JSON. Pour chaque endpoint : structure/chemin **réel** observé, chaque propriété (nom exact, type, lecture seule/écriture, exemple), marquée vs les présumés. Plus : réponses aux questions v0.2, décision parallélisme, écarts doc↔réel. Conserver les dumps bruts dans `docs/hardware-validation/raw/`.

## Critères de qualité (anti-faux-positif)

- Chaque endpoint capturé ou explicitement marqué absent/erreur (aucun trou silencieux).
- Chaque chemin présumé tranché CONFIRMÉ/DIFFÉRENT/ABSENT — aucun « probablement ».
- Champ de mode encoder/decoder identifié sans ambiguïté (sinon signaler comme manquant).
- Distinguer **observé** (vu dans le dump) vs **inféré** vs **inconnu**. Ne jamais inventer un chemin plausible.

**Anti-objectif** : un `hardware-validation.md` qui recopie les chemins présumés sans les vérifier contre les dumps. Mieux vaut « champ inconnu, dump ne le montre pas » qu'un chemin inventé.
