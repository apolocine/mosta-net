#!/usr/bin/env sh
# Rasterise la rangée déterministe des 18 langages (SVG -> PNG transparent) via ImageMagick.
# ImageMagick respecte width/height/viewBox sans clipping (contrairement au headless Chrome).
# @author Dr Hamid MADANI <drmdh@msn.com>
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"     # .../assets
SVG="${1:-$DIR/language-row-18.svg}"
OUT="${2:-$DIR/language-row-18.png}"
DENSITY="${3:-192}"                          # 192 ~= rendu @2x net
convert -background none -density "$DENSITY" "$SVG" "$OUT"
echo "-> $OUT"
