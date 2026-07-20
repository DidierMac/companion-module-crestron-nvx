#!/bin/bash

# ===========================================
# Fonctions d'affichage avec palette truecolor
# Lisible sur fond blanc ET fond noir
# Usage : source "$(dirname "${BASH_SOURCE[0]}")/messages.sh"
# (Repris à l'identique du package scripts/ du dépôt vps, pour cohérence)
# ===========================================

# Couleurs (truecolor RGB, syntaxe ANSI-C pour portabilité)
_CLR_RED=$'\033[1;38;2;180;30;60m'
_CLR_ORANGE=$'\033[38;2;204;120;50m'
_CLR_GREEN=$'\033[38;2;0;150;90m'
_CLR_GREEN_BOLD=$'\033[1;38;2;0;150;90m'
_CLR_BLUE=$'\033[38;2;45;110;190m'
_CLR_STEP=$'\033[1;38;2;120;80;200m'
_CLR_DIM=$'\033[38;2;120;120;120m'
_CLR_BG_BANNER=$'\033[48;2;40;60;90m'
_CLR_FG_BANNER=$'\033[38;2;245;245;245m'
_CLR_NC=$'\033[0m'

# Largeur des bannières
_BANNER_WIDTH=41

# --- Fonctions d'affichage ---

# Surplus d'octets UTF-8 (printf compte en octets, pas en caractères)
_utf8_extra() {
    local byte_len
    byte_len=$(printf '%s' "$1" | LC_ALL=C wc -c | tr -d ' ')
    printf '%d' $((byte_len - ${#1}))
}

# Bannière (titre de script)
# Usage : banner "Mon titre"
banner() {
    local padded extra
    extra=$(_utf8_extra "$1")
    padded=$(printf "   %-*s" $((_BANNER_WIDTH - 3 + extra)) "$1")
    printf '%s\n' "${_CLR_BG_BANNER}${_CLR_FG_BANNER}$(printf '%*s' "$_BANNER_WIDTH" '')${_CLR_NC}"
    printf '%s\n' "${_CLR_BG_BANNER}${_CLR_FG_BANNER}${padded}${_CLR_NC}"
    printf '%s\n' "${_CLR_BG_BANNER}${_CLR_FG_BANNER}$(printf '%*s' "$_BANNER_WIDTH" '')${_CLR_NC}"
}

# Bannière de résumé (plusieurs lignes)
# Usage : banner_summary "ligne1" "ligne2" ...
banner_summary() {
    local padded extra max_len=0 len eff_width
    for line in "$@"; do
        len=${#line}
        [ "$len" -gt "$max_len" ] && max_len=$len
    done
    eff_width=$(( max_len + 6 > _BANNER_WIDTH ? max_len + 6 : _BANNER_WIDTH ))
    printf '%s\n' "${_CLR_BG_BANNER}${_CLR_FG_BANNER}$(printf '%*s' "$eff_width" '')${_CLR_NC}"
    for line in "$@"; do
        extra=$(_utf8_extra "$line")
        padded=$(printf "   %-*s" $((eff_width - 3 + extra)) "$line")
        printf '%s\n' "${_CLR_BG_BANNER}${_CLR_FG_BANNER}${padded}${_CLR_NC}"
    done
    printf '%s\n' "${_CLR_BG_BANNER}${_CLR_FG_BANNER}$(printf '%*s' "$eff_width" '')${_CLR_NC}"
}

# Étape (progression)
# Usage : step "Texte de l'étape"
step() {
    printf '%s\n' "${_CLR_STEP}$1${_CLR_NC}"
}

# Succès
# Usage : ok "Message de succès"
ok() {
    printf '%s\n' "${_CLR_GREEN}  ✓ $1${_CLR_NC}"
}

# Succès important (bold)
# Usage : ok_bold "Message important"
ok_bold() {
    printf '%s\n' "${_CLR_GREEN_BOLD}✓ $1${_CLR_NC}"
}

# Avertissement (orange)
# Usage : warn "Quelque chose à vérifier"
warn() {
    printf '%s\n' "${_CLR_ORANGE}  ⚠ $1${_CLR_NC}"
}

# Information (bleu)
# Usage : info "Détail informatif"
info() {
    printf '%s\n' "${_CLR_BLUE}  ℹ $1${_CLR_NC}"
}

# Erreur (rouge)
# Usage : err "Message d'erreur"
err() {
    printf '%s\n' "${_CLR_RED}Erreur: $1${_CLR_NC}"
}

# Texte secondaire (gris)
# Usage : dim "Détail peu important"
dim() {
    printf '%s\n' "${_CLR_DIM}$1${_CLR_NC}"
}

# Séparateur (ligne grise)
# Usage : separator
separator() {
    printf '%s\n' "${_CLR_DIM}─────────────────────────────────────────${_CLR_NC}"
}
