# Verified guitar tutor improvements

Completed 2026-11-21. Read README.md, PLAN.md, RESEARCH.md, all requested modules, and tools/selfcheck.mjs before implementation. Ran the baseline before any edits. Chose three bounded changes: remove IK scratch allocation, repair missing-beat/numeric normalization, and make empty timelines release into valid rest poses. No anatomical model or fingering-cost redesign is claimed.

**1. Reuse FK/DLS scratch storage — js/hand.js.** Each chain now owns cumulative quaternions and its DLS vectors, matrix, Jacobian, coefficient array, and perturbed-angle array. Every working value is overwritten before use. The finite-difference step, damping, multiplication order, convergence thresholds, seed search, joint limits, and output objects are unchanged. Scratch tip storage remains separate from FK output because each Jacobian probe overwrites that output.

The pinned [r160 Quaternion implementation](https://github.com/mrdoob/three.js/blob/r160/src/math/Quaternion.js) confirms that clone allocates while copy/identity mutate existing storage. The [r160 SkinnedMesh implementation](https://github.com/mrdoob/three.js/blob/r160/src/objects/SkinnedMesh.js) also uses reusable math scratch objects. These primary sources support storage reuse without changing the mathematics.

Added tools/measure-motion.mjs, which simulates the same two songs at 60 fps, counts Vector3/Quaternion clones inside FK/DLS, and hashes the Float64 representations of both hands' placement matrices, joint angles, chain errors, positions, and quaternions at every frame. Hands are reused between songs, matching selfcheck. Results:

| Song | Frames | FK/DLS clone calls before → after | FK calls before = after | DLS calls before = after |
| --- | ---: | ---: | ---: | ---: |
| Choo Lo | 2,393 | 834,708 → 0 | 192,321 | 25,685 |
| Rabba | 1,716 | 2,250,676 → 0 | 555,040 | 16,152 |

The full-frame fingerprints are identical before and after all changes:

```text
choo-lo 61856229e636a00972810e10640d9986651bc2b702c3eb1bdb6d77c2817d2f29
rabba   d91d4f7ae7a0fee7345de63b11c1b9d6cf3ea083a03f265a9efd6e396eca29fe
```

This removes 3,085,384 measured clones, plus uncounted direct constructors/arrays in these loops. It does not eliminate allocations elsewhere. One instrumented Node run went from 250/333 ms to 203/255 ms (Choo Lo/Rabba); this is indicative only, not a statistically established browser speedup or GPU benchmark.

**2. Normalize absent beats and invalid tempo/duration — js/fingering.js.** Missing or nonfinite q now uses elapsed time from the first onset times bpm/60, matching the existing tab-strip convention. Finite authored q values remain intact. Nonfinite/nonpositive bpm falls back to 120; invalid d falls back to two sixteenths. Normalization still copies source records, and the tests verify input immutability.

Previously an eight-note, 120-bpm eighth-note melody with no q produced eight downstrokes and zero harmony segments. It now produces [down, up, down, up, down, up, down, up], beats [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], and one estimated C segment. This improves picking motion for user songs and removes the missing-data exclusion from harmony; it does not establish improved chord-estimation accuracy. The existing estimator labels this fixture's key Em, illustrating why its output remains an estimate.

The bugs were established from executable repo fixtures. [Number.isFinite documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isFinite) verifies rejection of NaN/Infinity without coercion. [MySong's primary publication page](https://www.microsoft.com/en-us/research/publication/mysong-automatic-accompaniment-generation-for-vocal-melodies/) describes learned HMM accompaniment and subjective evaluation; it supports treating melody harmonization as inference, not ground truth. No new chord weights were taken from it. The tempo fallback assumes constant tempo when beat annotations are absent; it does not recover an unknown beat grid. Malformed strings, frets, or onset times are outside this patch.

**3. Rest safely on an empty song — js/timeline.js and js/main.js.** Empty samples now supply four nonpressing finger targets and resting right-hand targets. Unprepared empty arrays also work. The main update no longer exits solely because the event list is empty, allowing strings, markers, HUD, and the playback display to update instead of retaining the previous frame.

Before: loading an empty timeline into a real Performer after a populated one threw `Cannot read properties of undefined (reading 'strike')`. After: prepared and raw empty lists, both picking modes, and repeated seeks produce finite, joint-limited poses, six null pressed-string entries, and zero sounding events. This is a repo-specific lifecycle fix, not a biomechanical claim. The r160 math source above informed retaining normal pose computation rather than substituting invalid coordinates.

**Verification.** Added tools/regression.mjs with four tests: absent beats/picking/harmony/input preservation; invalid tempo/duration; empty/reset timelines using actual GLB rigs; forward/backward seeks and rate changes. Before the fixes, three failed and one passed; after, all four pass. Seek/rate coverage checks finite poses and joint limits at 0.5×, 0.75×, 1×, and 1.5×; it does not claim audio-device synchronization accuracy.

Selfcheck was rerun after each change batch, including the diagnostic additions. Every run retained the baseline results:

| Measurement (mean / max) | Choo Lo before → after | Rabba before → after |
| --- | --- | --- |
| Fretting error, mm | 0.10 / 0.49 → 0.10 / 0.49 | 0.51 / 3.09 → 0.51 / 3.09 |
| Picking error, mm | 2.03 / 2.04 → 2.03 / 2.04 | 2.03 / 8.73 → 2.03 / 8.73 |
| MCP flexion, degrees | 26.81 / 27.98 → unchanged | 29.55 / 51.02 → unchanged |
| PIP flexion, degrees | 65.59 / 70.67 → unchanged | 55.49 / 76.08 → unchanged |
| Tip tilt, degrees | 25.10 / 31.75 → unchanged | 30.77 / 57.45 → unchanged |

Fretting samples: 80/79; picking samples: 160/73. There are still zero/one fretting errors over 3 mm. No rendered browser/GPU or audio playback evaluation was performed; numerical rig verification is the evidence for preserved hand quality.

Commands: `npm run selfcheck`, `node --test tools/regression.mjs`, `node tools/measure-motion.mjs`, `node --check` on every edited JS/MJS file, and `git diff --check`. Ran `npm run stamp` after every js/ edit batch; only index.html's generated script hashes changed. ES modules, no-build operation, and the jsDelivr three@0.160.0 pin remain intact. No dependencies, commits, pushes, or git configuration changes. The pre-existing untracked lessons/ directory and all protected paths were untouched, including tabs.html.

**Ideas evaluated but rejected/deferred.**

- Time-aware/minimax fingering: [Hori and Sagayama, ISMIR 2016](https://archives.ismir.net/ismir2016/paper/000285.pdf) models position-transition difficulty using onset intervals and a minimax objective. It also selects strings, whereas this project's tablature already fixes them. It supports the current DP approach and suggests future time-aware costs, but supplies no calibrated weights for this rig. No measured improvement or labeled fingering benchmark justified altering the current solution.
- Pad contact, nail clearance, barres: [Xu and Wang's guitar-playing research](https://arxiv.org/abs/2409.16629) uses physically simulated control and reference motion. The existing selfcheck measures tip joints, not skinned-pad contact, collision, or adjacent-string muting. A tip-only improvement would not verify those features. Deferred until those measurements exist.
- Changing DIP coupling: the [cadaveric index-finger study](https://pmc.ncbi.nlm.nih.gov/articles/PMC2483967/) reports a DIP/PIP regression slope of 0.692 ± 0.358 under FDP loading, with explicit limitations in generalizing to live hands. This supports leaving the existing 0.66 approximation alone, not replacing it with another apparently precise universal value.
- Wrist-rotation strokes and palm mute: deferred because pick-tip onset distance alone does not verify wrist motion, pick orientation, or palm/bridge contact. No borrowed motion data or runtime physics added.
- Enabling hand frustum culling: r160's SkinnedMesh bounding-sphere computation visits skinned vertices. A stale sphere can clip animation, while recomputing it for subdivided hands adds CPU work. No verified conservative envelope or GPU measurement justified changing the current setting.
- Chord-model reweighting: MySong uses training data and evaluation; the repo has no labeled chord benchmark. Kept the estimator and its uncertainty messaging, fixing only beat availability.
- Broader performer/marker/tab-strip allocation work: the verified FK/DLS change removes the large repeated allocation source. Further caching adds invalidation/aliasing risk without a measured browser bottleneck, so it was left out.
