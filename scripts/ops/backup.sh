#!/bin/bash

# ===========================================
# Sauvegarde le volume Docker companion-data (config Companion :
# instances, boutons, layout) dans une archive datée sous backups/.
# Usage (depuis la racine du projet) : ./scripts/ops/backup.sh
#
# Note : sur macOS le volume nommé vit dans la VM Docker (inaccessible
# depuis l'hôte), on passe donc par un conteneur alpine éphémère pour
# archiver son contenu. 'alpine' est une image runtime, pas une
# dépendance du projet.
# ===========================================

set -e

SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"
PROJECT_DIR="$PWD"

source "$SCRIPT_DIR/messages.sh"

# Ce script agit sur le projet du DOSSIER COURANT (pas son emplacement).
if [ ! -f "$PROJECT_DIR/docker-compose.yml" ]; then
    err "docker-compose.yml introuvable dans le dossier courant :"
    err "  $PROJECT_DIR"
    exit 1
fi

banner "Sauvegarde — companion-data"
echo ""

# Nom du projet compose (défini par 'name:' dans docker-compose.yml) → volume préfixé.
PROJECT=$(docker compose config 2>/dev/null | awk '/^name:/{print $2; exit}')
PROJECT="${PROJECT:-companion-nvx}"
VOLUME="${PROJECT}_companion-data"

if [ -z "$(docker volume ls -q --filter "name=^${VOLUME}$" 2>/dev/null)" ]; then
    err "Volume $VOLUME introuvable — Companion a-t-il déjà démarré au moins une fois ?"
    exit 1
fi

BACKUP_DIR="$PROJECT_DIR/backups"
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)
ARCHIVE="companion-data-$TS.tar.gz"

step "Archivage du volume $VOLUME..."
docker run --rm \
    -v "${VOLUME}:/data:ro" \
    -v "${BACKUP_DIR}:/backup" \
    alpine tar czf "/backup/$ARCHIVE" -C /data .
echo ""

SIZE=$(du -h "$BACKUP_DIR/$ARCHIVE" | awk '{print $1}')
ok_bold "Sauvegarde créée : backups/$ARCHIVE ($SIZE)"
