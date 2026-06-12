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

## v0.2 — Encoder (StreamTransmit) 🔲 à compléter après le gate hardware

> Cas concrets figés après la capture (chemins JSON vérifiés), au **même format** (précondition / action / attendu / PASS si / pièges / postcondition + `[AUTO]`/`[HUMAN]`). Intentions :
- **ENC-01** `set_stream_name` → nom du stream changé **réellement** (re-vérifier via GET côté device, pas seulement la variable Companion). `[HUMAN]` vérif device.
- **ENC-02** `set_multicast_address` → adresse changée réellement.
- **ENC-03** `enable_stream`/`disable_stream` → stream démarré/arrêté (statut device).
- **ENC-04** `set_stream_mode → Encoder` → device en mode encodeur.
- **ENC-05** variables encoder reflètent l'état réel (croiser device).
- **ENC-06** feedbacks `is_encoder`/`stream_enabled`/`stream_name_matches` corrects.
- **ENC-07** **Non-régression** : le polling généralisé n'a pas cassé le heartbeat v0.1 → **rejouer toute la Phase B**.

## v0.3 — Decoder (StreamReceive) 🔲 à compléter
## v0.4 — Audio & Vidéo I/O 🔲 à compléter
## v0.5 — Device Operations & Mode 🔲 à compléter

---

## Journal des sessions UAT

| Date | Version(s) | Résultat | Notes |
|---|---|---|---|
| 2026-06-10 | v0.1.0 | PASS | Auth + heartbeat + variables + logging validés (DM-NVX-360, fw 7.1.5259) — avant formalisation de ce plan |
| 2026-06-11 | v0.1 (partiel, sans device) | GO PARTIEL | Run autonome Playwright. A1/C2/B5 = PASS (3/3) ; A2,A3,B1–B4,C1,C3 = `[-]` (device DM-NVX-360 injoignable). 0 FAIL, 0 régression. Instance jetable (192.0.2.1) supprimée, `Crestron_NVX` jamais activée (lockout intact). Détail : `docs/uat-runs/2026-06-11-v0.1-partial.md`. Reste à valider en créneau labo. |
