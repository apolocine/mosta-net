#!/usr/bin/env sh
# Build du schéma "MOSTA ECOSYSTEM" : rangée des 18 langages déterministe (SVG)
# compositée sur l'image générée par IA (dont le haut est correct).
#
# Usage : ./build-diagram.sh <base-ia.png> [sortie.png] [mask] [paste-y]
#   ex.  : ./build-diagram.sh "ChatGPT Image ...-v67.png"
#
# Réglages par défaut calibrés pour une base 1536x1024 (cf. compose-language-row.py).
# Si la base change de taille/disposition, ajuster --mask et --paste-y.
# @author Dr Hamid MADANI <drmdh@msn.com>
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"     # .../assets
SCR="$DIR/scripts"
BASE="${1:?usage: build-diagram.sh <base-ia.png> [out.png] [mask] [paste-y]}"
OUT="${2:-$DIR/mosta-ecosystem-composite.png}"
MASK="${3:-0,596,1536,786}"
PASTEY="${4:-604}"

sh "$SCR/render-language-row.sh"
python3 "$SCR/compose-language-row.py" \
  --base "$BASE" --strip "$DIR/language-row-18.png" --out "$OUT" \
  --mask "$MASK" --paste-y "$PASTEY"
echo "OK -> $OUT"
