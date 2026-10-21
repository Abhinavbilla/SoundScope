# Model comparison on real recordings

Date: 2026-10-18. Scripts: `model-check/compare_models.py`, `model-check/export_framemn.py`, `model-check/resolution_probe_framemn.py`.

## Candidates

| Model | Trained on | Output | Size (ONNX) |
|---|---|---|---|
| **cnn14_int8**: PANNs Cnn14_DecisionLevelMax, int8 (current) | AudioSet clip labels | 527 classes, one row every 0.32 s | 101 MB |
| **yamnet** | AudioSet clip labels | 521 classes, 0.96 s frames every 0.48 s | 16 MB |
| **frame_mn06** (PretrainedSED) | AudioSet *time-stamped* labels | 447 classes, one row every 40 ms | 6.7 MB |
| **frame_mn10** (PretrainedSED) | AudioSet *time-stamped* labels | 447 classes, one row every 40 ms | 14.9 MB |
| **beats_strong** (PretrainedSED, transformer) | AudioSet *time-stamped* labels | 447 classes, one row every 40 ms | 364 MB checkpoint (not exported) |

Every model gets the same post-processing (score per sound = max over the mapped classes; detections merged when less than 1 s apart). Each model and sound gets its own best threshold from a sweep of 0.001 to 0.7, so all models get the same "tuned on the test set" advantage. Segment AP needs no threshold at all.

## Real recordings: TUT Sound Events 2017 (24 street recordings, 92 min, labelled by people)

Licence: internal non-commercial / research use only (see `notes/remaining-measurements.md`).

| | car | walking | speaking | large vehicle | brakes | children | **average** |
|---|---|---|---|---|---|---|---|
| **Present-in-second AP** (threshold-free) | | | | | | | |
| cnn14_int8 | 0.61 | 0.58 | 0.71 | 0.35 | 0.17 | 0.53 | 0.491 |
| yamnet | 0.61 | 0.54 | 0.57 | 0.30 | 0.05 | 0.06 | 0.355 |
| frame_mn06 | 0.58 | 0.69 | 0.77 | 0.47 | 0.25 | 0.70 | 0.578 |
| frame_mn10 | 0.58 | 0.71 | 0.76 | 0.55 | 0.26 | 0.71 | **0.593** |
| beats_strong | 0.49 | 0.74 | 0.78 | 0.59 | 0.31 | 0.71 | **0.604** |
| **Present-in-second F1** (best threshold) | | | | | | | |
| cnn14_int8 | 0.70 | 0.54 | 0.67 | 0.40 | 0.22 | 0.40 | 0.488 |
| yamnet | 0.69 | 0.52 | 0.53 | 0.37 | 0.07 | 0.11 | 0.382 |
| frame_mn06 | 0.65 | 0.62 | 0.74 | 0.49 | 0.40 | 0.65 | 0.593 |
| frame_mn10 | 0.65 | 0.66 | 0.74 | 0.56 | 0.42 | 0.68 | **0.618** |
| beats_strong | 0.65 | 0.69 | 0.74 | 0.57 | 0.46 | 0.67 | **0.631** |
| **Start within 1 s F1** (best threshold) | | | | | | | |
| cnn14_int8 | 0.15 | 0.15 | 0.30 | 0.08 | 0.24 | 0.05 | 0.161 |
| yamnet | 0.14 | 0.12 | 0.22 | 0.07 | 0.07 | 0.04 | 0.112 |
| frame_mn06 | 0.10 | 0.13 | 0.31 | 0.11 | 0.28 | 0.17 | 0.183 |
| frame_mn10 | 0.09 | 0.13 | 0.30 | 0.17 | 0.30 | 0.22 | **0.203** |
| beats_strong | 0.13 | 0.13 | 0.34 | 0.11 | 0.39 | 0.24 | **0.224** |

(The earlier TUT numbers for Cnn14 were lower for footsteps and children because that sweep started at 0.01. This sweep starts at 0.001.)

## Synthetic mixes (ESC-50 sounds in real backgrounds, 32 events)

| | Present-in-second F1 | Start within 1 s F1 |
|---|---|---|
| cnn14_int8 | 0.896 | **1.000** |
| yamnet | 0.711 | 0.843 |
| frame_mn06 | 0.851 | 0.900 |
| frame_mn10 | 0.889 | 0.888 |
| beats_strong | **0.942** | 0.968 |

## Real time resolution (one short real sound slid in 40 ms steps, quiet background)

| Model | Detected start moves in steps of | Start error | 0.22 s bark shows up as |
|---|---|---|---|
| cnn14_int8 (earlier) | 0.32 s | 0.32–0.68 s early | ~0.96 s |
| frame_mn10 | 0.04 s (23 of 25 positions distinct) | 0.00–0.04 s early | ~0.28 s |
| frame_mn06 | 0.04 s | 0.00–0.04 s late | 0.12–0.20 s |

## In the browser

| Model | Matches Python (max diff) | Edge, 4 threads | Edge, 1 thread | Stock Firefox 157, 4 / 1 threads |
|---|---|---|---|---|
| cnn14_int8 | 4.6e-3 (earlier) | 2.9 s/min | 7.4 s/min (earlier) | 3.3–3.7 / 8.4–8.9 s/min |
| frame_mn10 | 3.1e-6 | **0.21 s/min** | 0.57 s/min | **0.23** / 0.75 s/min |
| frame_mn06 | 8.6e-7 | 0.13 s/min | — | — |
| yamnet | 3e-6 (earlier) | 0.3–0.4 s/min (earlier) | — | 0.32 s/min |

The ONNX export swaps `torch.stft` for an equivalent conv1d DFT. The front end matches to 2.8e-5 and the model output to 4e-7.

**Stock Firefox is fine.** The 10× slowdown seen earlier came from Playwright's modified Firefox build.

Python CPU speed (one process, just for comparison): cnn14_int8 2.20, yamnet 0.20, frame_mn06 0.22, frame_mn10 0.30, beats_strong 3.18 s per minute of audio.

## Conclusion

**frame_mn10** is the best fit for the browser: almost as accurate as the 364 MB transformer on real recordings (present-in-second AP 0.593 vs 0.604, and well above the current model's 0.491); real 40 ms timing instead of 0.32 s; 15 MB instead of 101 MB; about 14× faster. On the synthetic set the current model is better at start times, but the real recordings matter more.

## Things to sort out before switching

- **16 kHz input, 447 classes** (AudioSet's time-stamped label set), instead of 32 kHz and 527. Search by sound name still works (e.g. Dog and Bark are both in the set), but some AudioSet names are missing.
- **Score storage:** 447 classes × 25 rows per second × 2 bytes is about 80 MB per hour, versus 12 MB for Cnn14. Store a coarser copy for the timeline (e.g. max over 0.2 s, about 16 MB per hour), or 8-bit log-scaled scores.
- **Windows:** the authors run 10 s chunks with no overlap. Whether overlap helps at chunk edges hasn't been measured.
- **Licence:** the PretrainedSED repo (code and released checkpoints) is MIT. There's no separate licence statement for the weights; confirm with the author before commercial use. The labels come from AudioSet (CC BY 4.0, same open question as before).
- **Still synthetic + one public set:** my own labelled recordings remain the real test.
