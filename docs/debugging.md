# Debugging Guide

## Enabling Verbose Logging

Open the Companion web UI, go to **Connections**, click the Crestron DM NVX connection, and check **Enable verbose logging**. Save. No restart required — the change takes effect immediately.

With verbose logging enabled, all HTTP requests, authentication steps, and polling results are written to the Companion log at `info` level.

## Log File Locations

Companion writes all `info`, `warn`, and `error` messages to disk automatically.

| Context | Log directory |
|---|---|
| **Windows** | `%APPDATA%\Roaming\Bitfocus\Companion\logs\` |
| **Linux** | `~/.config/companion-nodejs/v<version>/logs/` |
| **macOS** | `~/Library/Application Support/Companion/logs/` |
| **Docker** | `/companion/logs/` (inside the bound volume) |
| **Custom** | `$COMPANION_CONFIG_BASEDIR/logs/` if the env var is set |

On Windows and macOS, click the Companion icon in the system tray → **Show config folder** to open the directory directly.

## Exporting Logs (Support Bundle)

From any context — including headless servers — you can export a ZIP containing all archived logs, the current config, and device metadata:

1. Open the Companion web UI (default: `http://localhost:8000`)
2. Go to **Settings** → **Log**
3. Click **Export support bundle**

Share this ZIP for remote troubleshooting without needing filesystem access.

## Docker — Real-time Log Access

```bash
# Follow logs as they appear
docker compose logs -f companion

# Last 100 lines
docker compose logs --tail=100 companion

# Filter by component prefix
docker compose logs companion | grep "\[AUTH\]"
docker compose logs companion | grep "\[HTTP\]"
docker compose logs companion | grep "\[POLL\]"

# Copy log files from the container
docker exec companion-nvx-companion-1 ls /companion/logs/
docker cp companion-nvx-companion-1:/companion/logs ./logs-backup
```

## Log Prefixes

| Prefix | Component | What it traces |
|---|---|---|
| `[INIT]` | Initialisation | Config values at startup |
| `[CONN]` | Connection lifecycle | connect(), reconnect, destroy |
| `[AUTH]` | NVX authentication | Login steps, TRACKID, cookies |
| `[POLL]` | Polling cycle | Start/stop, DeviceInfo results |
| `[HTTP]` | Raw HTTP | Every request/response, 403 re-login, timeouts |

## Useful grep Patterns

```bash
# All authentication steps
grep "\[AUTH\]" companion.log

# HTTP errors only
grep "\[HTTP\].*error\|warn" companion.log

# Reconnect events
grep "reconnect\|Reconnect" companion.log

# Full trace for one connection attempt
grep "\[INIT\]\|\[CONN\]\|\[AUTH\]\|\[HTTP\]" companion.log | head -30
```
