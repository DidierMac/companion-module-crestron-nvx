#!/bin/bash

# ===========================================
# Suit les logs de Companion en direct.
# Filtre optionnel sur un tag : AUTH | HTTP | CONN | POLL | INIT
# Usage (depuis la racine du projet) : ./scripts/ops/logs.sh [TAG]
#   ./scripts/ops/logs.sh          → tous les logs
#   ./scripts/ops/logs.sh AUTH     → seulement les lignes [AUTH]
# (Pas de 'set -e' : tail interactif, on sort par Ctrl-C.)
# ===========================================

SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"
PROJECT_DIR="$PWD"

source "$SCRIPT_DIR/messages.sh"

# Ce script agit sur le projet du DOSSIER COURANT (pas son emplacement).
if [ ! -f "$PROJECT_DIR/docker-compose.yml" ]; then
    err "docker-compose.yml introuvable dans le dossier courant :"
    err "  $PROJECT_DIR"
    exit 1
fi

FILTER="${1:-}"

if [ -n "$FILTER" ]; then
    info "Logs filtrés sur [$FILTER] — Ctrl-C pour quitter"
    echo ""
    # --line-buffered : flush immédiat en mode suivi (supporté BSD + GNU grep)
    docker compose logs -f companion | grep --line-buffered "\[$FILTER\]"
else
    info "Logs Companion — Ctrl-C pour quitter"
    dim "Astuce : filtre possible → $0 AUTH|HTTP|CONN|POLL|INIT"
    echo ""
    docker compose logs -f companion
fi
