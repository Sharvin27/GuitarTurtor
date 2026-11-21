# Guitar3D: research notes (Phase 1)

Goal: show a 3D guitar and an animated human hand in the browser. The page reads our tab JSON
(`{bpm, grid, notes:[{t,q,d,n:[[string,fret]],...}]}`) and plays the fingering in sync with the recording.
It has to run as a claude.ai Artifact: three.js from a pinned CDN, with every asset shipped as a local file.

---

## 1. Rigged human hand models (web-ready, 5 jointed fingers)

| Candidate | Rig | Format / size | License | Verdict |
|---|---|---|---|---|
| **WebXR Input Profiles `generic-hand`** (`left.glb`, `right.glb`), contributed by Meta to `@webxr-input-profiles/assets`. It is the default mesh used by three.js `XRHandMeshModel` / `XRHandModelFactory('mesh')` | 25 joints per hand, named exactly as in the WebXR Hand Input spec: `wrist`, `thumb-metacarpal/phalanx-proximal/phalanx-distal/tip`, and for each of index/middle/ring/pinky `-metacarpal`, `-phalanx-proximal`, `-phalanx-intermediate`, `-phalanx-distal`, `-tip`. Skinned mesh, 1360 verts | glb, about 94 KB each | **MIT** (© 2019 Amazon, package LICENSE.md) | **CHOSEN.** Small and permissively licensed, and the bones are already the anatomical set we need. One quirk: the joints are **siblings under `Armature`** (not parented to each other), because XR runtimes write world poses per joint. We drive them with our own forward kinematics, which actually makes this easier. |
| three.js example `Xbot.glb` / Mixamo rigs | `mixamorig:LeftHandIndex1..4` etc. (3 phalanges + end bone; no metacarpals) | glb, about 3 MB with the body | Mixamo content: free to use in projects after Adobe login, but redistributing raw rigs is restricted. Licensing of the copy in the three.js repo is unclear | Rejected: a full body we don't need, and unclear licensing. |
| Sketchfab "Free Pack – VR Hands (Rigged)" (PolyOne Studio) | rigged L+R | glTF via Sketchfab | not confirmed (Sketchfab free models are usually CC-BY) | Possible later upgrade for nicer skin. Needs a manual license check and a Sketchfab login to download. |
| Quaternius / Kenney / Poly Pizza | None of them has a standalone rigged hand (searched) | – | CC0 | No suitable asset. |
| Procedural hand (our own code: palm box + capsules) | any | 0 KB | ours | Fallback if the glb fails. Not needed. |

Links:
- WebXR Hand Input joint list and axis conventions: https://www.w3.org/TR/webxr-hand-input/
- Asset package (MIT): https://www.npmjs.com/package/@webxr-input-profiles/assets · files: https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.19/dist/profiles/generic-hand/
- Meta note on contributing `generic-hand`: https://developers.meta.com/horizon/documentation/web/webxr-hands/
- three.js loader that consumes it: https://github.com/mrdoob/three.js/blob/r160/examples/jsm/webxr/XRHandMeshModel.js
- Sketchfab candidate: https://sketchfab.com/3d-models/free-pack-vr-hands-rigged-b3b8309e59c748e3956531c8f57dd233

## 2. Guitar model: procedural vs. downloaded

Downloaded guitar models (Sketchfab/CGTrader) almost never have accurate fret spacing. Their string and fret
positions would have to be measured and re-registered by hand, and most are CC-BY or paid. A **procedural neck** gives
exact geometry from the 12-TET rule and costs nothing to ship:

