# UAT — Plan de non-régression (Crestron DM NVX)

> **Document vivant et exécutable.** Chaque version livrée ajoute ses cas. À **chaque créneau labo**, avant de merger une nouvelle version sur `develop`, dérouler **tout** le plan : la nouvelle version ET toutes les précédentes doivent passer. Un échec sur une version antérieure = **régression** → bloquer le merge.

## Modes d'exécution

Ce plan est écrit pour être déroulé de trois façons :
- **Manuel** : l'opérateur suit les étapes et coche.
- **Agent assisté** : un agent dicte chaque étape, l'opérateur exécute l'action physique et rapporte l'observation, l'agent juge PASS/FAIL selon les critères.
- **Agent autonome (Playwright)** : l'agent pilote l'UI Companion (`http://localhost:8000`) pour les étapes marquées `[AUTO]`. Les étapes `[HUMAN]` exigent une action physique (couper le réseau du device, etc.) et ne sont pas automatisables.

Chaque étape porte donc `[AUTO]` (pilotable via l'UI Companion) ou `[HUMAN]` (action physique requise).

## Philosophie anti-faux-positif

Un test « vert » n'est PAS une preuve. Les pièges récurrents sur ce module :
1. **Statut périmé** — Companion garde le dernier statut/valeur d'une connexion précédente. Un « Connected » vert peut dater d'**avant** ton changement de config. → **Toujours forcer un ré-init propre** (Disable → Enable, ou recréer l'instance) après tout changement de config, et vérifier que la **preuve est fraîche** (un log `[AUTH]` avec horodatage courant), pas un état résiduel.
2. **Variable mise en cache** — `device_name`/`firmware_version` conservent leur dernière valeur même après déconnexion. Une variable peuplée ne prouve **pas** une connexion vive. → Croiser avec `connection_status` + couleur du statut, et vérifier la **valeur réelle** (pas juste « non vide »).
3. **Preuve par la transition, pas par l'état final** — pour les déconnexions/reconnexions, c'est le passage rouge→vert (ou vert→rouge) qui prouve, pas « c'est vert à la fin » (qui peut signifier que rien ne s'est passé).
4. **Observation dans la durée** — « pas de boucle de reconnexion » exige d'**attendre** et de regarder les logs (un retry peut n'apparaître qu'après 10–40 s). L'absence d'activité pendant 2 s ne prouve rien.
5. **Preuve positive d'absence** (bonne pratique E2E) — asserter « il ne s'est rien passé » est faillible (le test peut passer parce qu'il n'a *rien vu*, pas parce qu'il n'y avait *rien*). Quand c'est possible, préférer un **proxy positif** qui prouve que l'absence va persister : ex. un log explicite `[CONN] reconnexion annulée / destroyed` après `destroy()`, plutôt que « aucun log de reconnexion ». ⚠️ Vérifier ce que `destroy()`/`clearReconnect()` émet réellement comme log (hypothèse à confirmer dans le code) — si un marqueur positif existe, l'utiliser en priorité dans AUTH-WRONG et CONN-DESTROY.

## ⚠️ Budget lockout (anti-brute-force NVX)

L'appareil verrouille le compte/IP après ~3 échecs d'auth (15 min, voire 24 h IP). **Discipline impérative :**
- Le seul test générant un échec d'auth est **AUTH-WRONG** → **exactement 1 tentative**, jamais répétée. En cas de faute de frappe sur le « mauvais » mot de passe, **arrêter** (c'est un 2e échec).
- **AUTH-GOOD réussit après**, ce qui **réinitialise le compteur d'échecs** du device.
- Les tests d'injoignabilité utilisent un **hôte injoignable** (timeout réseau), **jamais** un mauvais mot de passe → 0 échec d'auth.
- **Budget par run complet : 1 échec d'auth**, remis à zéro par AUTH-GOOD. Ne jamais dévier de l'ordre.

## Ordre d'exécution (non négociable)

Du plus sûr au plus destructif ; la bonne session est établie **une fois** puis réutilisée ; le teardown est en dernier :

