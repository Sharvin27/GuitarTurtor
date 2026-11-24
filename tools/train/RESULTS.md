# Audio -> tab: training / tuning results (Choo Lo + Locked Away)

Pipeline = basic-pitch -> skyline/merge -> beam-Viterbi string choice (`pipe.py`, a parametrised copy of pitch-model/transcribe.py). Audio only, no on-screen tab.
Score: fractions of reference notes (match <=80 ms); Locked Away notes with conf<0.7 or flags excluded (N=676 scored; Choo Lo N=174, until 38.7 s). Train = first 60% of each song, held-out = last 40%. "extra" = unmatched auto notes / N.
Not run: guitab chain (sweep_guitab etc.) - not needed for the conclusions below. Quantisation not tuned (scoring is on onset time, not grid).

## 1. Baseline (defaults) vs tuned params (17 params, Optuna TPE 150 trials, objective = mean(recall,pitch,exact) - 0.1*extra)
Format recall / pitch / string+fret exact.

| Split | Song | Baseline | Tuned |
|---|---|---|---|
| train (first 60%, tuned on both songs) | Choo Lo | .935 / .841 / .729 | .944 / .860 / .766 |
| train | Locked Away | .743 / .514 / .229 | .713 / .514 / .370 |
| **held-out (last 40%)** | Choo Lo | .940 / .478 / .388 | .910 / .478 / .328 |
| **held-out** | Locked Away | .778 / .534 / .280 | .753 / .509 / .283 |
| full song | Choo Lo | .937 / .701 / .598 | .931 / .713 / .598 |
| full song | Locked Away | .757 / .522 / .250 | .729 / .512 / .334 (partly train) |
| LOSO: tune on Choo Lo -> test Locked Away | Locked Away | .757 / .522 / .250 | .660 / .499 / .283 |
| LOSO: tune on Locked Away -> test Choo Lo | Choo Lo | .937 / .701 / .598 | .943 / .672 / .529 |

Held-out does not improve (exact: -0.06 Choo, +0.003 Locked; LOSO: +0.03 / -0.07; recall drops). Gains are on train only = overfit. **Defaults kept** in `best_params.json`; the tuned set is in `tuned_params_split60.json` for reference. (The existing "default" preset had already been tuned on Choo Lo.)
Biggest pipeline weakness is Locked Away: pitch 0.52 (distorted/band mix, 58% extra notes), not the params.

## 2. Learned string chooser (HistGradientBoosting per candidate string + beam decode; features = pitch, candidate string/fret, previous 3 notes' string/fret/pitch, dt, hand anchor)
Pretrain GuitarSet (players 00-03, 240 clips, 166k rows) ; "priority" = our songs weighted x10 / x25 in the same fit (the local venv's torch is broken; GBM weighting = the priority fine-tune; the notebook does a real two-stage torch version). GuitarSet test = player 05, 8 clips, string accuracy on true pitches.
Cells: string accuracy on true (reference) pitches / end-to-end exact (audio pitches + chooser).

| Model | Held-out last 40% Choo Lo | Held-out last 40% Locked | LOSO -> Choo Lo | LOSO -> Locked | GuitarSet test |
|---|---|---|---|---|---|
| Viterbi costs (default) | .866 / .388 | .401 / .280 | .868 / .598 | .392 / .250 | .429 |
| GuitarSet only | .149 / .090 | .649 / .251 | .155 / .178 | .666 / .294 | .688 |
| GuitarSet + our songs x10 | .149 / .090 | .892 / .348 | .155 / .178 | .675 / .312 | .694 |
| GuitarSet + our songs x25 | .149 / .090 | .871 / .319 | .155 / .178 | .661 / .308 | .698 |
| our songs only | .567 / .284 | .918 / .394 | .109 / .075 | .478 / .246 | .494 |

(our-songs-only reaches 1.00 on its own train = memorises.) Train oracle for GS+ours x25: .28 Choo / .95 Locked.
Reading: learned chooser beats Viterbi on Locked Away (string acc .40 -> .65-.92, e2e exact .28 -> .31-.39) and on GuitarSet (.43 -> .69), but collapses on Choo Lo (.87 -> .15): that song is an unusual G-string melody at frets 8-9 where "stay on the previous string" beats the usual low-fret prior, and 107 notes at x25 weight are not enough to teach it. The 2 songs have opposite string idioms, so one learned model does not fit both; Viterbi is the better *average* (held-out e2e exact mean .334 Viterbi vs .219-.341 learned, LOSO mean .424 vs .245-.255).
**Pick:** Viterbi default for general use. Best single learned candidate (GS + ours x10; saved `string_chooser_gbm.pkl`, trained on all data, sklearn pickle) is worth using only for band/chord-heavy material like Locked Away; a hybrid (learned log-prob + Viterbi hand-position/same-string costs, or per-song idiom flag) is the obvious next step.

## 3. Verdict
- Can generalise: onset detection (recall .94 Choo, .76 Locked, params barely matter), general string/fret priors from GuitarSet (+26 pts on its test split vs the hand costs).
- Cannot (with 2 songs): param tuning (train-only gains), a learned chooser that satisfies both songs, pitch accuracy on Locked Away (needs a better pitch model / stem separation, i.e. real fine-tuning with more audio+tab pairs: GAPS, SynthTab, GuitarSet audio, more of the user's lesson tabs). The GuitarSet mono-mic audio (656 MB) was downloaded to `data/guitarset/` but not used for pitch fine-tuning locally (CPU/4 GB GPU, torch broken in the venv); see notebook.
- Numbers are small-sample (Choo Lo held-out = 67 notes); differences of a few points are noise.

## Files
`pipe.py` (pipeline+scorer), `tune.py`, `chooser.py`, `exp_chooser.py`, `baseline.py`, results JSON (`tune_results.json`, `chooser_results.json`), `best_params.json`, `tuned_params_split60.json`, `string_chooser_gbm.pkl`, `package_data.py` (-> `out/GuitarTurtor_train.zip`, audio only with `--with-audio`), `colab_finetune.ipynb` (built by `mk_nb.py`), `.gitignore` (audio/data/work).
Data: GuitarSet (Xi et al., ISMIR 2018), Zenodo 3371780, CC BY 4.0 - attribution required. Our audio and GuitarSet stay local, never commit.