- Fret n position from the nut: `x_n = L · (1 − 2^(−n/12))`. With L = 0.648 m (25.5" Fender scale), fret 12 sits at L/2.
- Finger contact point for fret n: just behind the wire, `x_n − 0.25·(x_n − x_{n−1})`.
- Taper: fingerboard about 43 mm wide at the nut and about 56 mm at fret 22. String spread is 35 mm at the nut and 52 mm at the bridge, interpolated linearly along x.
- Inlays at 3, 5, 7, 9, 15, 17, 19 and 21, with a double inlay at 12. Body is an extruded outline; headstock is a box.

**Decision: procedural** (everything built in `js/guitar.js`). If visuals matter later, a CC0/CC-BY body mesh can be added behind the procedural neck.

## 3. How fingers really move on a guitar

**Landmark models and data**
- MediaPipe Hand Landmarker uses 21 landmarks (wrist plus 4 per finger: MCP/PIP/DIP/TIP, thumb CMC/MCP/IP/TIP). It maps 1:1 onto the WebXR joints, minus the metacarpals. Useful later for retargeting video of the user's own playing. https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
- Xu & Wang, *Synchronize Dual Hands for Physics-Based Dexterous Guitar Playing* (SIGGRAPH Asia 2024). About 1 h of 120 fps optical mocap of a professional guitarist, covering scales, chords, bends, slides, vibrato and palm mute. Code and mocap dataset are released (no license stated). https://arxiv.org/abs/2409.16629 · https://pei-xu.github.io/guitar · https://github.com/xupei0610/guitar
- Luo et al., *Learning to Play Guitar with Robotic Hands* (CGF/PG 2024). Tablature → fingering; deep RL for the left hand, **IK for the right-hand plucking**. https://mrxuanl.github.io/publications/guitarplayer.html · code https://github.com/MRXuanL/GPS-GuitarPlaySimulation (no license file visible, so treat it as reference only)
- Canales & Jörg, *Real-time Hand Motion Synthesis for Playing a Virtual Guitar*. Mocap dataset with fingertip goals plus a network that predicts poses from tabs and previous poses. https://fis.uni-bamberg.de/bitstreams/3c16d751-4834-4437-9707-888cff552591/download
- ElKoura & Singh, *Handrix: Animating the Human Hand* (SCA 2003). The classic "hand animation from tablature" paper: a fingering cost search plus a data-driven correction of IK poses. https://www.dgp.toronto.edu/~gelkoura/handrix/paper.html
- Perez-Carrillo, *Finger-string interaction analysis in guitar playing with optical motion capture* (Frontiers 2019). Plucking-hand capture is hard because of marker occlusion. https://www.frontiersin.org/articles/10.3389/fcomp.2019.00008/pdf
- StringStar (dissertation): Unity virtual guitar tutor built from mocap-glove clips. https://l0rdr0b.github.io/coursework/dissertation
- Cambridge group project "Guitar tab2hand" (spec only): https://wiki.cam.ac.uk/cl-design-projects/Guitar_tab2hand

**Anatomy (used as joint limits)**
- Active flexion ROM: MCP about 0–90° (hyperextension to about −20°), PIP about 0–105/110°, DIP about 0–70/80°. Abduction at the MCP is about ±15–20° (index and pinky widest). Pooled table: https://pmc.ncbi.nlm.nih.gov/articles/PMC4372184/table/tbl3
- **DIP–PIP coupling:** DIP ≈ 0.69 × PIP in a cadaver regression, so the common animation rule DIP ≈ 2/3·PIP is well supported. https://pmc.ncbi.nlm.nih.gov/articles/PMC2483967 (and https://link.springer.com/doi/10.1186/1749-799X-3-27)
- Fretting posture: the thumb sits behind the neck roughly opposite the index/middle fingers. Fingertips land almost perpendicular to the fingerboard just behind the fret wire. Non-pressing fingers hover a few mm to 1–2 cm above the strings over "their" fret (one-finger-per-fret).

**Solving and smoothing**
- With DIP coupled to PIP, a finger has 3 free DOF (MCP abduction, MCP flexion, PIP flexion) for a 3D fingertip target, so it is exactly determined. A tiny damped-least-squares (DLS) Newton solver with warm start converges in 3–6 iterations. Generic alternatives: three.js `CCDIKSolver` (needs a bone hierarchy, which the WebXR hand doesn't have; per-link angle limits only) https://threejs.org/docs/#examples/en/animations/CCDIKSolver and FABRIK (Aristidou & Lasenby 2011) http://www.andreasaristidou.com/FABRIK.html. Both handle the coupling and abduction plane less cleanly than a dedicated 3-DOF solver.
- **Critically damped springs** for targets: the closed-form update `x(t)=g+(x0−g+(v0+ω(x0−g))t)e^{−ωt}` is unconditionally stable for any dt (D. Holden, "Spring-It-On"). https://theorangeduck.com/page/spring-roll-call. We spring the *targets* (fingertip, hand position), not the angles, so IK output stays anatomically valid.

## 4. Existing open-source projects and reusable bits

| Project | What | License | Reusable? |
|---|---|---|---|
| three.js r160 (`OrbitControls`, `GLTFLoader`, `XRHandMeshModel`) | rendering, camera, glTF | MIT | Yes, via the pinned jsDelivr CDN |
| `@webxr-input-profiles/assets` generic hands | rigged hands | MIT | Yes (shipped in `assets/`) |
| xupei0610/guitar | physics guitar-playing policy plus mocap | none stated | Ideas only; mocap could inform poses later (check the license first) |
| MRXuanL/GPS-GuitarPlaySimulation | MuJoCo RL guitar playing; tab → target pipeline | none stated | Ideas only (right-hand IK plucking scheme) |
| moonwave99/fretboard.js | 2D SVG fretboard | MIT | Not needed (we have a 2D tab viewer already) |
| CloudAI-X/threejs-skills, secondsky/claude-skills `threejs`, kndoshn/threejs-skill-plugin | Claude Code `SKILL.md` collections for three.js (scene setup, loaders, animation, materials) | see each repo (MIT for most) | Reference for conventions only. Nothing specific to hand IK or guitar. https://github.com/cloudai-x/threejs-skills · https://skills.sh/secondsky/claude-skills/threejs |

No open-source **three.js** project animating guitar fingering from tabs was found (searched GitHub and the web), so this would be new.

## 5. Fingering assignment and picking-hand motion

- **One-finger-per-fret position playing:** with the hand at position p (index on fret p), finger = fret − p + 1, so index p, middle p+1, ring p+2, pinky p+3. Open strings need no finger.
- **Choosing p over time = shortest path / Viterbi.** States are hand positions; the emission cost is infinite unless every fretted note of the event fits in [p, p+3] (a stretch to p+4 is allowed with a penalty); the transition cost is proportional to |Δp| plus a fixed shift penalty. Sayegh (1989) introduced this "optimum path paradigm". Radicioni et al. and Hori & Sagayama (*Minimax Viterbi for HMM-based guitar fingering*, ISMIR 2016) refine it. https://archives.ismir.net/ismir2016/paper/000285.pdf · SMC 2024 HMM formulation: https://smcnetwork.org/smc2024/papers/SMC2024_paper_id55.pdf · learned alternative (MIDI-to-Tab, 2024): https://arxiv.org/html/2408.05024v1
- Our tabs already fix string+fret, so we only need to choose **positions and fingers**. That is a small Viterbi over about 20 states per event.
- **Slides** keep the same finger and move the hand. **Hammer/pull** (`hb`/`pull`) use finger-to-finger within one position. **Bends** (`bend`) push the string across the fingerboard (+z offset on the target, usually ring finger backed by middle). **Vibrato** is a small oscillating offset.
- **Picking hand.** Electric with a pick (Rabba): the hand pivots at the wrist, pick tip about 3 mm past the string, alternate down/up strokes keyed to the 16th grid. Fingerpicking p-i-m-a (Choo Lo): the thumb (p) takes the bass strings 3–5 and i/m/a take G/B/e. A pluck is approach → push-through toward the palm → release. Luo et al. show plain IK is enough for the right hand.

## Top-line conclusions
1. Use the **MIT WebXR generic hand** and drive its flat joints with our own FK + 3-DOF IK (DIP = 2/3·PIP, anatomical limits).
2. **Procedural 12-TET neck** (22 frets, L = 0.648 m) gives exact fingertip targets.
3. **Viterbi over hand positions** for one-finger-per-fret fingering (cheap and robust); greedy as a fallback.
4. **Critically damped springs on targets**, with anticipatory lead so fingers land *on* the onset; `audio.currentTime` is the master clock.
5. Right hand: reuse the same IK with the mirrored generic hand (p-i-m-a for acoustic; a pick hand is a later item).
