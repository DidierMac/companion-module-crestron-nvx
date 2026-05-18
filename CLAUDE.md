# Bitfocus Companion — Module Crestron DM NVX

## Contexte du projet

Ce projet est un **module Bitfocus Companion** pour contrôler les appareils **Crestron DM NVX** (encodeurs/décodeurs AV-over-IP) via leur API REST.

Bitfocus Companion (v4.x) est un logiciel open-source qui permet de contrôler des équipements broadcast et AV depuis une surface de contrôle (Elgato Stream Deck, etc.). Les modules sont des plugins TypeScript qui s'interfacent avec des appareils tiers.

## Documentation de référence

### Bitfocus Companion
- **Dépôt principal** : https://github.com/bitfocus/companion
- **Site développeurs** : https://companion.free/for-developers/
- **SDK module (npm)** : `@companion-module/base` — https://github.com/bitfocus/companion-module-tools
- **Exemples de modules existants** : https://github.com/bitfocus?q=companion-module-
- **Version Companion ciblée** : 4.x (runtime Node.js 18+)

### Crestron DM NVX REST API
- **Documentation officielle** : https://sdkcon78221.crestron.com/sdk/DM_NVX_REST_API/Content/Topics/Home.htm
- **Version firmware documentée** : 7.3.5
- **Protocole** : HTTPS REST, JSON (objets "CresNext")
- **Authentification** : POST `/userlogin` avec `{ login, passwd }`, réponse avec session token
- **Format des requêtes** : `{ "Device": { "<Subsystem>": { "<Property>": <value> } } }`
- **Format des réponses** : même structure imbriquée

#### Endpoints principaux connus
| Endpoint | Description |
|---|---|
| `POST /userlogin` | Authentification |
| `GET /Device/DeviceInfo` | Infos appareil (nom, firmware) |
| `GET/POST /Device/AvSignal` | Mode stream, URL, multicast, signaux HDMI |
| `GET/POST /Device/AudioControl` | Volume, mute |
| `GET/POST /Device/VideoSwitch` | Sélection d'entrée vidéo active |
| `POST /Device/DeviceOperations` | Reboot |

**Note importante** : les chemins JSON exacts peuvent varier selon le firmware. Il faut vérifier sur un appareil réel. La structure de base est toujours `Device > <Subsystem> > <Property>`.

## Architecture du module

```
companion-module-crestron-nvx/
├── companion/
│   └── manifest.json       # Métadonnées du module (id, name, version...)
├── src/
│   ├── index.ts            # Classe principale CrestronNvxInstance (InstanceBase)
│   ├── config.ts           # Champs de configuration UI (IP, port, auth, polling)
│   ├── api.ts              # Client REST NVX (login, poll, commandes)
│   ├── actions.ts          # Actions Companion (routing, audio, stream)
│   ├── feedbacks.ts        # Feedbacks Companion (couleurs boutons selon état)
│   ├── variables.ts        # Définitions des variables Companion
│   └── presets.ts          # Presets prêts à l'emploi
├── package.json
└── tsconfig.json
```

## Fonctionnalités ciblées

### Actions (commandes envoyées à l'appareil)
- Définir l'URL du stream source (routing décodeur)
- Basculer en mode Encoder / Decoder
- Définir le nom du stream (encodeur)
- Définir l'adresse multicast (encodeur)
- Sélectionner l'entrée HDMI active
- Muter / démuter l'audio
- Toggle mute audio
- Régler le volume (absolu et relatif)
- Redémarrer l'appareil

### Feedbacks (état visuel des boutons)
- Mode actuel (encoder/decoder)
- URL de stream active (comparaison)
- Nom de stream actif (comparaison)
- Audio muté
- Volume au-dessus d'un seuil
- Signal HDMI entrée présent
- Signal HDMI sortie présent
- Appareil connecté

### Variables Companion
`$(crestron-nvx:stream_mode)`, `$(crestron-nvx:stream_url)`, `$(crestron-nvx:stream_name)`,
`$(crestron-nvx:multicast_address)`, `$(crestron-nvx:video_source)`, `$(crestron-nvx:video_source_name)`,
`$(crestron-nvx:audio_muted)`, `$(crestron-nvx:audio_volume)`,
`$(crestron-nvx:hdmi_input_signal)`, `$(crestron-nvx:hdmi_output_signal)`,
`$(crestron-nvx:device_name)`, `$(crestron-nvx:firmware_version)`,
`$(crestron-nvx:ip_address)`, `$(crestron-nvx:connection_status)`

## Points techniques à valider / améliorer

1. **Authentification NVX** : vérifier si le token de session est retourné dans le body JSON ou via cookie `Set-Cookie`. Certains firmwares utilisent un cookie `sessionid`, d'autres un header Bearer. Le code actuel dans `api.ts` gère les deux cas partiellement.

2. **Endpoints JSON exacts** : les chemins comme `Device.AvSignal.StreamUrl`, `Device.AudioControl.AudioMuted` etc. sont à valider sur un vrai appareil. La doc Crestron en ligne est la référence.

3. **Polling vs WebSocket** : l'API NVX est REST stateless. Le module utilise un polling HTTP toutes les N ms (configurable). Si l'API NVX supporte des webhooks ou des subscriptions, c'est une amélioration possible.

4. **Gestion multi-appareils** : chaque instance du module contrôle un seul appareil NVX. Pour un réseau NVX (plusieurs encodeurs/décodeurs), l'utilisateur crée plusieurs instances dans Companion.

5. **Routing cross-device** : le routing vidéo consiste à donner l'URL RTSP/multicast de l'encodeur source au décodeur. Il n'y a pas d'API centrale de switching — c'est géré côté décodeur.

## Stack technique

- **Langage** : TypeScript strict
- **Runtime** : Node.js 18+
- **SDK** : `@companion-module/base` v1.8+
- **HTTP** : module `https` natif Node.js (pour supporter les certificats auto-signés Crestron)
- **Build** : `tsc` (TypeScript compiler)

## Commandes de développement

```bash
npm install          # Installer les dépendances
npm run build        # Compiler TypeScript -> dist/
npm run build:watch  # Compilation en mode watch
```

### Test en local avec Companion
1. Installer Companion v4.x
2. Lancer Companion
3. Ouvrir `http://localhost:8000`
4. Aller dans Settings > Developer > Load unpacked module
5. Pointer vers ce dossier

Ou utiliser `module-local-dev` du dépôt Companion :
```bash
# Dans le dépôt companion
COMPANION_MODULE_LOCAL=../Companion_ModuleCrestron yarn dev
```

## État actuel du code

Le code est fonctionnel structurellement mais **non testé sur un vrai appareil**. Les principales incertitudes sont :
- La structure exacte des réponses JSON de l'API NVX (chemins des propriétés)
- La mécanique précise d'authentification (cookie vs token JSON)
- Les noms exacts des propriétés pour le routing vidéo

**Priorité de travail suggérée** :
1. Tester la connexion et l'authentification (`api.ts` — méthode `login()`)
2. Valider `getDeviceStatus()` sur un vrai appareil et corriger les chemins JSON
3. Tester les actions une par une
4. Affiner les feedbacks et presets
