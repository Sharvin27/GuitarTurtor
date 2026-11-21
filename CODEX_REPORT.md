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

## Hear a song -> 3D lesson

Implemented and checked in the requested order on 2026-11-21. Baseline: the original four regression tests passed, with fretting error Choo Lo 0.10/0.49 mm and Rabba 0.51/3.09 mm (mean/max).

**1. Recording to lesson.** `create.html` now transcribes automatically after microphone Stop or tab-capture Stop, including Chrome ending the shared video track. Uploaded files still wait for **Write the tab**, which also allows rerunning the current audio with another model. Controls prevent overlapping recording/transcription operations. The checked-by-default **Open the 3D lesson when done** option navigates in the same tab after saving; unticking it leaves the result and download links visible. Failed localStorage saves do not navigate to an unavailable song.

`js/song-audio.js` stores the original Blob in IndexedDB by song id. Open, upgrade, transaction, request, abort, quota, blocked-storage and close failures are caught; stalled operations time out, and a late database open is closed. Writes resolve only when their transaction commits. Delete in the saved-song list also requests deletion of that recording. Unavailable audio storage leaves the score usable with video/synth fallback and a status message; deletion failure is reported rather than claimed successful.

`js/main.js` loads a user song's stored Blob before hosted audio, YouTube or synth. Scores retain their video-time format; `audioOffset` shifts notes, grid and chord segments to the recording's clock without modifying the saved score. Recording-relative transcription is computed before this shift, preserving leading silence and notes around a negative capture offset. The decoded `audioDuration` supplies a finite scrub range even when MediaRecorder WebM metadata reports Infinity. Old songs without this metadata retain their existing behavior. Blob URLs are revoked when replaced, and stale asynchronous loads cannot overwrite a newer selection. The lesson opens paused at zero with Play ready; automatic navigation does not require browser autoplay permission. `js/user-songs.js` needed no change: its existing JSON persistence preserves the additional metadata and `score.chords`.

Verification before step 2: seven tests passed, including page-controller tests for recording completion, automatic navigation, opt-out, uploads/reruns, failed score saves, audio deletion and recording-time translation.

**2. Preserve chord events.** `js/songmaker.js` retains the existing 50 ms onset grouping and melody beam search. Within a group, overlapping notes that meet both the existing relative loudness threshold (default 75% of the loudest onset) and amplitude 0.3 qualify for chord assignment when they contain at least three distinct pitch classes. Duplicate MIDI pitches collapse; octave doublings remain. Repeated chord strums are retained even when their top note repeats within 130 ms.

Assignment first searches matching pitch-class entries in `chords/chord_shapes.json`, translating its low-E-first order into score string 0 = high e. It uses only the detected pitches present in a shape, without adding unheard notes or changing octaves. If no library shape fits, an exact-pitch string search prefers lower frets. Every accepted assignment has distinct strings, frets 0–22 and a maximum four-fret span excluding open strings. Unplayable groups, dyads, quiet notes and non-overlapping groups retain the melody path. Library loading failure still permits string search. Newly transcribed songs containing chord events use the existing pick mode to sweep their strings; monophonic songs retain fingerstyle mode. No rig or timeline changes were needed.

Before editing the converter, captured its monophonic score JSON in `tools/fixtures/monophonic.json` at offsets 0, +3.25 and -0.5 seconds. All three outputs remain identical as serialized JSON, with and without the chord library. Eleven tests passed before starting step 3, including grouping, repeated strums, fallback, pitch preservation and assignment validity.

**3. Chords from the recording.** New `js/audio-chords.js` analyzes the decoded mono 22,050 Hz Float32Array in half-second windows. It computes Hann-windowed FFT peaks, interpolates their frequencies, folds pitches into chroma, aggregates frames by median, and cosine-matches 24 major/minor templates. Root weighting, scaled emissions, sticky Viterbi smoothing and similarity/margin confidence follow the essential approach in `chords/detect_audio.py`. Silence/unclear windows can remain unlabelled; adjacent identical results merge with duration-weighted confidence. Processing yields periodically to keep progress updates responsive.

Creation saves `score.chords = [{t0, t1, name, conf}]`, including in downloaded JSON. Names use the library spelling: C, Db, D, Eb, E, F, F#, G, Ab, A, Bb, B. `js/chordpanel.js` prefers these segments and labels them **from the audio**. Scores without that array retain `js/harmony.js` with **estimated from the melody**. An explicitly empty audio result stays empty instead of silently substituting melody estimates. Fourteen tests passed after this stage.

