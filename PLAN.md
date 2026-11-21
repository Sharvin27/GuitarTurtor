# Guitar3D: design and priority list (Phase 2)

## Architecture

```
score JSON ──► normalize events ──► fingering solver ──► per-event plan
 (t,q,d,n,…)   (sorted, dur in s)   (Viterbi over hand   {t, dur, pos p, notes:[{s,f,finger}]}
                                     positions 1..19)            │
audio.currentTime (master clock) ───────────────────────────────►│
                                                                 ▼
                                              timeline sampler (per frame, time T)
                                              • active event i (with anticipation lead)
                                              • per-finger state: PRESS(s,f) / HOVER(s,f) / REST
                                              • hand position target (fret p)
                                                                 │ targets in guitar space
                                                                 ▼
                                   critically damped springs (closed form, any dt)
                                   hand-root x, 4 fingertip targets (+thumb)
                                                                 │
                                                                 ▼
                    3-DOF finger IK (MCP abd, MCP flex, PIP flex; DIP = 2/3·PIP),
                    joint limits, damped least squares with warm start
                                                                 │ joint angles
                                                                 ▼
                    FK → bone position + quaternion for the flat WebXR skeleton
                                                                 │
                                                                 ▼
                three.js render: procedural neck/body, strings (plucked string glows),
                note markers, skinned hand(s), OrbitControls, camera follows hand
```

### Coordinate frames
- **Guitar space G** (metres): x = distance from the nut toward the bridge, y = height above the fingerboard
  surface, z = across the neck (low E at +z, high e at −z). The guitar group maps G to world as
  x→−X, y→+Z, z→+Y (audience view: headstock to the right, low E on top).
- **Hand space**: the glb's Armature space. A per-hand basis (finger direction f, lateral l toward the index,
  dorsal n from the joints' +Y) is aligned to a G-space basis, then translated so the knuckle midpoint lands
  over the centre of the four-fret window.

### Fingering solver (`js/fingering.js`)
- Events = notes with any fretted string. Open strings (fret 0) need no finger.
- Viterbi over p ∈ [1, 20]. Emission is 0 if all frets ∈ [p, p+3], 2 + 3·k for a stretch of k frets
  (up to p+4 or p−1), otherwise ∞. Transition = 0.6·|Δp| + 1.5·[Δp≠0]. A slide note's transition is free,
  since the hand moves with the finger anyway.
- Finger = fret − p + 1, clamped to 1..4. When two notes want the same finger, the nearest free finger
  takes one of them; if none is free, the finger is shared (a mini barre).

### Motion (`js/main.js` timeline + `js/hand.js`)
- Lead: a finger starts travelling `lead = min(0.09 s, 0.6·gap)` before the onset, so a spring with
  ω≈45 rad/s lands it on the beat.
- The pressing fingertip target is the contact point behind the fret wire, pad on the string.
  Non-pressing fingers hover 10–14 mm above "their" fret over their last string.
  If the gap after the last note is more than 0.6 s, everything relaxes upward.
- Hand root spring ω≈18 rad/s along the neck. Seeking (|ΔT| > 0.25 s) snaps all springs.
- The thumb gets an IK target behind the neck, opposite the index/middle fingers.

### Picking hand
- P0: string highlight plus a fret marker on every sounding note.
- P1: mirrored generic hand over the soundhole using the same IK. p-i-m-a fingerpicking (thumb on
  strings 3–5, i/m/a on G/B/e): approach → push through toward the palm → release.
- P2: pick-holding pose for electric songs, with alternate strokes on the 16th grid.

### Audio sync
`<audio>` loads the local mp3. Each frame T = audio.currentTime + offset (a user-adjustable latency
slider, P1). The scrub bar writes currentTime. Because animation is a pure function of T (springs aside),
pausing and seeking stay consistent.

## Asset choices
| Asset | Source | License |
|---|---|---|
| three.js 0.160.0 + OrbitControls + GLTFLoader | cdn.jsdelivr.net/npm/three@0.160.0 (importmap) | MIT |
| Hands `generic-hand-left.glb` / `-right.glb` | @webxr-input-profiles/assets 1.0.19 | MIT (© 2019 Amazon) |
| Guitar | procedural (our code) | ours |
| Audio / tabs | user's own files from `tab-viewer` | user's |

## Priority list (re-ordered: hand physics that matches the notes is #1)

