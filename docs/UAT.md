# UAT — Plan de non-régression (Crestron DM NVX)

> **Document vivant.** Chaque version livrée ajoute ses cas ici. À **chaque créneau labo**, avant de merger une nouvelle version sur `develop`, rejouer **toute** la checklist : la nouvelle version ET toutes les précédentes doivent passer. Un échec sur une version antérieure = **régression** → bloquer le merge.

## Protocole

1. Build + déploiement Docker à jour (voir mémoire `ops-workflow`).
2. Instance Companion configurée sur l'appareil réel.
3. Dérouler les sections **dans l'ordre des versions** (v0.1 → version courante).
4. Cocher `[x]` PASS, `[!]` FAIL (noter le détail), `[-]` non testable ce créneau.
5. Consigner la session dans le **journal** en bas.

## Environnement de test

| Élément | Valeur |
|---|---|
| Appareil | DM-NVX-360 |
| Firmware | 7.1.5259.00090 |
| IP | 192.168.2.9 (labo isolé d'internet) |
| Companion | v4.x (Docker local, http://localhost:8000) |

---

## v0.1.0 — Connexion, Auth, Heartbeat, Logging ✅ (livrée)

### Authentification
- [ ] **AUTH-01** Credentials valides → statut instance **OK / Connected** (vert).
- [ ] **AUTH-02** Mauvais mot de passe → statut **AuthenticationFailure**, **aucune boucle de reconnexion** (vérifier les logs : pas de tentatives répétées). ⚠️ Tester avec prudence (lockout : 1 seul essai erroné).
- [ ] **AUTH-03** Mot de passe vide → statut **BadConfig** **avant** tout appel réseau (aucune requête émise).
- [ ] **AUTH-04** `GET /logout` émis à la suppression/désactivation de l'instance.

### Connexion & robustesse
- [ ] **CONN-01** Appareil injoignable au démarrage → Companion **ne se fige pas / ne force pas de restart** ; `init()` rend la main vite ; statut reflète l'erreur.
- [ ] **CONN-02** Suppression/désactivation de l'instance (`destroy()`) → **aucune reconnexion fantôme** ensuite (logs/réseau).
- [ ] **CONN-03** Coupure du device en cours de session → `connection_status` passe à déconnecté ; tentatives de reconnexion selon la stratégie configurée ; au retour → reconnexion auto.

### Heartbeat & variables
- [ ] **HB-01** Connecté → `$(crestron-nvx:device_name)` = nom réel de l'appareil.
- [ ] **HB-02** Connecté → `$(crestron-nvx:firmware_version)` = firmware réel.
- [ ] **HB-03** `$(crestron-nvx:ip_address)` et `$(crestron-nvx:connection_status)` reflètent l'état réel.
- [ ] **FB-01** Feedback `connected` actif quand connecté, inactif sinon.

### Logging
- [ ] **LOG-01** Toggle verbose OFF → logs minimaux ; ON → logs détaillés avec préfixes `[INIT]`/`[AUTH]`/`[CONN]`/`[HTTP]`/`[POLL]`.

---

## v0.2 — Encoder (StreamTransmit) 🔲 à compléter après le gate hardware

> Les cas concrets seront figés après la capture (chemins JSON vérifiés). Intentions de test (à préciser) :
- [ ] **ENC-01** Action `set_stream_name` → le nom du stream change réellement sur l'appareil (revérifier via GET).
- [ ] **ENC-02** Action `set_multicast_address` → l'adresse multicast change réellement.
- [ ] **ENC-03** Action `enable_stream` / `disable_stream` → le stream démarre / s'arrête (statut device).
- [ ] **ENC-04** Action `set_stream_mode → Encoder` → l'appareil passe/est en mode encodeur.
- [ ] **ENC-05** Variables encoder (`stream_name`, `multicast_address`, `encoder_url`, `stream_enabled`, `stream_mode`) reflètent l'état réel.
- [ ] **ENC-06** Feedbacks `is_encoder`, `stream_enabled`, `stream_name_matches` corrects.
- [ ] **ENC-07** Le polling généralisé n'a pas cassé le heartbeat v0.1 (re-vérifier HB-01..03).

---

## v0.3 — Decoder (StreamReceive) 🔲 à compléter

## v0.4 — Audio & Vidéo I/O 🔲 à compléter

## v0.5 — Device Operations & Mode 🔲 à compléter

---

## Journal des sessions UAT

| Date | Version(s) testée(s) | Résultat | Notes |
|---|---|---|---|
| 2026-06-10 | v0.1.0 | PASS | Auth + heartbeat + variables + logging validés (DM-NVX-360, fw 7.1.5259) |
