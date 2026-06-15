# Matrice fonctionnelle — Module Companion Crestron DM NVX

Carte de référence des **Actions / Feedbacks / Variables** par fonctionnalité NVX, qui guide
les versions v0.2 → v0.5. Validée avec Didier (2026-06-14).

**Légende** : ✅ implémenté et vérifié (code/tests) · 🔜 planifié (valeurs JSON à confirmer au labo).

## La règle : Action vs Feedback vs Variable

- **Action** = commande **poussée au device** au press d'un bouton (POST). Contrôle runtime.
- **Variable** = **valeur** d'état du device, que l'utilisateur **affiche** (texte d'un bouton) ou
  **réutilise** (option d'action, expression). On la *lit*.
- **Feedback** = **règle visuelle** : « si `<condition d'état>` alors `<style du bouton>` ». Le bouton
  **réagit** (couleur/icône).
- **Couple variable+feedback** : fréquent et voulu (ex. `audio_muted` : variable pour l'affichage,
  feedback pour colorer). Deux usages d'un même état, pas une redondance.
- **La config de connexion** (host/port/auth/poll) n'est **pas** dans cette matrice : elle établit
  la connexion, elle n'agit pas sur le device.

---

## Connexion / Device (toujours actif) ✅

| Actions | Feedbacks | Variables |
|---|---|---|
| *(aucune — voir Device-Ops)* | `device_connected` | `device_name`, `firmware_version`, `ip_address`, `connection_status`, `device_role` |

## Encodeur — `StreamTransmit` ✅ (v0.2)

| Actions | Feedbacks | Variables |
|---|---|---|
| `set_stream_name(name)` → `RtspSessionName` | `stream_enabled` (live → vert) | `stream_name` |
| `set_multicast_address(address)` → `MulticastAddress` | `stream_name_matches(name)` | `multicast_address` |
| `enable_stream` → `Start` | | `encoder_url` |
| `disable_stream` → `Stop` | | `stream_enabled` |

**Presets livrés** ✅ : section « Encoder » — `Start stream` (porte le feedback `stream_enabled`),
`Stop stream`, `Set stream name`, `Set multicast address`.

## Décodeur — `StreamReceive` 🔜 (v0.3)

| Actions | Feedbacks | Variables |
|---|---|---|
| `set_source_url(url)` → **routing** (le décodeur tire le flux source) | `rx_receiving` | `rx_source_url`, `rx_stream_name` |
| `enable_stream` → démarre la réception | `rx_source_matches(url)` | `rx_status`, `rx_resolution` |
| `disable_stream` → arrête la réception | | |

> Cœur du v0.3 : pas d'API centrale de switching NVX — le routing se fait côté décodeur en lui
> donnant l'URL/multicast de l'encodeur source. C'est une **action**, pas une config.

## Audio / Vidéo — `AudioVideoInputOutput` / `NaxAudio` 🔜 (v0.4)

| Actions | Feedbacks | Variables |
|---|---|---|
| `audio_mute` / `audio_unmute` / `audio_mute_toggle` → `IsMuted` | `audio_muted` (icône mute) | `audio_volume`, `audio_muted` |
| `set_volume(target, fadeMs?=0)` → `Audio.Volume` | `volume_above(seuil)` | `video_source`, `video_source_name` |
| `adjust_volume(delta, fadeMs?=0)` → `Audio.Volume` | `hdmi_input_present` | `hdmi_input_signal`, `hdmi_output_signal` |
| `select_hdmi_input(input)` → entrée vidéo active | `hdmi_output_present` | |

### Fade volume (`fadeMs`) — design

Le NVX n'a **pas de fade natif** (capture réelle : `Audio.Volume` = entier posé instantanément,
`NaxAudio.AudioLevelAdjust`, `IsMuted` — aucun champ `fade`/`ramp`/`duration`). Le fade est donc
**fait par le module** = N POST de volume échelonnés.

- `fadeMs` = **durée totale** de la rampe (0 = instantané, comportement par défaut).
- Nombre de pas = `max(1, fadeMs / MIN_STEP_MS)` — **jamais 1 ms/pas** : chaque pas = un POST HTTPS
  (dizaines de ms). `MIN_STEP_MS` (~50-100 ms) borné par le débit POST que le device tolère.
- Valeurs **réparties en log/dB** (l'oreille est logarithmique → rampe perçue régulière), clampées 0-100.
- Un nouveau réglage de volume **annule la rampe en cours** (pas de fades concurrents).
- Stop propre sur déconnexion.
- Exemple réaliste : `adjust_volume(-10, 2000)` = −10 sur 2 s, ~20-40 pas log. ❌ *Pas* `(-10, 20)` à 1 ms/pas (≈1000 req/s, infaisable + imperceptible).

## Device-Ops 🔜 (v0.5)

| Actions | Feedbacks | Variables |
|---|---|---|
| `reboot_device` | `is_encoder` (mode==Transmitter) | `device_mode` |
| `set_mode(Encoder/Decoder)` → bascule de rôle (reboot device) | `is_decoder` (mode==Receiver) | |

> `set_mode` est la seule action « dangereuse » (reboot) → isolée en v0.5, avec confirmation.
> Reportée de v0.2 (où `PortConfig` ne gouverne que la *possibilité* de bascule).

---

## À valider au labo (avant codage v0.4)

1. **Fade natif** : confirmer dans la doc API NVX 7.3.5 qu'aucun paramètre de fade/transition n'existe
   sur `AudioControl`/`Volume` (la capture 7.1.5259 n'en montre pas, mais n'est pas forcément exhaustive).
2. **Débit POST max** : mesurer combien de POST/s le device tolère avant saturation → fixe `MIN_STEP_MS`.
3. **Chemins JSON** des sous-systèmes 🔜 (StreamReceive, AudioVideoInputOutput, NaxAudio) à ancrer
   depuis les captures `docs/hardware-validation/raw/` au moment du design de chaque version.
