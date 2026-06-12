# Hardware Validation — DM NVX (gate hardware)

> **Source de vérité unique des chemins JSON observés sur appareil réel.**
> Tout chemin affirmé ici est **tracé** dans un dump capturé cité (`docs/hardware-validation/raw/<host>/`).
> Distinction stricte appliquée partout : **observé** (vu dans le dump cité) / **doc** (doc Crestron, non vérifié sur notre matériel) / **hypothèse** (déduit, non confirmé empiriquement).
>
> **Cette version supersède intégralement la précédente.** L'ancienne concluait « mode encoder/decoder ABSENT — bloquant v0.2 » à partir d'un seul Receiver et de 6 endpoints. C'est **RÉSOLU** (voir §3) : capture exhaustive de **3 appareils** (Receiver, 2 Transmitters, dont un encodeur pur), tous sous-systèmes énumérés depuis la racine `/Device`, plus un **test d'écriture POST end-to-end réversible**.

---

## 0. Contexte de capture — 3 appareils réels

| Modèle | IP | DeviceMode | Firmware | Nb sous-systèmes (clés sous `Device`) | Dossier raw |
|---|---|---|---|---|---|
| **DM-NVX-360** | 192.168.2.9 | **Receiver** | 7.1.5259.00090 | 43 | `raw/192.168.2.9/` |
| **DM-NVX-360** | 192.168.2.10 | **Transmitter** (stream ACTIF) | 7.1.5259.00090 | 44 | `raw/192.168.2.10/` |
| **DM-NVX-E30** (encodeur pur) | 192.168.2.11 | **Transmitter** (stream ACTIF) | 7.1.5259.00090 | 34 | `raw/192.168.2.11/` |

