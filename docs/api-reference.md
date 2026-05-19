# NVX REST API Reference

> Firmware reference: 7.3.5. Exact JSON property names may vary across firmware versions — always validate against a real device.

## Base URL

```
https://<device-ip>:<port>
```

Default port: `443`. All requests require HTTPS (self-signed certificate by default).

## Authentication

### Step 1 — Obtain session cookie

```
GET /userlogin.html
```

Response sets `TRACKID` cookie via `Set-Cookie` header. No body required.

### Step 2 — Submit credentials

```
POST /userlogin.html
Content-Type: application/x-www-form-urlencoded

login=<username>&passwd=<password>
```

Success: HTTP `302`. The `AuthByPasswd` cookie is set and rolls with each subsequent response.

Failure: HTTP `200` (form re-displayed) or other non-302 status.

## Request / Response Format

All REST endpoints use JSON with the `CresNext` envelope:

```json
// Request
{ "Device": { "<Subsystem>": { "<Property>": <value> } } }

// Response
{ "Device": { "<Subsystem>": { "<Property>": <current-value> } } }
```

## Endpoints

### Device Info

```
GET /Device/DeviceInfo
```

Response:
```json
{
  "Device": {
    "DeviceInfo": {
      "Name": "NVX-ENCODER-01",
      "DeviceVersion": "7.3.5.123",
      "Model": "DM-NVX-350"
    }
  }
}
```

### AV Signal

```
GET /Device/AvSignal
POST /Device/AvSignal
```

Properties (to be validated on hardware):
- `StreamMode` — `"Encoder"` or `"Decoder"`
- `StreamUrl` — RTSP/multicast URL
- `StreamName` — encoder stream name
- `MulticastAddress` — multicast IP
- `HdmiInputSignal` — boolean
- `HdmiOutputSignal` — boolean

### Audio Control

```
GET /Device/AudioControl
POST /Device/AudioControl
```

Properties (to be validated on hardware):
- `AudioMuted` — boolean
- `AudioVolume` — integer 0–100

### Video Switch

```
GET /Device/VideoSwitch
POST /Device/VideoSwitch
```

Properties (to be validated on hardware):
- `ActiveVideoSource` — input selector

### Device Operations

```
POST /Device/DeviceOperations
```

Body for reboot:
```json
{ "Device": { "DeviceOperations": { "Reboot": true } } }
```

## HTTP Error Codes

| Code | Meaning | Module behaviour |
|---|---|---|
| `302` | Login success | Cookies extracted |
| `200` | Login failure (form re-displayed) | `Error: login failed` thrown |
| `403` | Session expired | Re-login triggered, request retried once |
| `timeout` | No response in 10s | Error thrown, reconnect scheduled |
