---
name: fake-control-api
description: API de contrôle du fake NVX par scénarios nommés — l'orchestrateur pilote l'état rapporté (flux / négocie-sans-décoder / repos), approche B (fakes indépendants pilotés)
date: 2026-06-17
---

## Contexte

Le fake NVX (`scripts/uat/fake-device/server.ts`) rejoue aujourd'hui des captures RAW figées et pose
`CodecReady:true` **en dur** sur Start (FIX 1 B4). Conséquence : le journey ne peut prouver que l'état
« décode » (vert) ; il ne peut pas exercer « négocie-sans-décoder » (ambre) ni « repos » de façon réaliste.

On veut une **API de contrôle** : l'orchestrateur (le runner de journey, ou un test) dit au fake quoi
rapporter, via des **scénarios nommés** (« flux en place », « pas de flux », …). Ça remplace le comportement
figé et débloque le test de bout en bout des 3 états du feedback de réception.

**Décision d'approche (brainstorming 2026-06-17)** : approche **B** — l'API de contrôle + des journeys RX et
TX **indépendants**, PAS un couplage autonome entre fakes. Raison décisive : **le module ne corrèle jamais
RX et TX** (il lit `StreamReceive` et `StreamTransmit` indépendamment, via deux connexions REST). Coupler les
fakes ajouterait du réalisme mais **aucune couverture de test** supplémentaire. Le couplage orchestré reste
une couche optionnelle future par-dessus la même API.

Vision long terme (hors scope immédiat) : la même API de contrôle servira à simuler d'autres aspects device
(ex. présence/absence USB) le jour où le module les gérera.

## Décisions architecturales clés

