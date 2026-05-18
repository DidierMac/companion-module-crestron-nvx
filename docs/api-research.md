# API Research — Crestron DM NVX + Companion SDK

Résultat des recherches de documentation effectuées le 2026-05-18.
Ce fichier est la source de vérité pour l'implémentation du module.

---

## Sources

| Source | URL |
|--------|-----|
| Crestron NVX REST API (firmware 7.3.5) | https://sdkcon78221.crestron.com/sdk/DM_NVX_REST_API/Content/Topics/ |
| → Authentification | `.../Authentication.htm` |
| → StreamTransmit object | `.../Objects/StreamTransmit.htm` |
| → StreamReceive object | `.../Objects/StreamReceive.htm` |
| → AudioVideoInputOutput object | `.../Objects/AudioVideoInputOutput.htm` |
| → DeviceInfo object | `.../Objects/DeviceInfo.htm` |
| → DeviceOperations object | `.../Objects/DeviceOperations.htm` |
| Companion SDK — @companion-module/base | https://github.com/bitfocus/companion-module-base |
| Companion module template TypeScript | https://github.com/bitfocus/companion-module-template-ts |
| NPM @companion-module/base | https://www.npmjs.com/package/@companion-module/base |
| NPM @companion-module/tools | https://www.npmjs.com/package/@companion-module/tools |

---

## 1. Authentification Crestron NVX

### Flux (2 étapes obligatoires)

```
Étape 1 — GET /userlogin.html
  → Réponse : Set-Cookie: TRACKID=<valeur>

Étape 2 — POST /userlogin.html
  Headers :
    Cookie: TRACKID=<valeur>
    Origin: https://<ip>
    Referer: https://<ip>/userlogin.html
    Content-Type: application/x-www-form-urlencoded
  Body (URL-encoded) :
    login=<username>&passwd=<password>

  Réponse succès : HTTP 302 (redirect vers /)
  Réponse échec  : HTTP 403
```

### Cookies à gérer (HTTPONLY — 6 au total)

| Cookie | Comportement |
|--------|-------------|
| `AuthByPasswd` | **Change après chaque réponse** — doit être mis à jour systématiquement |
| `TRACKID` | Constant pour toute la session |
| `iv` | Constant pour toute la session |
| `tag` | Constant pour toute la session |
| `userid` | Constant pour toute la session |
| `userstr` | Constant pour toute la session |

### Fin de session

```
GET /logout  →  supprime tous les cookies côté serveur
```

### Exemple JS officiel (extrait doc Crestron)

```javascript
const request = require('request');
const deviceHostname = 'https://172.30.1.1';
const loginPage = deviceHostname + '/userlogin.html';

request.post({
  url: loginPage,
  jar: true,                          // sauvegarde automatique des cookies
  agentOptions: { rejectUnauthorized: false },  // certs auto-signés
  form: { login: 'admin', passwd: 'admin' }
}, (error, response, body) => {
  if (response.statusCode === 302 && response.headers["location"] === '/') {
    // Authentification réussie
    request.get({ url: deviceHostname + '/Device/DeviceInfo', jar: true, ... })
  }
});
```

---

## 2. Propriétés JSON confirmées (firmware 7.3.5)

### `/Device/DeviceInfo` — GET uniquement

```json
{
  "Device": {
    "DeviceInfo": {
      "Name": "Encoder-1",
      "DeviceVersion": "7.3.5",
      "Model": "DM-NVX-E50",
      "SerialNumber": "NVXE501234567",
      "MacAddress": "00:1a:2b:3c:4d:5e",
      "Manufacturer": "Crestron",
      "RebootReason": "manual",
      "Version": "2.3.1"
    }
  }
}
```

### `/Device/StreamTransmit` — GET/POST (encodeur)

Structure : `Device.StreamTransmit.Streams[0].<Property>`

| Propriété | Type | Accès | Description |
|-----------|------|-------|-------------|
| `MulticastAddress` | String | GET/POST | ex: `"239.0.1.1"` |
| `TransportMode` | String | GET/POST | `"RTP"` \| `"RTSP"` \| `"TS"` |
| `Start` | Boolean | GET/POST | Démarrer le stream |
| `Stop` | Boolean | GET/POST | Arrêter le stream |
| `RtspPort` | Number | GET/POST | Défaut : 554 |
| `RtpVideoPort` | Number | GET/POST | Défaut : 40000 |
| `RtpAudioPort` | Number | GET/POST | Défaut : 40002 |
| `BitrateMode` | String | GET/POST | `"Fixed"` \| `"Adaptive"` \| `"Variable"` |
| `Bitrate` | Number | GET | Mbps courant (lecture seule) |
| `Status` | String | GET | État opérationnel (lecture seule) |
| `CodecReady` | Boolean | GET | Codec prêt (lecture seule) |
| `FramesPerSecond` | Number | GET | FPS courant (lecture seule) |
| `HorizontalResolution` | Number | GET | Largeur pixels (lecture seule) |
| `VerticalResolution` | Number | GET | Hauteur pixels (lecture seule) |

