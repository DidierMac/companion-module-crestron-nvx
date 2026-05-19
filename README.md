# companion-module-crestron-nvx

[![Companion v4](https://img.shields.io/badge/Companion-v4.x-blue)](https://bitfocus.io/companion)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js ≥22](https://img.shields.io/badge/Node.js-%E2%89%A522-green)](https://nodejs.org)

Bitfocus Companion module for **Crestron DM NVX** AV-over-IP encoders and decoders.

Control stream routing, audio, and device operations from a Stream Deck or any Companion-supported surface.

---

## Features

- **Actions** — set stream URL, switch encoder/decoder mode, select HDMI input, mute/unmute audio, adjust volume, reboot device
- **Feedbacks** — connection state, stream mode, audio mute state, HDMI signal presence
- **Variables** — live device info, stream URL, audio state, connection status
- **Verbose logging** — toggle-able debug logs written to Companion's log files for troubleshooting

## Requirements

- [Bitfocus Companion](https://bitfocus.io/companion) v4.x
- Node.js ≥ 22 (bundled with Companion)
- Crestron DM NVX device with firmware 7.x (HTTP access enabled)

## Installation

### Option A — Load as unpacked module (development)

1. Clone or download this repository
2. Run `npm install && npm run build`
3. Open Companion → **Settings** → **Developer** → **Load unpacked module**
4. Select this folder

### Option B — Docker (development stack)

```bash
git clone https://github.com/DidierMac/companion-module-crestron-nvx
cd companion-module-crestron-nvx
docker compose up -d --wait
```

Open `http://localhost:8000` to access the Companion UI.

## Configuration

After adding the module in Companion, configure the connection:

| Field | Description | Default |
|---|---|---|
| Device IP / Hostname | IP address or hostname of the NVX device | — |
| HTTPS Port | Device HTTPS port | `443` |
| Username | Device login username | `admin` |
| Password | Device login password | — |
| Poll Interval (ms) | How often to query device state | `2000` |
| Ignore Self-Signed Cert | Skip TLS certificate validation | `true` |
| Enable verbose logging | Log all HTTP and auth steps for troubleshooting | `false` |

## Actions

| Action | Description |
|---|---|
| Set Stream URL | Set the RTSP/multicast source URL on a decoder |
| Set Stream Mode | Switch between Encoder and Decoder mode |
| Set Stream Name | Set the encoder stream name |
| Set Multicast Address | Set the encoder multicast address |
| Select HDMI Input | Choose the active HDMI input |
| Mute Audio | Mute the device audio |
| Unmute Audio | Unmute the device audio |
| Toggle Mute | Toggle audio mute state |
| Set Volume | Set absolute volume (0–100) |
| Adjust Volume | Increase or decrease volume by a relative amount |
| Reboot Device | Reboot the NVX device |

## Feedbacks

| Feedback | Condition |
|---|---|
| Connected | Device is reachable and authenticated |
| Stream Mode | Current mode matches Encoder or Decoder |
| Audio Muted | Audio is muted |
| HDMI Input Signal | HDMI input signal is present |
| HDMI Output Signal | HDMI output signal is present |

## Variables

| Variable | Description |
|---|---|
| `$(crestron-nvx:connection_status)` | `Connected`, `Connecting...`, or error message |
| `$(crestron-nvx:device_name)` | Device name reported by the NVX |
| `$(crestron-nvx:firmware_version)` | Firmware version string |
| `$(crestron-nvx:ip_address)` | Configured device IP |
| `$(crestron-nvx:stream_mode)` | `Encoder` or `Decoder` |
| `$(crestron-nvx:stream_url)` | Active stream URL |
| `$(crestron-nvx:stream_name)` | Encoder stream name |
| `$(crestron-nvx:multicast_address)` | Encoder multicast address |
| `$(crestron-nvx:audio_muted)` | `true` or `false` |
| `$(crestron-nvx:audio_volume)` | Volume level (0–100) |
| `$(crestron-nvx:hdmi_input_signal)` | `true` if HDMI input signal present |
| `$(crestron-nvx:hdmi_output_signal)` | `true` if HDMI output signal present |

## Troubleshooting

### Enable verbose logging

In Companion, edit the NVX connection and check **Enable verbose logging**. This takes effect immediately without restarting.

With verbose enabled, all HTTP requests and authentication steps are written to the Companion log at `info` level.

### Log file locations

| Context | Path |
|---|---|
| Windows | `%APPDATA%\Roaming\Bitfocus\Companion\logs\` |
| Linux | `~/.config/companion-nodejs/v<version>/logs/` |
| macOS | `~/Library/Application Support/Companion/logs/` |
| Docker | `/companion/logs/` (inside the volume) |

### Export support bundle

Companion web UI → **Settings** → **Log** → **Export support bundle**

This produces a ZIP with all archived logs and config — shareable without filesystem access.

### Docker log commands

```bash
docker compose logs -f companion                        # follow
docker compose logs companion | grep "\[AUTH\]"         # auth steps only
docker compose logs companion | grep "\[HTTP\]"         # all HTTP traffic
```

See [docs/debugging.md](docs/debugging.md) for full grep patterns and troubleshooting tips.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) — © Didier Casalta