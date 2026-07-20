# scripts/ops — Exploitation Docker de Companion

Scripts d'exploitation du conteneur Companion (dev local, macOS/Linux).
Style et bibliothèque d'affichage repris du package `scripts/` du dépôt `vps`.

Prérequis : `docker compose` (v2), et **`npm run build`** exécuté au préalable
(les scripts ne compilent pas — ils supposent `dist/` présent).

**Lancer les scripts depuis la racine du projet** (là où se trouve `docker-compose.yml`) :
ils agissent sur le **dossier courant**, pas sur leur propre emplacement. Si tu n'es pas
au bon endroit, ils s'arrêtent avec un message clair.

| Commande | Effet |
|---|---|
| `./scripts/ops/start.sh` | Monte le conteneur (`docker compose up -d`) et attend `http://localhost:8000`. |
| `./scripts/ops/stop.sh` | Arrête le conteneur (`docker compose down`). Le volume `companion-data` est conservé. |
| `./scripts/ops/restart.sh` | Redémarre le conteneur → relit `dist/`. À lancer après un `npm run build`. |
| `./scripts/ops/update.sh` | `pull` de l'image ; remonte l'app **uniquement si l'image a changé**, puis supprime **l'ancienne image** (ciblée par ID). |
| `./scripts/ops/status.sh` | Conteneur, santé HTTP, ressources, image locale. |
| `./scripts/ops/logs.sh [TAG]` | Suit les logs. `TAG` optionnel : `AUTH`, `HTTP`, `CONN`, `POLL`, `INIT`. |
| `./scripts/ops/backup.sh` | Archive le volume `companion-data` dans `backups/` (daté, gitignoré). |

## Notes de conception

- **`update.sh` ne redémarre que si nécessaire** : il compare l'ID de l'image
  avant/après `docker compose pull`. Identique → l'app n'est pas touchée.
- **Suppression ciblée** : l'ancienne image est retirée par son ID
  (`docker rmi`), jamais via `docker image prune -f` (qui toucherait les images
  sans tag des autres projets de la machine).
- **Garde-fou `dist/`** : `start` / `restart` / `update` refusent de tourner si
  `dist/` est absent, plutôt que de charger un module vide.
- **Dossier courant** : chaque script pilote le projet du répertoire d'où tu le lances
  (`PROJECT_DIR="$PWD"`), et exige un `docker-compose.yml` dans ce dossier. `SCRIPT_DIR`
  (via `BASH_SOURCE`) ne sert qu'à localiser `messages.sh`, pas à trouver le projet.
- `messages.sh` n'est pas exécutable : c'est une bibliothèque `source`-ée par les autres.
