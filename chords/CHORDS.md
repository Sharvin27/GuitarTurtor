# Guitar chords: reference + tooling

Standard tuning, strings low to high: **E A D G B e** (MIDI 40 45 50 55 59 64). Frets 0-22. Fret lists below are low E to high e; `x` = muted, `0` = open.

## How chords are built
A chord stacks intervals (semitones) on a root. Major scale degrees: 1 2 3 4 5 6 7. Major triad = 1-3-5 (0,4,7); minor flattens the 3rd (0,3,7). Add a 7th, 9th etc. for colour. Guitar chords often double notes and omit the 5th (and 9th/11th in extended chords); the root should usually be the lowest note.

| Type | Symbol | Semitones | Sound |
|---|---|---|---|
| major | C | 0 4 7 | bright |
| minor | Cm | 0 3 7 | sad |
| power | C5 | 0 7 | neutral, rock |
| 6 / m6 | C6 Cm6 | 0 4 7 9 / 0 3 7 9 | jazzy, sweet |
| dominant 7 | C7 | 0 4 7 10 | bluesy, wants to resolve |
| major 7 | Cmaj7 | 0 4 7 11 | dreamy |
| minor 7 | Cm7 | 0 3 7 10 | mellow |
| half-dim | Cm7b5 | 0 3 6 10 | tense (ii of minor) |
| dim / dim7 | Cdim Cdim7 | 0 3 6 / 0 3 6 9 | unstable |
| aug | Caug | 0 4 8 | floating |
| sus2 / sus4 / 7sus4 | Csus2 Csus4 C7sus4 | 0 2 7 / 0 5 7 / 0 5 7 10 | open, unresolved |
| add9 | Cadd9 | 0 2 4 7 | shimmering major |
| 9 / m9 / maj9 | C9 Cm9 Cmaj9 | 0 2 4 7 10 / 0 2 3 7 10 / 0 2 4 7 11 | rich |
| 11 / m11 | C11 Cm11 | 0 2 4 5 7 10 (3rd often omitted) | |
| 13 | C13 | 0 2 4 7 9 10 (5th/9th often omitted) | funk, jazz |
| 6/9 | C6/9 | 0 2 4 7 9 | lush |
| 7b9 / 7#9 | C7b9 C7#9 | 0 1 4 7 10 / 0 3 4 7 10 | dark / Hendrix |
| slash | C/G | chord over a different bass note | smooth bass lines |

## Reading chord diagrams
Vertical lines = strings (low E on the left), horizontal lines = frets, top thick line = nut. Dots = fingertips, numbers below = fingers (1 index, 2 middle, 3 ring, 4 pinky), `o` above = open string, `x` = don't play. A bar across several strings = **barre** (index flattened across the fret). `3fr` next to the diagram = the diagram starts at fret 3. In `chord_library.json` a shape is `frets` (6 values), `fingers` (6 values), `barre` ({fret, from, to}) and `kind`.

**Shape families (movable, CAGED):** *E-form* (root on low E, e.g. F = 133211), *A-form* (root on A, e.g. Bm = x24432), *D-form* (root on D, 4 strings), and the open C/G shapes. Barre an E-form at fret n and the root is the note at fret n on low E. Same for A-form on the A string.

## Strumming basics
- Count in eighth notes: **1 & 2 & 3 & 4 &**. The strumming hand keeps moving down on the numbers and up on the "&" like a pendulum, even when it skips a string contact. This is what makes patterns feel steady.
- Down hits all strings low to high (a few ms between strings, about 5-12 ms); up hits mostly the top 3-4 strings, lighter.
- The universal pop pattern is **D - D U - U D U** (`basic` in `strum_patterns.json`). Learn it by starting with all-down eighths, then keep the arm moving but skip the strokes that are rests in the pattern.
- **Palm mute**: rest the picking-hand heel on the strings near the bridge for a short, chunky tone (rock, punk). **Muted strum / chuck (x)**: release fretting pressure and strum for a percussive click (funk).
- Waltz is 3/4 (bass note then two light chords); 6/8 is two beats of three; shuffle/swing plays long-short triplet pairs; reggae hits only the offbeats ("&") short.
- Fingerpicking: thumb **p** on bass strings, **i m a** on G, B, e. Travis picking: thumb alternates two bass strings while fingers play melody.
- `strum_patterns.json` has 18 strum patterns (all above, plus folk, pop, ballad, funk16, bossa) and 6 pick patterns, each with difficulty and typical songs. `strum_model.js` turns shape + pattern + tempo into a timed stroke list for the 3D performer or synth (`node strum_model.test.mjs` to test).

## Common progressions (Roman numerals; major key)
I-V-vi-IV (C G Am F, the pop progression), I-IV-V (C F G, rock/folk), vi-IV-I-V (Am F C G), I-vi-IV-V (50s doo-wop), ii-V-I (Dm7 G7 Cmaj7, jazz), 12-bar blues I I I I IV IV I I V IV I V (all 7ths), i-bVII-bVI-V (Am G F E, flamenco/andalusian), I-V-vi-iii-IV-I-IV-V (Canon). Capo shifts every chord up so open shapes can be used in any key.

## The tooling (this folder)
| File | What |
|---|---|
| `chords.py` | generates `chord_library.json` (`python chords.py build`), lookup `load()`, `name_pcs()`, verification |
| `chord_library.json` | 492 chords (25 types x 12 roots + 192 slash chords), ~4,400 shapes, pitch-class index |
| `chord_shapes.json` | slim copy (open + movable shapes, <200 KB) for the site's chord diagrams |
| `chordnamer.js` | ES module: pitch classes / MIDI / fretted notes to chord names (for guitar3d `theory.js`) |
| `detect_audio.py` | chord recognition from audio (chroma + templates + Viterbi) |
| `detect_btc.py` | optional stronger recogniser (vendored BTC transformer, CPU) |
| `detect_video.py` | fingertip (string, fret) map to chord + feedback |
| `synth_eval.py` | synthetic audio accuracy test |
| `strum_patterns.json`, `strum_model.js`, `gen_strum.py` | strumming and picking patterns, timeline model |

### How detection works and its limits
- **Library search**: for each chord, every combination of per-string frets inside a 4-fret window (open strings allowed only low on the neck) that contains all required tones, has at most one interior muted string and needs at most 4 fingers (a barre counts as one) is scored: root in bass, number of strings, fingers, position, span. Hand-checked open shapes (40 well-known ones) are inserted first as `curated`.
- **Audio** (`detect_audio.py`): harmonic-separated CQT chroma, median per beat, cosine match with weighted chord templates (root stronger, penalty for extra tones), Viterbi smoothing. Works on strummed chords. It does not hear inversions, and 7ths/sus chords confuse with their triads (a Cmaj7 shares C-E-G with C). Lead lines, single notes, and heavy distortion give wrong chords. Use `--vocab triads` for pop songs.
- **BTC** (`detect_btc.py`): transformer trained on real songs, clearly better on 7ths; 170-chord vocabulary, no confidence value.
- **Video** (`detect_video.py`): sees only fretted fingertips, not open strings or muted strings, so Em vs a 2-finger alt shape is ambiguous; barres need the index fingertip visible. Feedback tells which string/fret to fix against the closest shape. Accuracy is best with 3+ visible fingers.
