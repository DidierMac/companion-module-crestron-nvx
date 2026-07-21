#!/bin/bash

# ===========================================
# Redémarre le conteneur Companion → relit dist/ (le module compilé).
# À lancer après 'npm run build' pour charger tes derniers changements.
# Usage (depuis la racine du projet) : ./scripts/ops/restart.sh
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

banner "Redémarrage — Companion"
echo ""

# Garde-fou : build séparé → dist/ doit exister.
if [ ! -d "$PROJECT_DIR/dist" ] || [ -z "$(ls -A "$PROJECT_DIR/dist" 2>/dev/null)" ]; then
    err "dist/ absent ou vide — compile d'abord :  npm run build"
    exit 1
fi

# Un 'restart' n'a de sens que si le conteneur tourne. Sinon → démarrage.
if [ -z "$(docker compose ps -q --status running 2>/dev/null)" ]; then
    warn "Companion n'est pas en cours — démarrage à la place"
    echo ""
    exec "$SCRIPT_DIR/start.sh"
fi

step "Redémarrage du conteneur (relecture de dist/)..."
docker compose restart companion
echo ""
ok_bold "Conteneur redémarré — module rechargé depuis dist/"
dim "Rappel : le redémarrage du conteneur relit le code ; recharger seulement"
dim "la connexion dans l'UI Companion ne recharge PAS le code du module."
