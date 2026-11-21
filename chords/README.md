# Chords and strumming

Chord library (492 chords, about 4,400 shapes), chord detection from audio and from fingertip positions, and strumming patterns with a timeline model the 3D hand can follow.

- `chord_library.json`, `chord_shapes.json` (slim copy for the site), `chords.py build` regenerates them.
- `detect_audio.py`: chroma template matching. `detect_btc.py`: wraps the BTC chord model, which you clone yourself (not included, 24 MB): `git clone https://github.com/jayg996/BTC-ISMIR19 chords/third_party/BTC` (MIT).
- `detect_video.py`: `match_tips(tips_simple)` maps fingertip (finger, string, fret) to a chord with closest-shape feedback.
- `strum_patterns.json` (18 strum + 6 fingerpicking patterns) and `strum_model.js` (`strumTimeline`, `pickTimeline`, `progressionTimeline`); test with `node strum_model.test.mjs`.
- `chordnamer.js`: pitch classes or frets to a chord name (low-E-first string order).
- `CHORDS.md`: learning reference. `SKILL.md`: draft Claude skill.

Accuracy (synthetic guitar, optimistic): triads 88–97% exact, 7th chords 42–54% with templates and 71–79% with BTC. No real-recording numbers yet.