Exemple POST — démarrer stream :
```json
{
  "Device": {
    "StreamTransmit": {
      "Streams": [{ "MulticastAddress": "239.0.1.1", "TransportMode": "RTP", "Start": true }]
    }
  }
}
```

### `/Device/StreamReceive` — GET/POST (décodeur)

Structure : `Device.StreamReceive.Streams[0].<Property>`

| Propriété | Type | Accès | Description |
|-----------|------|-------|-------------|
| `StreamLocation` | String | GET/POST | URL RTSP/UDP ex: `"rtsps://192.168.1.100:554/stream"` |
| `MulticastAddress` | String | GET/POST | Adresse multicast source |
| `InitiatorAddress` | String | GET/POST | IP de l'encodeur source |
| `Start` | Boolean | GET/POST | Démarrer réception |
| `Stop` | Boolean | GET/POST | Arrêter réception |
| `RtspPort` | Number | GET/POST | Défaut : 554 |
| `RtpVideoPort` | Number | GET/POST | Défaut : 40000 |
| `RtpAudioPort` | Number | GET/POST | Défaut : 40002 |
| `Buffer` | Number | GET/POST | Cache vidéo (ms) |
| `Status` | String | GET | État (lecture seule) |
| `HorizontalResolution` | Number | GET | Largeur pixels (lecture seule) |
| `VerticalResolution` | Number | GET | Hauteur pixels (lecture seule) |
| `FramesPerSecond` | Number | GET | FPS (lecture seule) |
| `AspectRatio` | String | GET | ex: `"16:9"` (lecture seule) |
| `IsAutomaticInitiationEnabled` | Boolean | GET/POST | Auto-démarrage |

Exemple POST — configurer décodeur :
```json
{
  "Device": {
    "StreamReceive": {
      "Streams": [{ "StreamLocation": "rtsps://encoder.local:554/stream", "Start": true }]
    }
  }
}
```

### `/Device/AudioVideoInputOutput` — GET/POST

Structure : `Device.AudioVideoInputOutput.Inputs[0].Ports[0].Audio.<Property>`

| Propriété | Type | Accès | Plage |
|-----------|------|-------|-------|
| `Mute` | Boolean | GET/POST | `true` / `false` |
| `Volume` | Number | GET/POST | `-100` à `100` |
| `AudioTypeSelect` | Number | GET/POST | `0`=Auto `1`=HDMI `2`=Analog `3`=SPDIF |

Sélection entrée vidéo : `Device.AudioVideoInputOutput.Inputs[0].Ports[0].VideoPortTypeSelect`  
Valeurs : `"Hdmi"` | `"Vga"` | `"Bnc"` | `"Auto"`

Exemple POST — mute + volume :
```json
{
  "Device": {
    "AudioVideoInputOutput": {
      "Inputs": [{ "Ports": [{ "Audio": { "Mute": true, "Volume": -10 } }] }]
    }
  }
}
```

### `/Device/DeviceOperations` — POST

```json
{ "Device": { "DeviceOperations": { "Reboot": true } } }
```

Autres opérations disponibles : `Restore`, `Reset`, `RestartWebserver`, `EnterStandby`, `ExitStandby`

### Format de réponse POST (standard)

```json
{
  "Device": { "StreamTransmit": { /* propriétés modifiées */ } },
  "Actions": {
    "ResultId": 0,
    "ResultString": "Success"
  }
}
```

`ResultId` : 0 = succès, négatif = erreur, positif = info

---

## 3. Companion SDK v2.0.4

### Versions npm (mai 2026)

| Package | Version stable |
|---------|---------------|
| `@companion-module/base` | `2.0.4` |
| `@companion-module/tools` | `3.0.1` |

### Classe principale

```typescript
import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import type { SomeCompanionConfigField } from '@companion-module/base'

class MyModule extends InstanceBase<ModuleConfig> {
  async init(config: ModuleConfig, isFirstInit: boolean): Promise<void> { }
  async destroy(): Promise<void> { }
  async configUpdated(config: ModuleConfig): Promise<void> { }
  getConfigFields(): SomeCompanionConfigField[] { return [] }
  getUpgradeScripts() { return [] }  // OBLIGATOIRE
}

runEntrypoint(MyModule, [])
```

