# Miroir local — doc API REST Crestron DM NVX

Copie ciblée (pages clés) du webhelp officiel Crestron, capturée pour ancrer la spec
hors-ligne et éviter de dépendre d'un site externe. **Source de vérité = le site officiel** ;
ce miroir est un instantané daté, potentiellement obsolète.

- **Capturé le** : 2026-06-17
- **Firmware documenté par le webhelp** : 7.3.5
- **Firmware de l'appareil labo** : 7.1.5259 (cf. release notes ci-dessous) — écart à garder en tête.
- **Source webhelp** : https://sdkcon78221.crestron.com/sdk/DM_NVX_REST_API/Content/Topics/
- **Format** : HTML brut du webhelp (chrome de navigation/JS inclus ; mieux lu dans un navigateur).
  Les fichiers ne sont PAS convertis — la synthèse curée reste `docs/api-research.md`.

## Contenu

| Fichier | Page source |
|---|---|
| `Topics/Home.htm` | Home |
| `Topics/API-Reference.htm` | API Reference |
| `Topics/Authentication.htm` | Authentication |
| `Topics/Making-API-Calls.htm` | Making API Calls |
| `Topics/Objects/StreamReceive.htm` | Objet StreamReceive (décodeur) |
| `Topics/Objects/StreamTransmit.htm` | Objet StreamTransmit (encodeur) |
| `Topics/Objects/AudioVideoInputOutput.htm` | Objet AudioVideoInputOutput (audio/vidéo I/O) |
| `Topics/Objects/DeviceOperations.htm` | Objet DeviceOperations (reboot…) |
| `Topics/Objects/DeviceInfo.htm` | Objet DeviceInfo |
| `release-notes/dm-nvx-35xx_7.1.5259.00068_release_notes.pdf` | Release notes firmware 7.1.5259 (DM-NVX-35xx) |

## Faits clés ancrés pour v0.4 (audio)

- **Volume** : `Device.AudioVideoInputOutput.Outputs[0].Ports[0].Audio.Volume` — entier **-100 à 100**,
  documenté *« sets the gain of the audio output »* (donc un **gain**, défaut 0 = unité ; pas un % 0-100).
  Présent **uniquement sous Outputs** (pas Inputs).
- **Mute** : `Device.AudioVideoInputOutput.Outputs[0].Ports[0].Audio.Mute` — booléen, présent dans
  l'exemple JSON officiel (pas dans la table formelle). 🔜 à confirmer sur firmware 7.1.5259.
- **StreamReceive** : **aucune** propriété `Volume` ni `Mute` documentée (seulement `AudioChannels` /
  `AudioFormat` / `AudioMode`, lecture seule). → le `Volume` vu dans le RAW sur `StreamReceive.Streams[]`
  est **non documenté** ; ne pas bâtir dessus.
