# Changelog

## [v0.1.0] - 2026-06-10

### Added
- Authentification NVX en 2 étapes — mot de passe lu depuis le canal `secrets` du SDK v2
- Heartbeat `DeviceInfo` + variables `device_name`, `firmware_version`, `ip_address`, `connection_status`
- Logging structuré avec toggle verbose et préfixes par composant (`[INIT]`/`[AUTH]`/`[CONN]`/`[HTTP]`/`[POLL]`)

### Fixed
- Échec d'authentification (HTTP 401/403) traité comme terminal — statut `AuthenticationFailure`, plus de reconnexion en boucle (protège du verrouillage de compte NVX)
- `init()` rendu non bloquant — évite le force-restart de Companion quand l'appareil est injoignable
- Annulation des timers de reconnexion — plus de connexion fantôme après `destroy()`
- Login réussi reconnu sur HTTP 200 (le firmware NVX ne renvoie pas le 302 attendu)
- Garde-fou « mot de passe vide » → statut `BadConfig` avant tout appel réseau
