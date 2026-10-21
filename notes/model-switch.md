# Switch to frame_mn10

Date: 2026-10-18. Edge 154, i5-1340P laptop.

## Hosting

- Hugging Face repo: https://huggingface.co/Abhinavbilla/frame-mn10-sed-onnx (public, MIT)
- Files: `frame_mn10.onnx` (14,850,718 bytes), `frame_mn10.onnx.gz` (13,475,534), `labels.json` (447 classes), `LICENSE` (upstream MIT), `README.md` (model card: input/output, changes, checks, credit; author list checked against arXiv)
- SHA-256 of the .onnx: `b81b1fe44bdffec6b39bfdae535cceb2164a14fc26acb788203b42b543598ab0`. Both downloads (plain, and .gz unpacked) match it, checked with curl and from the app's cross-origin-isolated page.
- The app loads the .gz, unpacks it with `DecompressionStream`, checks the SHA-256 before caching, and keeps it in the Cache API.

## What changed in the app

- `src/model/config.js`: Hugging Face URL, 16 kHz, 10 s windows with no overlap, 250 rows per window (40 ms), 447 labels (`audioset-strong-labels.json`)
- Scores: 1 byte each, log scale 1e-4 to 1 (`encodeScore` / `decodeScore`), about 40 MB per hour
- Scorer end-of-file rule fixed for non-overlapping windows (it would have skipped the last partial window)
- The fallback decoder and UI text use the model's sample rate instead of a hard-coded 32 kHz
- Device test benchmarks frame_mn10 (Hugging Face) and the old Cnn14 (local copy) for comparison

## Correctness

`tools/dump-scores.mjs` + `tools/verify_scores_framemn.py` (Python onnxruntime, same 10 s chunks, same 8-bit encoding):

| File | Rows (app / Python) | Stored values differing | Relative error, scores > 0.001 | Decisions changed at 0.02 |
|---|---|---|---|---|
| short5s.wav (5 s) | 125 / 125 | 0.13% (max 1 step) | median 0.91%, max 1.83% | 0.005% |
| odd23s.wav (23.7 s) | 593 / 593 | 0.15% (max 1 step) | median 0.90%, max 1.83% | 0.007% |
| mix0.wav (60 s) | 1500 / 1500 | 0.16% (max 1 step) | median 0.90%, max 1.83% | 0.011% |
| t10min.mp3 | 15000 / 15000 | 0.13% (max 1 step) | median 0.90%, max 1.83% | 0.011% |

End to end on the 24 TUT street recordings through the real app (headless, 92 min in 148 s, model 0.26 s/min):

| Sound | AP app / Python | Present-in-second F1 app / Python | Start within 1 s F1 app / Python |
|---|---|---|---|
| car | 0.58 / 0.58 | 0.65 / 0.65 | 0.08 / 0.09 |
| people walking | 0.71 / 0.71 | 0.65 / 0.66 | 0.13 / 0.13 |
| people speaking | 0.76 / 0.76 | 0.74 / 0.74 | 0.30 / 0.30 |
| large vehicle | 0.55 / 0.55 | 0.56 / 0.56 | 0.17 / 0.17 |
| brakes squeaking | 0.26 / 0.26 | 0.42 / 0.42 | 0.30 / 0.30 |
| children | 0.71 / 0.71 | 0.69 / 0.68 | 0.22 / 0.22 |
| **average** | **0.593 / 0.593** | **0.618 / 0.618** | **0.200 / 0.203** |

## Speed and memory (visible Edge window)

| File | Total | Model | Page memory peak |
|---|---|---|---|
| 10 min MP3 | 9.5 s | 0.21 s/min | 270 MB |
| 60 min MP3 | 40.0 s | 0.22 s/min | 463 MB |
| 3 h MP3 | 147.8 s | 0.31 s/min | 626 MB |

With Cnn14 these were 43 s, 238 s and 730 s, at about 700 MB flat. Memory now grows with length because 40 ms scores are kept (about 40 MB per hour, plus copies when the parts are joined).

Model loading (`tools/measure-cache.mjs`): first visit 3.9 s (download from Hugging Face + unpack + check + session), second visit 0.16 s from cache. Site storage 14 MB (was 96 MB).

## Not measured with the new model yet

- Phones (device test ready)

Stock Firefox, Chrome and background tabs were measured later (`more-checks.md`); 10 h files in `memory-fix.md`.
