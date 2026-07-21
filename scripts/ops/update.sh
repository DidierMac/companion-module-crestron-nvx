#!/bin/bash

# ===========================================
# Met à jour l'image Companion (mono-stack local)
# Ne remonte l'app QUE si une nouvelle image est publiée,
# puis supprime précisément l'ancienne image (par son ID).
# Usage (depuis la racine du projet) : ./scripts/ops/update.sh
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

banner "Mise à jour — Companion"
echo ""

# Garde-fou : build séparé → le module compilé (dist/) doit exister,
# car le conteneur remonté le relit au démarrage.
if [ ! -d "$PROJECT_DIR/dist" ] || [ -z "$(ls -A "$PROJECT_DIR/dist" 2>/dev/null)" ]; then
    err "dist/ absent ou vide — compile d'abord :  npm run build"
    exit 1
fi

# Image cible dérivée du docker-compose.yml ([[:space:]] = portable macOS/Linux)
IMAGE=$(docker compose config 2>/dev/null | awk '/^[[:space:]]*image:/{print $2; exit}')
if [ -z "$IMAGE" ]; then
    err "Impossible de déterminer l'image depuis docker-compose.yml"
    exit 1
fi
dim "Image suivie : $IMAGE"
echo ""

# [1/4] Pull + comparaison d'ID (fiable quel que soit le texte de sortie de Docker)
step "[1/4] Téléchargement de l'image..."
BEFORE=$(docker images -q "$IMAGE" 2>/dev/null)
docker compose pull
AFTER=$(docker images -q "$IMAGE" 2>/dev/null)
echo ""

if [ "$BEFORE" = "$AFTER" ]; then
    ok_bold "Image déjà à jour — l'app n'est pas touchée"
    exit 0
fi

BEFORE_SHORT="${BEFORE:0:12}"
info "Nouvelle image détectée (${BEFORE_SHORT:-néant} → ${AFTER:0:12})"
echo ""

# [2/4] + [3/4] Remontage — uniquement parce que l'image a changé
step "[2/4] Arrêt de l'ancienne version..."
"$SCRIPT_DIR/stop.sh"
echo ""
step "[3/4] Démarrage de la nouvelle version..."
"$SCRIPT_DIR/start.sh"
echo ""

# [4/4] Suppression CIBLÉE de l'ancienne image, par son ID capturé avant le pull.
#       (jamais 'docker image prune -f' : ça toucherait les images sans tag
#        des AUTRES projets présents sur cette machine.)
step "[4/4] Suppression de l'ancienne image..."
if [ -n "$BEFORE" ] && [ "$BEFORE" != "$AFTER" ]; then
    if docker rmi "$BEFORE" >/dev/null 2>&1; then
        ok "Ancienne image supprimée (${BEFORE:0:12})"
    else
        warn "Ancienne image ${BEFORE:0:12} encore référencée — conservée"
    fi
else
    dim "Aucune ancienne image à supprimer"
fi
