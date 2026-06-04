# assets/scripts — traitement d'image du schéma « MOSTA ECOSYSTEM »

**Auteur** : Dr Hamid MADANI <drmdh@msn.com>

Pipeline reproductible pour produire le schéma d'architecture avec une rangée
de langages **100 % correcte**.

## Pourquoi
Les générateurs d'images (diffusion) **ne savent pas compter/numéroter** 18
prises distinctes de façon fiable (doublons, prise vide, numéros sautés —
constaté sur de multiples essais). On sépare donc deux couches :
- **Haut photoréaliste** : généré par IA (ORM, NET/Octonet, ORM-MCP/NET-MCP,
  Data-Plug, NetClient, frigo, EMBEDDED PORTS) — **correct**.
- **Bande des 18 langages** : **déterministe**, définie dans
  [`../language-row-18.svg`](../language-row-18.svg) (numéros + labels exacts),
  rasterisée puis **compositée** sur l'image IA.

## Fichiers
| Script | Rôle |
|---|---|
| `render-language-row.sh` | `language-row-18.svg` → `language-row-18.png` (ImageMagick, sans clipping) |
| `compose-language-row.py` | masque l'ancienne bande + colle la rangée correcte (PIL) |
| `build-diagram.sh` | orchestre les deux |

## Usage
```sh
cd assets/scripts
./build-diagram.sh "../ChatGPT Image ...-v67.png"   # → ../mosta-ecosystem-composite.png
```
Réglages par défaut calibrés pour une base **1536×1024** (`--mask 0,596,1536,786`,
`--paste-y 604`). Si la base change, ajuster ces paramètres.

## Pré-requis
- **ImageMagick** (`convert`)
- **Python 3** + **Pillow** (`pip install pillow`)

## La rangée de référence (18 langages)
TypeScript · JavaScript · Python · Java *(+ Spring Boot)* · .NET/C# · PHP · Go ·
Rust · Delphi · Unity · WinDev · Android · Dart · Kotlin · Swift · Ruby ·
Elixir · Lua — éditer `../language-row-18.svg` pour toute modification.