1. **Scénarios nommés** (pas de patch d'état brut) comme interface — lisible dans les journeys, fermé à des
   cas connus. Un patch brut générique reste une évolution future si besoin.
2. **Endpoint de contrôle sur le même port**, chemin réservé `POST /_control/scenario`, **sans auth NVX**
   (backdoor de test ; ne collisionne pas avec `/Device/*` ni `/userlogin`). Body : `{ "scenario": "<nom>" }`.
3. **Le scénario décrit ce que la SOURCE délivre ; Start/Stop (commandes du module) décident si le RX reçoit.**
   Le scénario ne force pas l'état final — il définit l'issue d'un Start. Ça garde Start/Stop signifiants et
   teste vraiment le couple commande-module ↔ état-device.
4. **Défaut sans appel de contrôle = comportement actuel** (Start → decoding) → **zéro régression** des
   journeys et tests existants.
5. **Cœur pur et isolé** : la traduction scénario → état device vit dans un module pur testable
   (`scenarios.ts`), séparé du serveur HTTP.

## Scénarios (mappés sur les feedbacks réels)

| Rôle | Scénario | État rapporté (après Start) | Feedback résultant |
|------|----------|------------------------------|--------------------|
| RX | `idle` | `Status:'Stream Stopped'`, `CodecReady:false`, résolution 0, 0 paquet | éteint |
| RX | `negotiating` | résolution peuplée (3840x2160@30), `CodecReady:false`, 0 paquet | `rx_negotiating` (ambre) |
| RX | `decoding` | `CodecReady:true`, résolution peuplée, paquets > 0 | `rx_receiving` (vert) |
| TX | `stopped` | `Status:'Stream Stopped'` | `tx_enabled` faux |
| TX | `streaming` | `Status:'Stream started'` | `tx_enabled` vrai |

**Note YAGNI** : « chiffré » et « source sans vidéo » sont **observablement identiques** à `negotiating`
(le module ne voit que `CodecReady:false`). Pas de scénario `encrypted` distinct maintenant — il ne serait
utile que pour une future gestion du déchiffrement (il poserait en plus `DiscoveredStreams[].Encryption:true`).

## Interaction Start/Stop ↔ scénario

- scénario `decoding` + Start → vert ; scénario `negotiating` + Start → ambre ; scénario `idle` + Start → repos.
- **Stop** → reset (idle) quel que soit le scénario.
- Aucun appel de contrôle → scénario par défaut = `decoding` (= comportement figé actuel, non-régression).

## Carte d'implémentation

| Fichier | Type | Rôle |
|---------|------|------|
| `scripts/uat/fake-device/scenarios.ts` | **créer** | Pur : `scenarioToReceiveState(name)` / `scenarioToTransmitState(name)` → champs StreamReceive/StreamTransmit. Cœur testable. |
| `scripts/uat/fake-device/server.ts` | modifier | Route `POST /_control/scenario` (stocke le scénario courant) ; `applyReceiveSetPartial`/`applyTransmitSetPartial` appliquent le scénario courant sur Start (au lieu du `CodecReady:true` figé). |
| `scripts/uat/journey/steps-lab.ts` | modifier | Steps par scénario : `control(scenario)` → press bouton → assert oracle (ex. `DEC-NEGOTIATING`, `DEC-DECODING`). |
| `scripts/uat/fake-device/scenarios.test.ts` | **créer** | Unitaire : mapping scénario → état (les 3 états RX + 2 TX + défaut). |
| `scripts/uat/fake-device/receive.test.ts` | modifier | Maj : Start respecte le scénario courant. |

## Vérification

- **Unitaire** (sans Companion) : `scenarios.ts` — chaque scénario produit l'état attendu ; défaut = `decoding`.
- `receive.test.ts` : Start sous scénario `negotiating` → `CodecReady:false` + résolution ; sous `decoding` → `CodecReady:true` + paquets ; Stop → reset.
- **Intégration (labo/fake, Playwright)** : journey avec steps par scénario → les 3 états RX exercés de bout en bout (control → press → oracle). Non automatisable en CI (Tier 2), cohérent avec le harnais.
- **Non-régression** : journeys/tests existants sans appel de contrôle → comportement inchangé (défaut `decoding`).

## Limitations connues (implémentation 2026-06-17)

- **Scénario TX accepté mais inerte** : `POST /_control/scenario` avec `role:'tx'` est validé et stocké
  (`currentTxScenario`), mais **jamais appliqué** au StreamTransmit du fake. Raison : l'encodeur est **binaire**
  (`tx_enabled = Status === 'Stream started'`), et son Start/Stop pose déjà le `Status` — le scénario TX
  `stopped`/`streaming` est donc redondant avec les commandes existantes. Décision (Didier, 2026-06-17) :
  laisser accepté-mais-inerte. À câbler seulement si un futur besoin TX non-binaire apparaît.
- **`decoding` pose un compteur de paquets fixe** : `scenarioToReceiveState('decoding')` retourne
  `NumVideoPacketsRcvd: 1` (constante), là où l'ancien bloc figé incrémentait à chaque Start. Sans impact
  fonctionnel (seul le prédicat journey `NumVideoPacketsRcvd > 0` le lit ; aucun feedback ne l'utilise).
  Conséquence de la pureté de `scenarios.ts` (pas d'état entre appels).
- **Handler HTTP non couvert en unitaire** : la robustesse du handler `/_control/scenario` (JSON invalide→400,
  inconnu→400, état non corrompu) est vérifiée au niveau des fonctions pures, pas du handler lui-même
  (nécessiterait de lever le serveur HTTPS). Test d'intégration optionnel en backlog.

## Questions ouvertes / hors scope

- Couplage orchestré A (TX flux → route RX → RX décode) : couche optionnelle future sur la même API.
- Patch d'état brut générique (USB, etc.) : évolution future si les scénarios nommés ne suffisent plus.
- Scénario `encrypted` distinct : seulement si/quand le module gère le déchiffrement.
- ⚠️ Les boutons restent créés manuellement (non automatisable — établi) ; l'API de contrôle ne change rien à ça.
