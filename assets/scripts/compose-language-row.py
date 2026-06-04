#!/usr/bin/env python3
"""Compose la rangée déterministe (PNG rendu depuis SVG) sur un schéma généré par IA.

Pourquoi : les générateurs d'images (diffusion) ne savent pas compter ni
numéroter de façon fiable 18 prises distinctes (doublons, prises vides,
numéros sautés). On garde donc le HAUT photoréaliste de l'IA (correct) et on
REMPLACE la bande basse des langages par une rangée SVG exacte, compositée ici.

Pipeline : masque blanc sur l'ancienne bande -> collage de la rangée correcte.

@author Dr Hamid MADANI <drmdh@msn.com>
"""
import argparse
from PIL import Image, ImageDraw


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", required=True, help="image IA de base (haut correct)")
    ap.add_argument("--strip", required=True, help="PNG de la rangée langages (rendu SVG)")
    ap.add_argument("--out", required=True, help="image de sortie composée")
    ap.add_argument("--mask", default="0,596,1536,786",
                    help="x0,y0,x1,y1 de la zone à blanchir (dépend de la base)")
    ap.add_argument("--paste-y", type=int, default=604, help="y de collage de la rangée")
    ap.add_argument("--width", type=int, default=1536, help="largeur cible de la rangée")
    a = ap.parse_args()

    base = Image.open(a.base).convert("RGBA")
    x0, y0, x1, y1 = map(int, a.mask.split(","))

    strip = Image.open(a.strip).convert("RGBA")
    h = round(strip.height * a.width / strip.width)
    strip = strip.resize((a.width, h), Image.LANCZOS)

    ImageDraw.Draw(base).rectangle([x0, y0, x1, y1], fill=(255, 255, 255, 255))
    base.alpha_composite(strip, (0, a.paste_y))
    base.convert("RGB").save(a.out)
    print("->", a.out)


if __name__ == "__main__":
    main()