```
Phase A — Gauntlet d'auth      : VIDE → MAUVAIS → BON   (BON reste actif)
Phase B — Lectures sur session : heartbeat, variables, feedback, logging
Phase C — Disruptif & teardown : drop device → injoignable → destroy   (en dernier)
```

## Environnement de test

| Élément | Valeur |
|---|---|
| Appareil | DM-NVX-360 |
| Firmware | 7.1.5259.00090 |
| IP | 192.168.2.9 (labo isolé d'internet) |
| Companion | v4.x (Docker local, http://localhost:8000) |
| Vérité terrain | nom device & firmware réels à confirmer **dans l'appareil** (pas seulement dans Companion) |

## Légende

`[x]` PASS · `[!]` FAIL (noter le détail) · `[-]` non testable ce créneau · `[~]` douteux (à rejouer)

---

## v0.1.0 — Connexion, Auth, Heartbeat, Logging ✅ (livrée)

### Phase A — Gauntlet d'authentification (ordre : vide → mauvais → bon)

#### A1 · AUTH-EMPTY — mot de passe vide → BadConfig sans appel réseau `[AUTO]`
- **Précondition** : instance configurée avec host/user valides, **champ password VIDE**. Ré-init propre (Disable→Enable).
- **Action** : laisser le password vide, activer l'instance.
- **Attendu** : statut **BadConfig** (erreur de configuration). **Aucune requête réseau émise.**
- **PASS si** : statut = BadConfig **ET** les logs ne montrent **aucune** tentative `[AUTH]`/`[HTTP]` (le garde-fou agit *avant* le réseau).
- **Pièges** : ❌ Ne pas confondre **BadConfig** (aucun appel) avec **AuthenticationFailure** (appel émis puis rejeté = autre cas, et ici ce serait un FAIL : un appel a eu lieu). ❌ Un statut vert ici = état périmé (ré-init non faite).
- **Lockout** : 0 (aucun appel). Sûr en premier.
- **Postcondition** : non connecté.

#### A2 · AUTH-WRONG — mauvais mot de passe → AuthenticationFailure, pas de boucle `[AUTO]`
- **Précondition** : depuis A1 (non connecté). Saisir un password **délibérément faux**. Ré-init propre.
- **Action** : activer l'instance **une seule fois**.
- **Attendu** : statut **AuthenticationFailure** ; **exactement 1** tentative de login ; **aucune reconnexion** ensuite.
- **PASS si** : statut = AuthenticationFailure **ET** logs = un seul `[AUTH]` rejeté (401/403) **puis aucune** nouvelle tentative sur une fenêtre d'observation **≥ 30 s** (ou ≥ délai de retry max configuré).
- **Pièges** : ⚠️ **LOCKOUT — 1 seule tentative**, ne pas répéter (faute de frappe = 2e échec → arrêter). ⏱️ « Pas de boucle » exige d'**attendre** : un retry peut surgir à 10–40 s ; ne pas conclure à 2 s. ❌ Vert ici = état périmé.
- **Lockout** : 1 échec consommé (réinitialisé par A3).
- **Postcondition** : non connecté ; compteur device à 1 échec.

#### A3 · AUTH-GOOD — bon mot de passe → Connected (session conservée) `[AUTO]`
- **Précondition** : depuis A2. Saisir le **bon** password. Ré-init propre.
- **Action** : activer l'instance.
- **Attendu** : statut **OK/Connected** (vert) en quelques secondes ; le login réussi **réinitialise** le compteur d'échecs du device.
- **PASS si** : statut vert **ET** log `[AUTH]` succès (HTTP 200) **frais** (horodatage courant) + démarrage du heartbeat.
- **Pièges** : ❌ S'assurer que le vert est **nouveau** (postérieur au changement de config), pas résiduel — le prouver par un `[AUTH]` 200 horodaté maintenant.
- **Postcondition** : **CONNECTÉ — conserver cette session pour les phases B et C.**

### Phase B — Lectures sur la session active (non destructif)

#### B1 · HB-NAME — `device_name` reflète le nom réel `[AUTO]`
- **Action** : lire `$(crestron-nvx:device_name)` (onglet Variables).
- **PASS si** : valeur = nom réel **configuré dans l'appareil** (vérité terrain), pas seulement « non vide ».
- **Piège** : valeur en cache d'un run précédent → croiser avec `connection_status` vert + valeur cohérente avec CE device.

#### B2 · HB-FW — `firmware_version` reflète le firmware réel `[AUTO]`
- **PASS si** : valeur = `7.1.5259.00090` (ou firmware réel courant de l'appareil).
- **Piège** : idem cache ; comparer à la vérité terrain.

#### B3 · HB-STATE — `ip_address` & `connection_status` corrects `[AUTO]`
- **PASS si** : `ip_address` = IP configurée ; `connection_status` = état connecté réel.

#### B4 · FB-CONNECTED — feedback `connected` actif `[AUTO]`
- **Action** : poser le feedback `connected` sur un bouton.
- **PASS si** : bouton actif (couleur) quand connecté.

#### B5 · LOG-VERBOSE — toggle verbose `[AUTO]`
- **Action** : basculer le toggle verbose dans la config (OFF puis ON).
- **PASS si** : OFF → logs minimaux ; ON → logs détaillés avec préfixes `[INIT]`/`[AUTH]`/`[CONN]`/`[HTTP]`/`[POLL]`.
- **Piège** : changer la config peut **ré-initialiser** l'instance (et donc reconnecter) → c'est normal, ne pas le lire comme un échec ; juste re-confirmer le vert après.

### Phase C — Disruptif & teardown (en dernier, dans cet ordre)

#### C1 · CONN-DROP — coupure device en cours de session + reprise `[HUMAN]`
- **Précondition** : connecté (fin de phase B).
- **Action** : `[HUMAN]` couper le device (réseau ou alim) → observer ; puis le rétablir → observer.
- **Attendu** : `connection_status` passe à **déconnecté** ; tentatives de reconnexion selon la stratégie ; au retour → reconnexion auto au vert.
- **PASS si** : on **observe la transition** vert→rouge à la coupure **puis** rouge→vert au retour (les deux transitions).
- **Pièges** : ❌ Ne pas se contenter de « c'est vert à la fin » — sans avoir vu le rouge, le device n'a peut-être jamais été coupé (FAIL silencieux). La **transition** est la preuve.
- **Postcondition** : reconnecté.

#### C2 · CONN-UNREACHABLE — injoignable au démarrage : init non bloquant, pas de force-restart `[AUTO]`
- **Précondition** : changer le **host** vers une IP **injoignable** (ex. `192.0.2.1`, TEST-NET — **pas** un mauvais mot de passe). Ré-init propre.
- **Action** : activer l'instance.
- **Attendu** : `init()` **rend la main vite** (UI Companion réactive) ; le **process du module n'est PAS force-restarté** ; statut = connecting/erreur.
- **PASS si** : logs montrent un init résolu rapidement **ET aucune** boucle de redémarrage du module (pas de relance répétée de `node dist/main.js`) ; statut pas figé sur « starting ».
- **Pièges** : ❌ Le symptôme du bug est le **force-restart du process module** (chercher dans les logs des démarrages répétés / « module restarted »), pas une simple pause d'UI. Une UI qui se fige une fraction de seconde ≠ le bug. ⚠️ Utiliser un **host injoignable** (timeout réseau), jamais un mauvais password → budget lockout intact (0).
- **Postcondition** : non connecté. Restaurer le bon host pour C3.

#### C3 · CONN-DESTROY — destroy → logout émis + aucune reconnexion fantôme `[AUTO]`
- **Précondition** : restaurer bon host + bon password → **connecté**.
- **Action** : désactiver/supprimer l'instance (destroy).
- **Attendu** : un `GET /logout` est émis ; ensuite **aucune** activité `[HTTP]`/`[AUTH]`/reconnexion.
- **PASS si** : logs montrent `/logout` **puis SILENCE** observé sur une fenêtre **≥ (délai de retry max + 1 intervalle de poll)** — aucune reconnexion fantôme.
- **Pièges** : ⏱️ Un timer de reconnexion peut se déclencher **plusieurs secondes après** le destroy (bug D historique). Le silence immédiat ne prouve rien : **attendre** le plus long délai de retry avant de conclure PASS.
- **Postcondition** : instance détruite/désactivée. État final.

---

## v0.2 — Encoder (StreamTransmit) ✅ (livrée — à valider au labo)

> Cas figés après le gate hardware (chemins JSON **vérifiés** dans `docs/hardware-validation.md` §4–§5 et la fixture `raw/192.168.2.10/Device_StreamTransmit.json`), au **même format** que les phases A/B/C. v0.2 = **lire + écrire l'encodeur** (StreamTransmit). **PAS de bascule de mode** (reportée v0.5 : reboot non testé empiriquement).
>
> **Périmètre exact du code v0.2** (source `src/panels/encoder.ts`) :
> - Actions : `set_stream_name` (→ `RtspSessionName`), `set_multicast_address` (→ `MulticastAddress`), `enable_stream` (→ `Start:true`), `disable_stream` (→ `Stop:true`). Toutes ciblent **`Streams[0]` par position** (`streamTransmitBody(0, …)`), enveloppe `{"Device":{"StreamTransmit":{"Streams":[{…}]}}}`.
> - Variables : `stream_name`, `multicast_address`, `encoder_url` (= `StreamLocation`), `stream_enabled` (= `Status === 'Stream started'`).
> - Feedbacks : `stream_enabled`, `stream_name_matches` (panel) + `is_encoder`/`is_decoder` (niveau connexion, `feedbacks.ts`).

### Précondition de toute la phase Encoder (mode Transmitter)

> ⚠️ Le device doit être en mode **Transmitter** AVANT de commencer la phase. **Le module v0.2 ne sait PAS basculer le mode** (action de mode = v0.5). Le réglage se fait via l'**UI native du device** (ou son interface web), pas via Companion. Confirmer côté device que `DeviceMode == "Transmitter"` avant CAP-01. Si le device est en `Receiver`, le panneau encoder ne s'activera pas (gate `role === 'Transmitter'`) et tous les ENC-* seront `[-]` non testables.

> 🔒 **Budget lockout** : toute la phase Encoder tourne sur la **session déjà active** établie en A3 (bon login). **0 login supplémentaire → 0 échec d'auth → 0 lockout consommé.** Ne PAS Disable→Enable l'instance pendant la phase (cela rouvrirait une session). Exception : CAP-01 et ENC-07 peuvent exiger un ré-init **propre** (Disable→Enable) — c'est un **bon** login, qui ne consomme pas de budget d'échec (cf. §27 : seul un *échec* compte).

#### CAP-01 · détection capability/role au connect → panneau encoder activé `[AUTO]`
- **Précondition** : device confirmé en mode **Transmitter** (UI native). Instance configurée avec host/user/password **valides**. Ré-init propre (Disable→Enable) pour forcer un connect frais.
- **Action** : activer l'instance ; laisser le connect aboutir (vert) ; ouvrir les onglets Variables, Actions et Feedbacks de Companion.
- **Attendu** : au connect, le module lit `DeviceCapabilities` + `DeviceSpecific`, détecte `role=Transmitter`, **active le panneau encoder**. La variable `device_role` vaut `Transmitter` ; les **actions** encoder (`set_stream_name`, `set_multicast_address`, `enable_stream`, `disable_stream`) et les **variables** `stream_*` apparaissent dans Companion.
- **PASS si** : `$(crestron-nvx:device_role)` = `Transmitter` **ET** les 4 actions encoder sont listées dans le sélecteur d'actions **ET** les variables `stream_name`/`multicast_address`/`encoder_url`/`stream_enabled` existent (onglet Variables) **ET** les feedbacks `stream_enabled`/`stream_name_matches`/`is_encoder` sont proposables.
- **Pièges** : ❌ Faux positif si `device_role` est une valeur **en cache** d'un run précédent — croiser avec l'**état réel du device** (mode `Transmitter` confirmé côté device, log `[CONN] … role=Transmitter → panels: deviceInfo, encoder` **frais**). ❌ Si le device était en `Receiver`, le panneau encoder est correctement **absent** : ce n'est PAS un FAIL du code, c'est une précondition non remplie (corriger le mode device, rejouer). ⚠️ La détection a lieu **à chaque (re)connexion** : un changement de mode fait côté device n'est pris en compte qu'après une reconnexion (reboot ou ré-init).
- **Lockout** : 0 (réutilise / ré-ouvre une session par **bon** login). Sûr.
- **Postcondition** : connecté, panneau encoder actif. Conserver la session pour ENC-01..06.

#### ENC-01 · set_stream_name → `RtspSessionName` réellement changé côté device `[HUMAN]`
- **Précondition** : depuis CAP-01 (connecté, encoder actif). Choisir un nom témoin **non ambigu**, ex. `UAT-STREAM-X`.
- **Action** : `[AUTO]` déclencher l'action `set_stream_name` avec `name = UAT-STREAM-X` (bouton Companion ou exécution directe de l'action). Puis `[HUMAN]` (ou GET direct si accès device) relire l'état du device.
- **Attendu** : POST `{"Device":{"StreamTransmit":{"Streams":[{"RtspSessionName":"UAT-STREAM-X"}]}}}` ; le device applique **LIVE sans reboot** (contrat §4.2 : `RtspSessionName` testé writable live) ; `StatusId = 0` (OK).
- **PASS si** : un `GET /Device/StreamTransmit` **côté device** montre `Streams[0].RtspSessionName == "UAT-STREAM-X"` **ET** le module a loggé un `StatusId 0` pour ce POST **ET** la variable Companion `stream_name` reflète `UAT-STREAM-X` au poll suivant.
- **Pièges** : ❌ **Anti-faux-positif majeur** : ne PAS conclure PASS sur la seule variable Companion `stream_name` — elle peut refléter ce que le module *croit* avoir écrit, pas l'état device. La preuve est le **GET côté device** (`Streams[0]` par position, pas par UUID). ⚠️ `Streams[0]` est ciblé **par position** : vérifier `Streams[0]`, pas un autre index. ⚠️ Si `StatusId` loggé ≠ 0 → écriture refusée (FAIL, noter le StatusId). Restaurer le nom d'origine après le test (relever la valeur initiale avant — `.10` réel : `DM-NVX-360-C442684E534B`, mais le device labo peut différer → `<à confirmer au labo>`).
- **Lockout** : 0.
- **Postcondition** : nom restauré à sa valeur initiale.

#### ENC-02 · set_multicast_address → `MulticastAddress` réellement changée `[HUMAN]`
- **Précondition** : depuis ENC-01 (connecté). Adresse témoin multicast valide, ex. `239.9.9.9`.
- **Action** : `[AUTO]` déclencher `set_multicast_address` avec `address = 239.9.9.9`. Puis `[HUMAN]`/GET relire le device.
- **Attendu** : POST `{"Device":{"StreamTransmit":{"Streams":[{"MulticastAddress":"239.9.9.9"}]}}}` sur `Streams[0]`.
- **PASS si** : `GET /Device/StreamTransmit` device → `Streams[0].MulticastAddress == "239.9.9.9"` **ET** `StatusId 0` loggé **ET** variable `multicast_address` = `239.9.9.9` au poll suivant.
- **Pièges** : ⚠️ Écriture **inférée** : seul `RtspSessionName` est testé POST end-to-end (§4.2/§5.1) ; `MulticastAddress` est sur le **même tableau `Streams[0]`** donc présumé identique, mais c'est **le premier POST réel sur ce champ** → noter explicitement le résultat (confirme ou infirme l'inférence). ❌ Anti-faux-positif : croiser le device, pas seulement la variable. ⚠️ Valeur d'origine `.10` = `239.1.1.4` (fixture) ; sur le device labo → `<à confirmer au labo>` avant test pour restauration.
- **Lockout** : 0.
- **Postcondition** : adresse multicast restaurée à sa valeur initiale.

#### ENC-03 · enable_stream / disable_stream → stream démarré/arrêté côté device `[HUMAN]`
- **Précondition** : depuis ENC-02 (connecté). Relever l'état initial du stream (`Status`) avant de le perturber.
- **Action** : `[AUTO]` déclencher `disable_stream`, attendre, relire device + variable ; puis `[AUTO]` déclencher `enable_stream`, attendre, relire device + variable.
- **Attendu** : `disable_stream` POST `{… "Streams":[{"Stop":true}]}` → `Streams[0].Status == "Stream Stopped"` ; `enable_stream` POST `{… "Streams":[{"Start":true}]}` → `Streams[0].Status == "Stream started"` (chaînes **exactes**, casse incluse — §5.2). `StatusId 0` à chaque POST.
- **PASS si** : on **observe la transition** côté device `Stream started → Stream Stopped` (disable) **puis** `Stream Stopped → Stream started` (enable) — les **deux** transitions — **ET** la variable `stream_enabled` passe `true→false` puis `false→true` en miroir **ET** `StatusId 0` aux deux POST.
- **Pièges** : ❌ **Preuve par la transition, pas l'état final** (§19) : « le stream est started à la fin » peut signifier qu'il l'était déjà et que rien ne s'est passé. Voir le passage par `Stream Stopped` est la preuve. ⚠️ Le code calcule `stream_enabled` depuis **`Status`** (`Status === 'Stream started'`), **pas** depuis `Start`/`Stop` — donc vérifier `Status` côté device, c'est l'autorité. ⚠️ Écriture `Start`/`Stop` **inférée** (non testée end-to-end §5.1) → noter le résultat réel. ⚠️ Laisser un délai ≥ 1 intervalle de poll pour que la variable se rafraîchisse (ne pas lire `stream_enabled` instantanément après le POST).
- **Lockout** : 0.
- **Postcondition** : stream **remis dans son état initial** (relevé en précondition).

#### ENC-05 · variables encoder reflètent l'état réel `[HUMAN]`
- **Précondition** : depuis ENC-03, stream dans un état connu et **stable** (ne plus le modifier).
- **Action** : `[HUMAN]`/GET lire `GET /Device/StreamTransmit` côté device (vérité terrain) ; `[AUTO]` lire les 4 variables Companion (`stream_name`, `multicast_address`, `encoder_url`, `stream_enabled`).
- **Attendu** : chaque variable = la valeur réelle de `Streams[0]` côté device : `stream_name = Streams[0].RtspSessionName` ; `multicast_address = Streams[0].MulticastAddress` ; `encoder_url = Streams[0].StreamLocation` (URL RTSP **calculée par le device**, lecture seule — ex. fixture `.10` : `rtsp://192.168.2.10:554/live.sdp`) ; `stream_enabled = (Streams[0].Status === "Stream started")`.
- **PASS si** : les 4 variables **égalent** les valeurs lues côté device sur `Streams[0]` (pas « non vides » — **égales**), `stream_enabled` cohérent avec `Status`.
- **Pièges** : ❌ Anti-faux-positif (§18) : une variable peuplée ne prouve rien — comparer **valeur à valeur** avec le GET device. ⚠️ `encoder_url`/`StreamLocation` est **vide (`""`)** sur un stream **au repos** (observé : `Streams[1..3]` de la fixture) — donc si le stream est arrêté, `encoder_url` vide est **correct**, pas un bug. ⚠️ Lire `Streams[0]` (position), jamais un autre index.
- **Lockout** : 0.
- **Postcondition** : inchangé (lecture seule).

#### ENC-06 · feedbacks encoder corrects sur boutons `[AUTO]`
- **Précondition** : depuis ENC-05 (connecté, état stream stable). Préparer 3 boutons Companion avec : feedback `is_encoder`, feedback `stream_enabled`, feedback `stream_name_matches` (option `name` = le nom réel courant du stream, relevé en ENC-05).
- **Action** : `[AUTO]` observer les 3 boutons ; puis pour `stream_enabled`, basculer l'état du stream (réutiliser ENC-03) et re-observer ; pour `stream_name_matches`, mettre une fois la **bonne** valeur, une fois une valeur **fausse**.
- **Attendu** : `is_encoder` actif (role = Transmitter) ; `stream_enabled` actif **ssi** `stream_enabled == true` ; `stream_name_matches` actif **ssi** l'option `name` == `stream_name` courant.
- **PASS si** : `is_encoder` est **actif** (couleur) ; `stream_enabled` suit l'état réel (actif quand started, inactif quand stopped) **avec transition observée** ; `stream_name_matches` actif sur la bonne valeur **et** inactif sur la fausse.
- **Pièges** : ⚠️ Les feedbacks lisent l'état **du dernier poll** (`state()` closure) : laisser passer un poll après un changement avant de juger. ❌ Ne pas tester `stream_name_matches` uniquement sur la bonne valeur — le cas **faux** (doit être inactif) prouve la discrimination. ⚠️ `is_encoder` est un feedback **niveau connexion** (toujours enregistré), pas un feedback de panneau : il dépend de `device_role`, pas de l'activation du panneau.
- **Lockout** : 0.
- **Postcondition** : inchangé.

#### ENC-07 · Non-régression v0.1 — heartbeat + reconnexion intacts `[AUTO]`/`[HUMAN]`
- **Précondition** : connecté en mode Transmitter (le poll généralisé v0.2 inclut le panneau `deviceInfo` toujours-actif).
- **Action** : **rejouer toute la Phase B** (B1→B5) sur la session active, puis rejouer un cas type **C1** (CONN-DROP) `[HUMAN]` pour vérifier `scheduleReconnect`.
- **Attendu** : Phase B intégralement verte (le `poll()` généralisé n'a pas cassé le heartbeat) : `device_name`, `firmware_version`, `ip_address`, `connection_status`, feedback `connected`, toggle verbose. Et la coupure device → `connection_status` déconnecté → reconnexion auto au retour.
- **PASS si** : B1–B5 **tous PASS** (mêmes critères que v0.1 — `device_name`/`firmware_version` = vérité terrain device) **ET** transition vert→rouge→vert observée sur la coupure/reprise (preuve de `scheduleReconnect`, identique v0.1).
- **Pièges** : ❌ Régression silencieuse : `device_name`/`firmware_version` sont désormais peuplées par le **panneau `deviceInfo`** (et non plus par l'ancien `getDeviceInfo()`), via `Device.DeviceInfo.Name` / `.DeviceVersion`. Si elles restent vides alors que `connected` est vert → régression de migration (le panneau deviceInfo n'a pas peuplé) = **FAIL bloquant**, remonter. ⚠️ `scheduleReconnect` : après reconnexion, `detectAndRegister()` re-tourne → re-vérifier que le panneau encoder est toujours actif (CAP-01 implicite). ⏱️ Reconnexion : attendre (retry à 10 s), ne pas conclure à 2 s.
- **Lockout** : 0 (C1 coupe le **réseau/alim device**, pas d'échec d'auth).
- **Postcondition** : reconnecté, encoder actif.

## v0.3 — Decoder (StreamReceive) 🔲 à compléter
## v0.4 — Audio & Vidéo I/O 🔲 à compléter
## v0.5 — Device Operations & Mode 🔲 à compléter

> Déplacé ici depuis v0.2 (la bascule de mode n'existe PAS dans le code v0.2 — reboot non testé empiriquement, cf. spec §5 et `hardware-validation.md` §6/§8) :
- **ENC-04 (→ MODE-xx)** `set_stream_mode → Encoder` (POST `Device.DeviceSpecific.DeviceMode = "Transmitter"`) → device en mode encodeur **après reboot** (`StatusId 1` = reboot needed, §4.2). À tester en créneau labo dédié avec accord opérateur (impact device : reboot). 🔲 à compléter au format complet quand v0.5 sera spécifiée.

---

## Journal des sessions UAT

| Date | Version(s) | Résultat | Notes |
|---|---|---|---|
| 2026-06-10 | v0.1.0 | PASS | Auth + heartbeat + variables + logging validés (DM-NVX-360, fw 7.1.5259) — avant formalisation de ce plan |
| 2026-06-11 | v0.1 (partiel, sans device) | GO PARTIEL | Run autonome Playwright. A1/C2/B5 = PASS (3/3) ; A2,A3,B1–B4,C1,C3 = `[-]` (device DM-NVX-360 injoignable). 0 FAIL, 0 régression. Instance jetable (192.0.2.1) supprimée, `Crestron_NVX` jamais activée (lockout intact). Détail : `docs/uat-runs/2026-06-11-v0.1-partial.md`. Reste à valider en créneau labo. |