Status: ✅ done in the prototype · ◐ partial · ☐ not started.

| ID | Item | Effort | Status |
|---|---|---|---|
| **P0-1** | **Note-accurate fretting.** At each onset the assigned fingertip sits on the exact string, just behind the exact 12-TET fret, and pushes the string down onto the fret. Open strings get no finger. Chords and octave shapes press several fingers at once. Bends (`bend`, `hb`, `rel`) push the string sideways with the finger, backed by the lower fingers. Slides glide without lifting. Hammer-ons strike from above with a stiff spring; pull-offs pre-plant the destination finger. Strings deform from the *actual* fingertip positions | 4 h | ✅ |
| **P0-2** | **Plausible five-finger motion.** Viterbi fingering (stretch and shift costs, one finger per fret, slide pairs keep the finger, no shifts inside hammer/pull pairs, bends prefer the ring finger). 3-DOF finger IK with MCP/PIP limits and DIP = 0.66·PIP. Ring/pinky (and middle/ring) coupling on hover height. Fingers start moving 80–110 ms before the onset (critically damped springs, ω = 55 rad/s; strikes and glides use ω = 95). Free fingers hover 7 mm (3.5 mm when coupled) over the next note they will play. The hand translates along the neck (ω = 34) and across with string focus. Thumb on the back of the neck, riding round toward the bass side for low strings | 4 h | ✅ |
| **P0-3** | **Picking hand.** Choo Lo uses p-i-m-a (thumb on strings 3–5, i/m/a on G/B/e), each pluck being plant → push-through → release. Rabba uses a pick grip (index curled, thumb pad on the index) with alternate strokes (16th grid when dense, 8th grid otherwise) crossing the string at the onset. Legato notes (after slide/ham/pull) are not picked | 3 h | ✅ (simple) |
| **P0-4** | **Sync.** `audio.currentTime` is the master clock (audio loaded as a Blob so seeking works on any static host); play/pause, scrubber, 0.5×/0.75× speed, both songs selectable | 1 h | ✅ |
| **P0-5** | **Self-check** (`tools/selfcheck.mjs`): simulates the exact page code at 60 fps and logs fingertip-to-target distance at every onset | 1 h | ✅ |
| P0-6 | Procedural neck (22 frets, tapered strings, inlays), MIT generic hands, forearms anchored to elbow points, orbit camera following the fretting hand, camera presets | 3 h | ✅ |
| P1 | Wrist/forearm IK (elbow + wrist flexion) instead of a rigid palm frame; hand roll/yaw with position (low frets fan the fingers) | 3 h | ☐ |
| P1 | Finger-pad contact model: target the pad (not the tip joint), flatten the pad on press, nail-side clearance from adjacent strings (avoid muting) | 2 h | ☐ |
| P1 | Barre detection for chords (index flattens across strings) and shared-fret two-finger cases | 2 h | ☐ |
| P1 | Pick hand: wrist rotation stroke instead of translation; palm mute (`pm`) resting the palm on the bridge; pick depth by stroke velocity | 2 h | ☐ |
| P1 | Latency offset slider; 2D tab strip under the 3D view (reuse tab-viewer rendering) | 1.5 h | ☐ |
| P2 | Learned or mocap pose prior (Xu & Wang 2024 mocap, licence permitting) to make idle-finger shapes and hand roll look human | 1–2 d | ☐ |
| P2 | Electric body model option, wood/skin textures (CC0) | 2 h | ☐ |

## Self-check results (60 fps simulation, error measured at the first frame after each onset)

| Song | Fretting notes | mean / max fingertip error | Plucks | mean / max picking contact error |
|---|---|---|---|---|
| Choo Lo (p-i-m-a) | 80 | 0.10 / 0.48 mm | 160 | 2.03 / 2.04 mm (the finger is planted 2.2 mm beside the string by design) |
| Rabba (pick) | 86 | 0.31 / 2.81 mm | 78 | 2.07 / 8.73 mm (2 strokes over 3 mm: one 60 fps frame is about 6 mm of stroke travel) |

Run it with `node --import <hook that maps 'three' to three@0.160.0> tools/selfcheck.mjs` (`--fit-right` refits the
picking-hand placement).

## Data notes
- `score.json` (Rabba) has two pairs of same-string onsets at identical `t` (11.436 s, 19.598 s) with different `q`.
  `normalizeScore` re-times the earlier one by its beat position between its neighbours. The source is unchanged.