- Date de capture : **2026-06-12**. Outil : `scripts/capture-nvx.ts` (client `NvxApiClient` validé v0.1) ; énumération exhaustive depuis `GET /Device` + dumps isolés par sous-système.
- Le **comptage de sous-systèmes** ci-dessus = nombre de clés sous `Device` dans le `Device.json` racine de chaque host (43 / 44 / 34), **observé** (`python3 len(d['Device'].keys())`). La seule clé que `.10` a en plus de `.9` est `TestPatternConfig` (objet lié à l'émetteur). `.9` n'a aucune clé absente de `.10`.
- **Caveat firmware** : la doc Crestron officielle (`docs/api-reference.md`, `https://sdkcon78221.crestron.com/sdk/DM_NVX_REST_API/`) est tamponnée **7.3.5** et couvre toute la série NVX. Notre matériel plafonne à **7.1.5259.00090**. On fige **ce qui est observé sur 7.1**. L'objet `DeviceSpecific` v2.4.0 (qui porte le mode) est validé empiriquement sur 7.1.
- **Sécurité capture** : le device caviarde les mots de passe en GET — `IpTable.Password` et `IpTableV2.Password` = `"********"`, `Ieee8021x.Password` = `"FALSE"` (observé `raw/192.168.2.9/Device_IpTable.json`, `Device_IpTableV2.json`, `Device_Ieee8021x.json`). Aucun secret réel n'est présent dans les captures ni dans ce doc.

---

## 1. DeviceInfo — `GET /Device/DeviceInfo`

Dumps : `raw/<host>/Device_DeviceInfo.json`. Racine `Device.DeviceInfo`.

| Chemin (présumé code/doc) | Statut | Type | Valeurs réelles observées |
|---|---|---|---|
| `Device.DeviceInfo.Name` | ✅ CONFIRMÉ | String | `.9` `"DM-NVX-360-00107FF7D99A"` · `.10` `"DM-NVX-360-C442684E534B"` · `.11` `"DM-NVX-E30-00107FEA8A32"` |
| `Device.DeviceInfo.DeviceVersion` | ✅ CONFIRMÉ | String | `"7.1.5259.00090"` (les 3) |
| `Device.DeviceInfo.Model` | ✅ CONFIRMÉ | String | `"DM-NVX-360"` (.9/.10) · `"DM-NVX-E30"` (.11) |

`src/api.ts::getDeviceInfo()` lit ces 3 chemins → **tous confirmés sur les 3 modèles**, aucune correction heartbeat.

Propriétés additionnelles **observées** (non lues par le code) : `SerialNumber`, `MacAddress` (séparateur **point** : `00.10.7f.f7.d9.9a` — pas deux-points), `Manufacturer` (`"Crestron"`), `Category` (`"DM"`), `DeviceId`, `BuildDate` (`"Jul 16 2025  (575583)"`), `PufVersion`, `RebootReason`, `Devicekey`, `Version` (`"2.1.0"` = schéma de l'objet). `.10` expose en plus `DeviceCertId` (observé `raw/192.168.2.10/Device_DeviceInfo.json`).

---

## 2. DeviceSpecific — `GET /Device/DeviceSpecific` — **porte le mode** (cœur §3)

Dumps : `raw/<host>/Device_DeviceSpecific.json`. Racine `Device.DeviceSpecific`. Schéma `Version` = `"2.4.0"` (observé les 3).

| Chemin | Statut | Type | Valeurs réelles | Accès |
|---|---|---|---|---|
| `Device.DeviceSpecific.DeviceMode` | ✅ CONFIRMÉ | String (énum) | `"Receiver"` (.9) · `"Transmitter"` (.10, .11) | GET (lecture) ; POST → **reboot requis** (voir §4) |
| `Device.DeviceSpecific.Version` | ✅ CONFIRMÉ | String | `"2.4.0"` | GET |

Autres propriétés **observées** (3 hosts, sauf indication) : `ActiveVideoSource` (`"None"`), `ActiveAudioSource` (`"NoAudioSelected"`), `AudioSource` (`"AudioFollowsVideo"`), `VideoSource` (`"None"`), `AutoInitiationMode` (`true`), `AutoInputRoutingEnabled` (`true`), `DeviceReady` (`0`), `IsFrontPanelLockoutEnabled` (`false`), `LedsEnabled` (`true`), `MotionDetected` (`"NoSync"`), `ShowSetupInformationOnOsd` (`false`), `VideoWallMode` (`0`).
Propriétés présentes sur le 360 mais **absentes sur le E30** (observé `raw/192.168.2.11/Device_DeviceSpecific.json`) : `AudioMode` (`"Insert"`), `NaxActiveAudioSource`, `NaxAudioSource`, `NaxAudioSourceOptionsName`, `NaxAudioSourceOptionsVersion`.

---

## 3. ✅ POINT CRITIQUE v0.2 — Mode encoder / decoder : **RÉSOLU**

> Question historique du brief (la moins documentée) : « où se lit/écrit le MODE encoder vs decoder ? »
> **Réponse empirique : `Device.DeviceSpecific.DeviceMode`.**

### 3.1 Où se lit le mode — CONFIRMÉ
- **Lecture** : `GET /Device/DeviceSpecific` → `Device.DeviceSpecific.DeviceMode`, String énum `"Receiver"` | `"Transmitter"`.
  Observé : `.9 = "Receiver"`, `.10 = "Transmitter"`, `.11 = "Transmitter"`.
- L'ancien champ présumé **`StreamMode` (`"Encoder"`/`"Decoder"`) est ABSENT** : `grep "StreamMode"` sur les 3 `Device.json` racine renvoie **0** occurrence. ❌ réfuté définitivement. Vocabulaire réel = **Receiver/Transmitter**, pas Encoder/Decoder.

### 3.2 Le mode ne change **PAS** la structure JSON — CONFIRMÉ
- Sur le **360** (`.9` Receiver **et** `.10` Transmitter), `StreamTransmit` **ET** `StreamReceive` sont tous deux présents et **peuplés** (4 streams chacun) — quel que soit le mode.
  Preuve : `raw/192.168.2.10/Device_StreamReceive.json` (host en **Transmitter**) = objet `dict`, `Streams` longueur **4**, `Version "2.0.1"` (observé). Donc un Transmitter expose quand même un `StreamReceive` complet.
- ➡️ Conséquence module : **ne pas** déduire le mode de la présence/absence de `StreamTransmit`/`StreamReceive`. Le mode se lit **uniquement** sur `DeviceMode`.

### 3.3 Ce qui change la forme = le **MODÈLE**, pas le mode — CONFIRMÉ
- Le **E30** (encodeur pur) **n'expose pas** `StreamReceive` ni 9 autres sous-systèmes (voir §6). C'est une différence **matérielle** (le E30 n'a pas de fonction décodeur), pas un effet du mode.

---

## 4. Contrat d'écriture (POST) — **testé end-to-end** (`scripts/probe-post.ts`)

Test réalisé sur `.9` (Receiver, `StreamTransmit` au repos → impact nul), valeur écrite puis **restaurée** (`scripts/probe-post.ts`). POST sur `/Device` avec l'enveloppe CresNext `{"Device":{"StreamTransmit":{"Streams":[{…}]}}}`.

### 4.1 Enveloppe de réponse POST (observée via le test)
```json
{
  "Actions": [
    {
      "Operation": "SetPartial",
      "Results": [
        { "Path": "Device.StreamTransmit.Streams[0]", "Property": "RtspSessionName", "StatusId": 0, "StatusInfo": "OK" }
      ],
      "TargetObject": "StreamTransmit",
      "Version": "2.1.0"
    }
  ]
}
```

### 4.2 Règles d'écriture établies empiriquement
| Règle | Détail |
|---|---|
| **StatusId** | `0` = OK · `1` = **Reboot needed** (« Reboot needed », doc + observé pour `DeviceMode`). Le module doit lire `Actions[].Results[].StatusId`. |
| **Adressage tableau par POSITION** | POST `Streams:[{…}]` modifie **`Streams[0]`** et **laisse les autres intacts**. Pour cibler `Streams[i]`, envoyer un tableau de longueur `i+1` dont les positions `0..i-1` sont `{}` (objets vides) et la position `i` porte les champs. C'est le pattern utilisé/validé par `probe-post.ts` (restauration). **Pas d'adressage par UUID.** |
| **LIVE vs reboot** | `RtspSessionName` s'applique **LIVE, sans reboot** (vérifié : écrit → relu modifié → restauré). `DeviceMode` **rebote** (StatusId 1). |
| **Endpoint POST** | `/Device` (racine), corps = enveloppe CresNext partielle. Réponse = objet `Actions[]` (≠ format GET qui est `{"Device":{…}}`). |

> Le module v0.2 doit traiter la **réponse POST** (`Actions[].Results[].StatusId`) différemment de la réponse GET (`Device.<Subsystem>`). `src/api.ts::post()` ne fait aujourd'hui qu'un `JSON.parse` brut ; l'interprétation du StatusId est à coder en v0.2.

---

## 5. StreamTransmit (ENCODER) — `GET /Device/StreamTransmit` — **mapping v0.2**

Dumps : `raw/<host>/Device_StreamTransmit.json`. Racine `Device.StreamTransmit.Streams[]` (**4** streams) + `Version` `"2.1.7"`. **`Streams[0]` = stream actif** sur les émetteurs.
Ancré sur les **émetteurs actifs** `.10` et `.11` (sur `.9` Receiver, `StreamTransmit` est au repos / vide).

### 5.1 Mapping v0.2 Encoder (chemins `Device.StreamTransmit.Streams[i].<prop>`)

| Action / variable v0.2 | Propriété (chemin réel) | Type | Exemple réel observé | Accès |
|---|---|---|---|---|
| Nom du stream | `…Streams[i].RtspSessionName` | String | `.10` `"DM-NVX-360-C442684E534B"` · `.11` `"DM-NVX-E30-00107FEA8A32"` (Streams[0] actifs) | GET + **POST testé LIVE** (§4) |
| Adresse multicast | `…Streams[i].MulticastAddress` | String | `.10` `"239.1.1.4"` · `.11` `"239.1.1.6"` (Streams[0]) ; `""` sur les streams au repos | GET + POST (inféré, même tableau) |
| URL du stream (RTSP) | `…Streams[i].StreamLocation` | String | `.10` `"rtsp://192.168.2.10:554/live.sdp"` · `.11` `"rtsp://192.168.2.11:554/live.sdp"` | GET (lecture — URL calculée) |
| Démarrer le stream | `…Streams[i].Start` | Boolean | `true` (Streams[0] actifs) / `false` (repos) | POST (commande — inféré) |
| Arrêter le stream | `…Streams[i].Stop` | Boolean | `false` | POST (commande — inféré) |
| État du stream | `…Streams[i].Status` | String | `"Stream started"` (actif) / `"Stream Stopped"` (repos) | GET (lecture seule) |
| Mode transport | `…Streams[i].TransportMode` | String (énum) | `"MPEG2TSRTP"` | GET + POST (inféré) |

> **Discrimination URL résolue** (l'ancien doute `StreamLocation` vs `StreamSource` est tranché par les émetteurs actifs) : sur stream actif, **`StreamLocation`** porte l'URL RTSP complète (`rtsp://<ip>:554/live.sdp`, observé `.10`/`.11`), tandis que **`StreamSource`** reste `""`. ➡️ Pour la variable « URL du stream encodeur », lire **`StreamLocation`**.
>
> **`RtspSessionName` = nom du stream** : confirmé writable LIVE par le test POST §4 (l'ancienne « hypothèse à confirmer » est désormais établie).

### 5.2 Énumérations réelles observées
- `TransportMode` : `"MPEG2TSRTP"` (StreamTransmit, les 3 actifs) ; `"RTP"` aussi observé dans `StreamReceive.Streams[2..3]` (`.9`). L'ancienne énum doc `"RTP"/"RTSP"/"TS"` est **incomplète** ❌. Recenser exhaustivement avant un sélecteur d'énum (2 valeurs observées : `MPEG2TSRTP`, `RTP`).
- `Status` : `"Stream started"` / `"Stream Stopped"` (observé). Comparer sur ces chaînes exactes (casse incluse).
- `SessionInitiation` : `"Multicast via RTSP"` (TX) ; `"ByReceiver"` aussi vu côté RX.

### 5.3 Propriétés complètes observées (StreamTransmit.Streams[i])
Toutes **observées** dans les dumps. Accès POST marqué **inféré** sauf `RtspSessionName` (testé §4).

`ActiveBitrate` (Number, `686`, Streams[0]), `Bitrate` (`750`), `BitrateMode` (`"Fixed"`), `IsAdaptiveBitrateMode` (`false`), `Dscp` (`32`), `FecMode` (`"Off"`), `EncodingResolution` (`"Auto"`), `StreamEncodingType` (`"Pixel Perfect Processing"`), `StreamProfile` (`"High"`), `StreamType` (`"Primary"`), `VideoFormat` (`"Pixel"` sur Streams[0], `"J2000"` ailleurs), `HdcpTransmitterMode` (`"Always"`), `MultiCastTtl` (`5`), `RtspPort` (`554`), `RtpVideoPort` (`49170`), `RtpAudioPort` (`49172`), `TsPort` (`4570`), `RtspStreamFileName` (`""`), `SnapshotUri`/`SnapshotFileName` (`""`), `NetworkAdapter` (`""`), `StreamSource` (`""`), `AudioChannels` (`0` ou `2`), `AudioFormat` (`"NoAudio"`), `AudioMode` (`"Manual"`), `IsAutomaticInitiationEnabled` (`true`), `IsPasswordProtectionEnabled` (`true`), `IsStatisticsEnabled` (`false`), `Username`/`Password` (`""` — pas de secret), `ElapsedSeconds`/`FramesPerSecond`/`HorizontalResolution`/`VerticalResolution`/compteurs paquets (`0`), `CodecReady`/`Pause`/`Processing` (`false`), `UUID` (présent sur Streams[0..1], **absent** sur Streams[2..3]), et sous-objet `Camera` (hors v0.2 — `CameraUri "Test.com"`, `CameraResolution "1280x720"`, etc.).

> ⚠️ **`UUID` (champ `Device.StreamTransmit.Streams[i].UUID`)** : présent uniquement sur Streams[0..1], absent sur Streams[2..3] (observé). **Ne pas indexer un stream par UUID** — utiliser la **position** dans le tableau (cohérent avec le contrat d'écriture §4.2).

---

## 6. Différences par modèle (360 vs E30)

Comparaison des clés sous `Device` (root `Device.json`), **observée**.

### 6.1 Sous-systèmes présents sur DM-NVX-360 mais **ABSENTS** sur DM-NVX-E30
**10 sous-systèmes** (E30 = encodeur pur, pas de décodeur ni de périphériques associés) :
`AvRouting`, `BackgroundImage`, `Dante`, `FanControl`, `ImageMgmnt`, `Osd`, `PortSelection`, **`StreamReceive`**, `Usb`, `XioSubscription`.
Inversement, le E30 n'a **aucun** sous-système absent du 360. (Vérifié par diff d'ensembles sur les 3 `Device.json`.)

### 6.2 Sentinelle modèle-dépendante — **contrainte de parsing**
Sur le E30, l'endpoint isolé `GET /Device/StreamReceive` ne renvoie **pas** un objet mais la **chaîne** :
```json
{ "Device": { "StreamReceive": "UNSUPPORTED PROPERTY, CHECK REST API!!!" } }
```
(observé `raw/192.168.2.11/Device_StreamReceive.json`). Dans le `Device.json` racine du E30, la clé `StreamReceive` est carrément **absente** (les deux comportements coexistent : sentinelle en endpoint isolé, omission en énumération racine).
➡️ **Contrainte module** : **tout** sous-système peut, selon le modèle, renvoyer cette chaîne sentinelle au lieu d'un objet. Le parsing doit tester `typeof valeur === 'object'` avant d'accéder aux sous-champs et traiter la chaîne `"UNSUPPORTED PROPERTY, CHECK REST API!!!"` (et l'absence de clé) comme **« sous-système absent »** — sans crasher.

### 6.3 Racine `/Device` = arbre complet, mais Uuids volatils
`GET /Device` contient le **contenu profond** de chaque sous-système, identique aux endpoints isolés.
**Caveat — OBSERVÉ dans le corpus** : les `Uuid` de `AudioVideoInputOutput.Inputs[]/Outputs[]/Ports[].Uuid` sont **régénérés à chaque requête HTTP**. Preuve : sur `.10`, le bloc `AudioVideoInputOutput` du `Device.json` racine et celui du dump isolé `Device_AudioVideoInputOutput.json` (= **deux GET distincts du même run de capture**) diffèrent sur **exactement** ces 4 feuilles `Uuid` (et seulement elles ; les 115 autres feuilles sont identiques). ➡️ **Ne JAMAIS utiliser ces `Uuid` comme identifiants stables.** Indexer par position (`Inputs[0]`, `Ports[0]`).

---

## 7. StreamReceive (DECODER) — `GET /Device/StreamReceive` — v0.3 (référence)

Dumps : `raw/192.168.2.9/Device_StreamReceive.json` (Receiver) et `raw/192.168.2.10/…` (Transmitter, **présent et peuplé**). Racine `Device.StreamReceive.Streams[]` (4) + `Version "2.0.1"`. **Absent/sentinelle sur E30** (§6.2).

Chemins clés **observés** (v0.3, hors périmètre v0.2) : `…Streams[i].StreamLocation` (`""`), `MulticastAddress` (`""`), `InitiatorAddress` (`""`), `Start`/`Stop` (`false`), `Status` (`"Stream Stopped"`), `RtspPort` (`554`), `RtpVideoPort`/`RtpAudioPort` (`49170/49172` ou `40000/40002`), `Buffer` (`1000`), `Volume` (Number `0`), `TcpMode` (`"Auto"`), `TransportMode` (`"MPEG2TSRTP"` ou `"RTP"`), `SessionInitiation` (`"Multicast via RTSP"` ou `"ByReceiver"`), `VideoFormat`, et un sous-objet `StreamTrustedCertifyingAuthorities` (certificats CA).
❌ Réfutation conservée : `AspectRatio` **absent** de `StreamReceive` (il est dans `AudioVideoInputOutput`, §8).

---

## 8. AudioVideoInputOutput — `GET /Device/AudioVideoInputOutput` — v0.4 (référence)

Dumps : `raw/<host>/Device_AudioVideoInputOutput.json`. Racine `Inputs[]` (1) + `Outputs[]` (1) + `Version "2.4.0"`.

| Présumé (doc) | Statut | Réel observé |
|---|---|---|
| `…Inputs[0].Ports[0].Audio.Mute` | ❌ ABSENT | aucune propriété `Mute` (ni Input ni Output) sur 7.1 |
| `…Inputs[0].Ports[0].Audio.Volume` | ❌ DIFFÉRENT (côté) | `Volume` est en **Output** : `…Outputs[0].Ports[0].Audio.Volume` (Number `0`) |
| `…Inputs[0].Ports[0].Audio.AudioTypeSelect` | ✅ CONFIRMÉ | `…Inputs[0].Ports[0].Audio.AudioTypeSelect` (Number `1`) |
| `VideoPortTypeSelect` dans `Ports[0]` | ❌ DIFFÉRENT (niveau) | au niveau `Inputs[0].VideoPortTypeSelect` (String `"Hdmi"`) |

Signaux HDMI (futurs feedbacks) — **observés** (tout `false`/`"No Signal"` au repos, sémantique à reconfirmer source+sink branchés) :
- entrée présente : `…Inputs[0].Ports[0].IsSyncDetected` (Boolean `false`)
- sortie transmet : `…Outputs[0].Ports[0].Hdmi.Transmitting` (Boolean `false`)
- sink connecté : `…Outputs[0].Ports[0].IsSinkConnected` (Boolean `false`)
- ❌ `HdmiInputSignal`/`HdmiOutputSignal` (booléens à plat) **absents**.

> **Différence modèle observée ici aussi** : sur le E30, `Outputs[0].Ports[0]` est de `PortType "Analog"` (audio seul : `Audio.Volume`/`Audio.Delay`, pas de bloc `Hdmi`), alors que le 360 a un Output HDMI complet (observé `raw/192.168.2.11/Device_AudioVideoInputOutput.json` vs `raw/192.168.2.9/…`). Encodeur pur → pas de sortie HDMI.

---

## 9. Endpoints utilitaires

- **DiscoveryConfig** — `GET /Device/DiscoveryConfig` (`raw/<host>/Device_DiscoveryConfig.json`) : `DiscoveryAgent` (`true`), `EnableDiscoverer` (`true`), `Ttl` (`"5"`), `Username`/`Password` (`""`), `Version "2.0.1"`. Hors périmètre AV.
- **DeviceOperations** — `GET /Device/DeviceOperations` (`raw/<host>/Device_DeviceOperations.json`) : `FirmwareUpgrade` (`""`), `ProjectType` (`""`), `UpgradeStatus` (`"Puf Upgrade Not Initiated"`), `Version "2.3.0"`. La clé `Reboot` **n'apparaît pas en GET** → non vérifiable en lecture seule. **Le reboot v0.2 passe par `DeviceMode` POST (StatusId 1)**, pas nécessairement par cet endpoint. ⚠️ Aucun POST reboot sans accord explicite opérateur.

---

## 10. Synthèse — écarts code/doc ↔ device

| Fichier | Écart | Correction |
|---|---|---|
| `CLAUDE.md` | endpoints `AvSignal`/`AudioControl`/`VideoSwitch` | ❌ remplacer par `StreamTransmit`/`StreamReceive`/`AudioVideoInputOutput`/`DeviceSpecific` |
| `CLAUDE.md` / `docs/api-reference.md` | `StreamMode "Encoder"/"Decoder"` | ❌ **n'existe pas** → `DeviceSpecific.DeviceMode "Receiver"/"Transmitter"` (§3) |
| `docs/api-reference.md` | login succès = `302` | ⚠️ réel = `200` (déjà géré dans `src/api.ts` ; doc à corriger) |
| `docs/api-reference.md` | `HdmiInputSignal`/`HdmiOutputSignal` | ❌ → `Inputs[0].Ports[0].IsSyncDetected` / `Outputs[0].Ports[0].Hdmi.Transmitting` |
| doc | audio `Mute`+`Volume` en Input | ❌ pas de `Mute` ; `Volume` en **Output** |
| doc | `TransportMode "RTP"/"RTSP"/"TS"` | ⚠️ incomplet — réel inclut `"MPEG2TSRTP"` |

**Code v0.2 à prévoir** : `src/api.ts::post()` interprète la réponse comme un GET (`Device.<Subsystem>`) ; la réponse POST réelle est `{"Actions":[{"Results":[{"StatusId":…}]}]}` (§4). Ajouter le parsing du StatusId (0 OK / 1 reboot) et le pattern d'adressage de tableau par position.

### Décision parallélisme (2 GET simultanés)
Les captures ont enchaîné de nombreux GET séquentiels (avec `AuthByPasswd` rolling) sur les 3 hosts sans échec. Le `probe-post.ts` enchaîne aussi GET→POST→GET séquentiellement sans souci. **Non testé** : 2 GET strictement simultanés (`Promise.all`) partageant le **même cookie jar** qui change à chaque réponse. **Hypothèse (sourcée par le cookie rolling) : préférer une file séquentielle** pour le poll multi-endpoint tant qu'un test `Promise.all` n'a pas prouvé l'absence de course sur le cookie. À trancher empiriquement avant de coder un poll concurrent.

---

## 11. NON testé empiriquement / à valider en UAT v0.2

| Sujet | Statut | À faire |
|---|---|---|
| **`set_stream_mode`** (écriture `DeviceMode`) | inféré (lecture confirmée ; StatusId 1 = reboot documenté) | tester un POST `DeviceMode` réel + cycle reboot en créneau labo dédié (impact device — accord opérateur requis) |
| **`enable/disable_stream`** fonctionnel | inféré (`Start`/`Stop`/`Status` observés ; pas de POST `Start`/`Stop` exécuté) | tester POST `Start:true`/`Stop:true` sur un émetteur et vérifier `Status` |
| **POST multicast / autres champs Streams** | inféré (même tableau que `RtspSessionName`, seul ce dernier est testé) | confirmer par POST réversible champ par champ |
| **Énumération exhaustive `TransportMode`** | partielle (2 valeurs) | recenser toutes les valeurs acceptées |
| **Sémantique signaux HDMI** | observée au repos (tout `false`) | reconfirmer avec source+sink branchés |
| **Régénération des `Uuid` AudioVideoInputOutput** | relayé du brief (1 capture/host dans mon corpus) | re-vérifier sur 2 GET successifs si on veut le re-prouver localement |
| **`Promise.all` (2 GET simultanés)** | non testé | tester avant tout poll concurrent (§10) |
| **Reboot via `DeviceOperations`** | non vérifiable en GET | jamais de POST reboot sans accord explicite |
