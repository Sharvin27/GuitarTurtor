# Textures

Colour maps for the 3D guitar and hands, generated with Higgsfield (GPT Image 2.6, prompted as flat, evenly lit, seamless scans) and compressed to JPEG.

| File | Used on | Size |
|---|---|---|
| `rosewood.jpg` | fingerboard, bridge | 2048 wide (21:9) |
| `mahogany-neck.jpg` | neck back, headstock | 2048 wide (21:9) |
| `spruce.jpg` | body top | 1024 × 1024 |
| `mahogany.jpg` | body sides | 1024 × 1024 |
| `skin.jpg` | both hands, forearms | 1024 × 1024 |

They are applied by `applyTexture()` in `js/guitar.js` (also used by `js/hand.js`). Only the look changes: fret spacing, string positions and the hand rig stay exactly as computed. A texture is applied after it loads, so if a file is missing the flat colour stays.
