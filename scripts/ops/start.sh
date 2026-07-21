#!/bin/bash

# ===========================================
# Démarre Companion (docker compose up)
# Usage (depuis la racine du projet) : ./scripts/ops/start.sh
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

banner "Démarrage — Companion"
echo ""

# Garde-fou : build séparé → dist/ doit exister (le conteneur le monte en ro).
if [ ! -d "$PROJECT_DIR/dist" ] || [ -z "$(ls -A "$PROJECT_DIR/dist" 2>/dev/null)" ]; then
    err "dist/ absent ou vide — compile d'abord :  npm run build"
    exit 1
fi

# Déjà en cours ?
if [ -n "$(docker compose ps -q --status running 2>/dev/null)" ]; then
    ok "Companion est déjà en cours d'exécution"
    echo ""
    docker compose ps
    exit 0
fi

step "[1/2] Démarrage du conteneur..."
docker compose up -d
echo ""

step "[2/2] Attente de la disponibilité (http://localhost:8000)..."
for _ in $(seq 1 30); do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8000/" 2>/dev/null || echo "000")
    if [[ "$CODE" =~ ^(200|301|302|401)$ ]]; then
        echo ""
        ok_bold "Companion est prêt : http://localhost:8000"
        exit 0
    fi
    printf '.'
    sleep 2
done
echo ""
warn "Companion démarre encore — surveille avec : ./scripts/ops/logs.sh"
