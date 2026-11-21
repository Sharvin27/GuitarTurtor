# Asset credits

| File | Source | License | Attribution |
|---|---|---|---|
| `generic-hand-left.glb`, `generic-hand-right.glb` | WebXR Input Profiles, `@webxr-input-profiles/assets@1.0.19`, `dist/profiles/generic-hand/{left,right}.glb`. Downloaded from https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.19/dist/profiles/generic-hand/ (repo: https://github.com/immersive-web/webxr-input-profiles; hand meshes contributed by Meta) | MIT (full text in `WEBXR-ASSETS-LICENSE.md`) | "Hand models from WebXR Input Profiles (MIT) © 2019 Amazon and contributors" |
| three.js 0.160.0 (loaded at runtime from cdn.jsdelivr.net, not shipped) | https://github.com/mrdoob/three.js | MIT | © 2010-2023 three.js authors |
| Guitar (neck, frets, strings, body) | procedural, `js/guitar.js` | project code | n/a |
| `audio/choo-lo.mp3`, `audio/rabba.mp3`, `data/*.json` | copied from the user's `tab-viewer` project | user's own material | n/a |

## Transcription models (create.html, js/songmaker.js)
- `models/guitab_e25.onnx.part0` + `.part1`: guitab E25 by Daniele Morotti (https://github.com/DanieleMorotti/guitab,
  weights from https://huggingface.co/danmor/guitab), split in two so each file stays under 15 MB; joined in the browser.
  Code MIT, weights **CC BY-NC-SA 4.0** (non-commercial). SHA-256 of the joined file:
  3ce79d9240f2b90558ece516cb13927da7ac95dc3e865531604f785b7828ec22. guitab's browser JS is loaded from jsDelivr (pinned commit).
- Spotify basic-pitch (Apache-2.0), loaded from jsDelivr (`@spotify/basic-pitch@1.0.1`), is the fallback.