**Research and sources.** Read the specified repository files before implementation. Used the connected Firecrawl tools because the local Firecrawl CLI was unavailable. Product pages describe workflows and vendor claims, not independently measured accuracy:

- Songscription, audio-to-tab workflow and transcription review: https://www.songscription.ai/guitar-tab-generator and https://www.songscription.ai/blog/audio-to-guitar-tabs . These support making the generated result immediately available for listening and review; no proprietary model or accuracy claim was adopted.
- Note2Tabs, playable tabs, string/fret optimization, alternative chord fingerings and practice playback: https://www.note2tabs.com/ . This informed retaining guitar constraints after pitch detection.
- Tabtify, recording/upload to editable draft, playback and source comparison: https://tabtify.com/ . This supports preserving the heard recording alongside the tab. No audio was sent to these services.
- Spotify Basic Pitch, polyphonic transcription and best results with one instrument at a time: https://github.com/spotify/basic-pitch . Browser API, mono input and 22,050 Hz processing: https://github.com/spotify/basic-pitch-ts . Existing pinned models and dependencies were retained.
- AudioLabs FMP, chroma and cosine template matching: https://www.audiolabs-erlangen.de/resources/MIR/FMP/C5/C5S2_ChordRec_Templates.html . Temporal context and Viterbi postfiltering: https://www.audiolabs-erlangen.de/resources/MIR/FMP/C5/C5S3_ChordRec_HMM.html . These corroborate the local Python detector's approach and its simplified browser port.

**4. Final verification.** `node --test tools/regression.mjs`: **18/18 passed**, comprising the original four and fourteen added tests. Fixtures under `tools/fixtures/` cover original monophonic output, generated sine/harmonic-sum audio, and browser API doubles. Additional final checks exercise the actual main.js loading/clock functions: exact Blob identity and priority, ready-to-play state, offset alignment, video/synth fallback, URL replacement and stale reads. IndexedDB tests cover round-trip storage/deletion and eight failure stages, including request success followed by transaction abort. The create controller is run from the real HTML; capture testing ends the shared video track.

Synthetic audio correctly names C, G, Am and F individually with both pure sine tones and five harmonics. A C–G–Am–F progression produces the expected four segments and boundaries, with leading/trailing silence unlabelled. These are deterministic DSP checks, not a real-recording accuracy benchmark.

| Fretting error, mm (mean/max) | Before | After |
| --- | --- | --- |
| Choo Lo | 0.10 / 0.49 | 0.10 / 0.49 |
| Rabba | 0.51 / 3.09 | 0.51 / 3.09 |

`npm run selfcheck` passed before and after. `node --check` passed for every changed/new JS and MJS file and the extracted create.html inline module. `npm run stamp` updated only index.html and create.html; `git diff --check` passed. Protected tracked paths have no changes, including tabs.html. The pre-existing untracked lessons/ directory was left alone. No runtime dependencies, CDN libraries, commits, pushes or git-configuration changes were made; three remains jsDelivr 0.160.0. All audio decoding, transcription, chord analysis and recording storage remain in the browser.

**Known limits and skipped work.** No live microphone/tab-share permission session, real ONNX/TF.js inference run, WebGL visual review or audio-device latency measurement was performed. Controller and storage tests use API doubles; real browser codecs, quota, eviction and permissions still vary. A recording that cannot be stored falls back to video/synth; failed audio deletion may require retrying when storage is accessible or clearing site data. Saved audio playback was added only to the requested 3D view; tabs.html remains untouched.

The browser detector intentionally substitutes an FFT chromagram for Python's harmonic separation/CQT and uses the permitted fixed 0.5 s windows. Beat-synchronous analysis, tuning estimation and optional seventh-chord templates were skipped to keep this dependency-free port small and verifiable. Dense mixes, percussion, strong harmonics, single-note overtones, fast changes and non-standard tuning can confuse it; confidence is a heuristic, not a calibrated probability. Grouping can miss slow strums beyond 50 ms or quieter chord tones. Chord names do not infer missing tab pitches. String assignment enforces the requested geometric constraints, but the existing rig still lacks a true barre pose, and the monophonic beam search does not optimize transitions between whole chord shapes. Those animation/solver extensions were outside this change and would require new motion evidence before altering the protected hand paths.
