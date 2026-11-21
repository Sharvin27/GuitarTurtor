# Learning videos with Higgsfield

How to turn the 3D hand animation into realistic lesson videos with a real-looking guitarist, without copying the original YouTube Shorts.

## Why the output was a copy of the original
Higgsfield's motion tools reproduce whatever you give them as the **reference video**. If the reference is the original Short, you get the Short back.

For lessons, use the **3D animation as the reference**, because it plays the exact tab finger by finger. Pair it with a **still photo of real hands** for the look. Never upload the original Short or frames from it.

## Workflow
1. **Record the 3D view** at https://sharvin27.github.io/GuitarTurtor/ with a screen recorder.
   - Choose a fixed camera view: **Player** (looking down at the neck, as you see your own hands) is best for learning, and **Close** is good for detail.
   - Keep **follow hand** on and crop off the control bars.
   - Record one section per clip. Motion transfer accepts 4–30 s references, and clips of about 10 s keep the fingers more accurate.
2. **Make a source image** of real hands from the same camera angle (Prompt 1).
3. In Higgsfield, go to **Video → Kling Motion Control**.
   - Upload the 3D clip as the **reference video** and the still as the **character/source image**.
   - Paste Prompt 2 and the negative prompt.
   - Set motion/reference strength to maximum and output to 1080p.
4. **Check every clip against the tab** (`tabs.html`). If a finger lands on the wrong fret or string, regenerate it or use a shorter reference clip.
5. **Edit:** add the tab, finger and fret labels, section titles and the audio in a video editor. AI video can't reliably draw text or numbers.

## Prompt 1: source image
### Choo Lo (acoustic, fingerpicked)
```
Photorealistic over-the-shoulder view looking down at a guitarist's hands on a natural-wood acoustic guitar. Left hand on the neck around the 8th to 12th fret, right hand resting near the soundhole ready to fingerpick. All six strings and the metal fret wires clearly visible, dot inlays at frets 3, 5, 7, 9 and the double dot at 12. Real human hands with natural skin texture, short trimmed nails, relaxed fingers. Soft even daylight, plain neutral background, sharp focus on the fretboard. No text, no logos, no face.
```

### Rabba Mein Toh Mar Gya (electric, pick)
```
Photorealistic over-the-shoulder view looking down at a guitarist's hands on a black electric guitar with a light maple fretboard. Left hand high on the neck near the body around the 12th to 19th fret, right hand holding a pick over the strings near the bridge pickup. All six strings and the metal fret wires clearly visible, dot inlays at frets 3, 5, 7, 9 and the double dot at 12. Real human hands with natural skin texture, short trimmed nails, relaxed fingers. Soft even daylight, plain neutral background, sharp focus on the fretboard. No text, no logos, no face.
```

## Prompt 2: motion control
```
Turn the reference animation into a realistic video of a real guitarist, for a guitar lesson. Copy the hand and finger motion from the reference exactly, frame by frame: which finger presses, which string and which fret, slides along the string, hammer-ons, bends, and every pluck of the picking hand. Keep the same camera angle and framing as the reference for the whole clip. Replace the 3D hands with the real human hands from the source image: natural skin, visible knuckles and tendons, fingertips pressing each string just behind the fret wire, fingers that aren't playing hover slightly above the strings. Real guitar detail: six strings, metal fret wires, dot inlays, strings vibrate when played. Locked-off camera, no zoom, no cuts. Soft even light, clean uncluttered teaching-video look, nothing covering the fretboard.
```

## Negative prompt
```
extra fingers, missing fingers, fused fingers, six fingers, warped or melting hands, wrong number of strings, frets merging, bent neck, blurry fretboard, camera shake, zoom, cuts, scene change, text, captions, numbers, logos, watermark, cartoon, 3D render look, plastic skin, face, original video
```

## Learning variants
| Clip | How to record the 3D view | Add to Prompt 2 |
|---|---|---|
| Slow practice | Speed 0.5× before recording | `slow, deliberate practice tempo, each note clearly placed` |
| Picking hand, Choo Lo | **Picking hand** view | `close-up of the picking hand fingerpicking with thumb, index, middle and ring fingers` (replaces the hand description) |
| Picking hand, Rabba | **Picking hand** view | `close-up of the picking hand alternate picking with a pick` (replaces the hand description) |
| One section | Scrub to the section and record only that part | Name the section in the edit, not in the prompt |

## Suggested sections
**Choo Lo** (`data/score-choo-lo.json`, 73 BPM)
- Intro, bars 1–4: G string 8h9 → 9/11 → 11/13 → 13/14 → 14/16 over open B and e
- Intro again, bars 5–8
- Part 2, bars 9–12: G string 9-8 followed by 2s, 4s, 6s and 8s

**Rabba** (`data/score-rabba.json`, about 178 BPM)
- Intro, bars 1–3: octave shapes (G + A string)
- Verse, bars 4–6 and 12–14: B string 12-10-12-10-12
- Hook, bars 7–11 and 15–19: high e 17-12-17, 19-17-19, 22 bent to 24, then 22-21-19-17-19-21
- Outro, bars 20–21

## Checklist for each clip
- [ ] The reference is the 3D recording, not the original Short.
- [ ] Same camera angle for the whole clip; no zoom or cuts.
- [ ] Five fingers per hand, six strings, frets straight.
- [ ] Every fretted note matches the tab: string, fret and timing.
- [ ] Text, tab and audio are added in the edit, not generated.

## Sources
- [Higgsfield: Kling Motion Control 3.0](https://higgsfield.ai/blog/kling-motion-control-3)
- [Higgsfield: How to edit videos with AI (motion transfer, 4–30 s reference)](https://higgsfield.ai/blog/how-to-edit-videos-with-ai)
- [Higgsfield: Genjutsu video-to-video](https://higgsfield.ai/blog/higgsfield-genjutsu)
- [Higgsfield: Kling 2.6 Motion Control guide](https://higgsfield.ai/blog/Kling-2.6-Motion-Control-Full-Guide)

Check current model names, clip limits and settings in the Higgsfield app; they change often.
