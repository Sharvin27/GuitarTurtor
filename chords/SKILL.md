---
name: guitar-chords
description: Answer guitar chord questions, find fingerings, detect chords from audio or from a fretting-hand video, and produce strumming/picking timelines. Use when the user asks how to play a chord, what chord this is, what chords a song uses, wants chord diagrams for the site, or wants the 3D hands to strum. Backed by D:\sharvin1\Projects\Music\chords (library, detectors, strum model).
---

# Guitar chords

Standard tuning E A D G B e, 22 frets. All files are in `Music/chords/`; reference text in `CHORDS.md`. Frets are always listed low E to high e (`x` muted, `0` open).

## Which tool
- **"How do I play X?" / diagrams**: `python chords.py "Cmaj7"` or `chords.load()['chords']['Cmaj7']['shapes']`. Each shape has `kind` (`open`, `E-form`/`A-form`/`D-form` movable barre, `slash`, `alt`), `fingers`, `barre`. Prefer `curated: true` and `open` shapes for beginners; E-form/A-form for barre. For the site use the slim `chord_shapes.json`.
- **"What chord is this?" (notes known)**: `chordnamer.js` `nameChord(midi)` or `nameFromFrets(frets)`; Python `chords.name_pcs(pcs)`.
- **Chords in an audio file**: `python detect_audio.py song.wav --vocab triads|basic` (beat-synced, writes `[{t0,t1,chord,confidence}]`). For 7ths or real recordings use `python detect_btc.py song.wav` (BTC transformer, vendored, CPU). On synthetic strummed guitar: triads about 90-97% exact, 7ths about 40-55% (basic) vs 70-80% (BTC). Only for strummed chords; for single-note lines use the tab pipeline (guitar-tab-transcriber).
- **Chord from the fretting hand in video**: `detect_video.match_tips(tips_simple, target=None)` using handtrack's `(finger, string, fret)` tips; returns chord, confidence, `feedback` (what to move to reach the closest correct shape). Fretted notes only, so open-string shapes are ambiguous; do not claim certainty below 0.7 confidence.
- **Strumming**: `strum_patterns.json` (18 strum, 6 pick patterns with difficulty/songs) and `strum_model.js`: `strumTimeline(shape, pattern, bpm, {bars, patterns})` returns `[{t, dir, strings, offsets, velocity, muted, dur}]` for the 3D hand and synth. Down = low to high, 5-12 ms per string; up = top 4 strings.

## Rules
- Never invent a fingering that is not within a 4-fret span or needs over 4 fingers; use the library.
- A song transcribed as chords needs the chord chart plus a strumming pattern (see RESEARCH.md section 5 of anysong-research): choose a pattern from `strum_patterns.json` matching time signature and tempo.
- Capo: shapes shift up by the capo fret (sounding chord = shape + capo); report both.
- Regenerate the library with `python chords.py build` after changing the type table (about 30 s); it prints the verification of 40 hand-checked chords.
- Report detection accuracy honestly (synthetic numbers are optimistic; real recordings with vocals/drums are worse).
