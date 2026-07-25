#!/bin/bash

# ===========================================
# Arrête Companion (docker compose down)
# Le volume companion-data (config, boutons, layout) est CONSERVÉ.
# Usage (depuis la racine du projet) : ./scripts/ops/stop.sh
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

banner "Arrêt — Companion"
echo ""

if [ -n "$(docker compose ps -q --status running 2>/dev/null)" ]; then
    step "Arrêt du conteneur..."
    docker compose down
    echo ""
    ok "Companion arrêté (volume companion-data conservé)"
else
    ok "Companion est déjà arrêté"
fi
