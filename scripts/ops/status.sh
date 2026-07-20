#!/bin/bash

# ===========================================
# État de Companion : conteneur, santé HTTP, ressources, image
# (Pas de 'set -e' : script de reporting — on veut toutes les sections
#  même si l'une échoue. Adapté macOS : pas de 'free -h'.)
# Usage (depuis la racine du projet) : ./scripts/ops/status.sh
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

banner "État — Companion"
echo ""

step "Conteneur"
if [ -n "$(docker compose ps -q 2>/dev/null)" ]; then
    docker compose ps
else
    warn "Aucun conteneur (Companion arrêté)"
fi
echo ""

step "Santé HTTP"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8000/" 2>/dev/null || echo "000")
if [[ "$CODE" =~ ^(200|301|302|401)$ ]]; then
    ok "UI accessible : http://localhost:8000 (HTTP $CODE)"
else
    warn "UI injoignable (HTTP $CODE)"
fi
echo ""

step "Ressources"
CID=$(docker compose ps -q companion 2>/dev/null | head -1)
if [ -n "$CID" ]; then
    docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' "$CID"
else
    dim "(conteneur arrêté — pas de statistiques)"
fi
echo ""

step "Image"
IMAGE=$(docker compose config 2>/dev/null | awk '/^[[:space:]]*image:/{print $2; exit}')
if [ -n "$IMAGE" ]; then
    docker images "$IMAGE" --format 'table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}\t{{.Size}}' 2>/dev/null \
        || dim "(image absente en local)"
else
    dim "(image indéterminée)"
fi
