# Guitar Tutor 3D

A three.js scene with a guitar and two animated hands that play guitar tabs. The fretting hand puts the right finger on the right string and fret at the moment each note sounds; the picking hand plucks (fingerstyle) or picks (alternate strokes) the matching string.

**Live:** https://sharvin27.github.io/GuitarTurtor/

## What it does
- **Fingering solver** (`js/fingering.js`): Viterbi search over hand positions with stretch and shift costs, one finger per fret, same finger through slides, no shifts during hammer-ons/pull-offs, ring finger for bends.
- **Hand motion** (`js/hand.js`, `js/timeline.js`, `js/performer.js`): per-finger IK with anatomical joint limits (DIP ≈ 0.66 · PIP), critically damped springs, fingers start moving 80–110 ms before each note and hover over the next note when free; thumb behind the neck.
- **Techniques**: slides, hammer-ons, bends and held bends with release, vibrato, octave shapes (two fingers), open strings (no finger).
- **Guitar** (`js/guitar.js`): procedural neck with exact 12-TET fret spacing, 22 frets, strings that deflect under the fingertips and vibrate when played.
- **Sync**: the audio's `currentTime` drives everything; without audio an internal clock is used.

## Songs and tab format
`data/*.json` — `{ "bpm", "grid": [beat times in s], "notes": [{ "t": seconds, "q": beat, "n": [[string, fret], …], "slide"|"ham"|"pull"|"bend"|"hb"|"rel"|"vib"|"pm" }] }`, string 0 = high e … 5 = low E.

- Choo Lo (The Local Train) intro — fingerstyle, G-string melody over open B and e.
- Rabba Mein Toh Mar Gya — electric lead, frets 5–22, bends.

Audio files are not in the repo (see `audio/README.md`).

## Run locally
```bash
npm install          # only needed for the self-check
npm run serve        # then open http://localhost:8080
npm run selfcheck    # fingertip-to-target error at every note onset
```
Self-check result (mm): Choo Lo mean 0.10 / max 0.48; Rabba mean 0.34 / max 3.09.

## Docs
- `RESEARCH.md` — hand models, fingering algorithms, joint biomechanics, related projects (with links).
- `PLAN.md` — architecture and priority list.

## Credits
- Hand models: WebXR Input Profiles generic hands, © 2019 Amazon and contributors, MIT (`assets/WEBXR-ASSETS-LICENSE.md`, `assets/CREDITS.md`). Embedded as base64 in `js/hand-assets.js`.
- three.js 0.160.0 (MIT), loaded from jsDelivr.