### InstanceStatus — valeurs complètes

```typescript
InstanceStatus.Ok                      // Vert
InstanceStatus.Connecting              // Orange
InstanceStatus.Disconnected            // Gris
InstanceStatus.ConnectionFailure       // Rouge
InstanceStatus.BadConfig               // Rouge
InstanceStatus.AuthenticationFailure   // Rouge
InstanceStatus.UnknownError            // Rouge
InstanceStatus.UnknownWarning          // Orange
```

### Actions

```typescript
self.setActionDefinitions({
  my_action: {
    name: 'My Action',
    options: [
      { id: 'url', type: 'textinput', label: 'URL', default: '' }
    ],
    callback: async (event) => {
      // event.options.url
    },
    subscribe: (actionId) => { },    // appelé quand l'action est placée
    unsubscribe: (actionId) => { },  // appelé quand l'action est retirée
  }
})
```

### Feedbacks

```typescript
self.setFeedbackDefinitions({
  my_feedback: {
    type: 'boolean',       // 'boolean' | 'value' | 'advanced'
    name: 'My Feedback',
    defaultStyle: { bgcolor: 0xff0000, color: 0xffffff },
    options: [],
    subscribe: () => { },      // OBLIGATOIRE (même vide)
    unsubscribe: () => { },    // OBLIGATOIRE (même vide)
    callback: async (feedback) => {
      return true  // ou false
    },
  }
})
```

### Variables

```typescript
// Définir les variables disponibles
self.setVariableDefinitions([
  { variableId: 'connection_status', name: 'Connection status' },
  { variableId: 'device_name', name: 'Device name' },
])

// Mettre à jour les valeurs
self.setVariableValues({
  connection_status: 'Connected',
  device_name: 'Encoder-1',
})

// Accès depuis Companion UI : $(crestron-nvx:connection_status)
```

### Polling — pattern recommandé

```typescript
private pollTimer: ReturnType<typeof setInterval> | null = null

startPolling(interval = 2000): void {
  this.stopPolling()
  this.pollTimer = setInterval(() => this.poll(), Math.max(500, interval))
}

stopPolling(): void {
  if (this.pollTimer !== null) {
    clearInterval(this.pollTimer)
    this.pollTimer = null
  }
}
```

### Feedback re-check

```typescript
this.checkAllFeedbacks()                           // tous
this.checkFeedbacks('feedback_id_1', 'id_2')       // sélectifs (recommandé)
```

### manifest.json format v4 (obligatoire)

```json
{
  "id": "crestron-nvx",
  "name": "Crestron DM NVX",
  "manufacturer": "Crestron",
  "products": ["DM-NVX-350"],
  "maintainers": [{ "name": "...", "email": "..." }],
  "repository": "https://github.com/...",
  "runtime": {
    "type": "node22",
    "api": "nodejs-ipc",
    "apiVersion": "0.0.0",
    "entrypoint": "../dist/main.js"
  }
}
```

### UpgradeScripts — obligatoire même si vide

```typescript
import type { CompanionStaticUpgradeScript } from '@companion-module/base'
export const upgradeScripts: CompanionStaticUpgradeScript<ModuleConfig>[] = []
// Dans la classe : getUpgradeScripts() { return upgradeScripts }
```

---

## 4. Points critiques pour l'implémentation

1. **Login succès = HTTP 302** (pas 200) — condition à tester sur `statusCode === 302`
2. **AuthByPasswd** : extraire le Set-Cookie après **chaque** réponse HTTP et mettre à jour le cookie jar
3. **403 = session expirée** : re-login automatique (1 retry), puis throw si 403 persiste
4. **Timeout HTTP** : 10 secondes obligatoire sur toutes les requêtes
5. **Certificats auto-signés** : `https.Agent({ rejectUnauthorized: false })` configurable
6. **Endpoints corrects v0.1** : uniquement `/Device/DeviceInfo` (polling heartbeat)
7. **Endpoints à valider** (gate hardware) : `StreamTransmit`, `StreamReceive`, `AudioVideoInputOutput`
8. **`subscribe`/`unsubscribe`** dans les feedbacks : obligatoires (même si vides) pour la soumission Bitfocus
9. **`getUpgradeScripts()`** : retourner `[]` — obligatoire dans la classe principale
10. **`checkFeedbacks(id)`** avec IDs spécifiques (jamais sans argument) — exigence Bitfocus

---

*Généré le 2026-05-18 — firmware de référence : DM NVX 7.3.5*
