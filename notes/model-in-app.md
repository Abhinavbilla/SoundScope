# Model in the app

Date: 2026-10-18. Edge 154, Windows 11, i5-1340P, 15.6 GB RAM. Model: PANNs Cnn14_DecisionLevelMax int8, onnxruntime-web 1.30.0 (WASM, 4 threads) in the analysis worker. Served from a local `vite preview`, not Hugging Face.

## Correctness

`tools/dump-scores.mjs` saves the samples the app fed the model and the scores it produced. `tools/verify_scores.py` recomputes the scores in Python (onnxruntime, same model, same windowing as the model check).

| File | Length | Rows (app / Python) | Max diff | Mean diff | Decisions changed at 0.02 |
|---|---|---|---|---|---|
| short5s.wav | 5.0 s (shorter than one window) | 16 / 16 | 5.7e-4 | 3.2e-6 | 0% |
| odd23s.wav | 23.7 s | 75 / 75 | 4.6e-3 | 6.0e-6 | 0% |
| mix0.wav | 60 s | 188 / 188 | 4.6e-3 | 5.0e-6 | 0% |
| t10min.mp3 | 600 s | 1875 / 1875 | 2.1e-3 | 4.7e-6 | 0.0011% |

The max differences come from int8 rounding in the browser's WASM build vs Python's CPU build, plus Uint16 storage (1.5e-5 steps).

End to end: running the 4 synthetic test recordings from the model check through the real app gives the same results as the model check:

| Threshold | F1 within 1 s (app / model check) | F1 within 0.5 s (app / model check) |
|---|---|---|
| 0.01 | 1.00 / 1.00 | 0.688 / 0.688 |
| 0.02 | 0.968 / 0.968 | 0.71 / 0.71 |
| 0.05 | 0.951 / 0.951 | 0.885 / 0.885 |

These test recordings are synthetic and thresholds were tuned on them, so these F1 numbers are optimistic (see the spec).

## Speed

Visible Edge window, tab in front:

| File | Total | Model only | Per minute of audio | Per window (median / p90) |
|---|---|---|---|---|
| 10 min MP3 (2 runs) | 43.1, 43.8 s | 31.7, 32.5 s | 3.17, 3.25 s | 267–273 / 302–308 ms |
| 60 min MP3 | 238 s | 202 s | 3.37 s | 282 / 323 ms |
| 3 h MP3 | 730 s | 625 s | 3.47 s | 288 / 329 ms |

"Total" includes loading the model (about 7 s on a first visit) and decoding.

Other conditions, 10 min MP3:
- **Tab in the background** (another tab in front): 63.7 s total, 5.04 s per minute. It keeps running, but about 1.6× slower.
- **Headless Edge** (my first test setup): about 4.9 s per minute. My first measurements were made this way and looked slow. Headless isn't how people use the app.
- Model-check benchmark at the same time (main page, no decoding, warm-up excluded): 2.6–2.8 s per minute.

## Memory

Browser page peak private memory, measured by the OS:

| File | Peak | After |
|---|---|---|
| 10 min MP3 (headless run) | 674 MB | — |
| 60 min MP3 | 702 MB | 543 MB |
| 3 h MP3 | 657 MB | 632 MB |

About 450–500 MB of that is the model, the ONNX Runtime and its copy of the model file. Scores cost about 12 MB per hour (Uint16, 527 sounds every 0.32 s).

## Model caching

`tools/measure-cache.mjs`, same browser profile, page reloaded:
- First visit: downloaded, model ready in 6.9 s (local server)
- Second visit: from the Cache API, model ready in 0.36 s
- Site storage used: 96 MB

## Other checks

- Cancel during analysis returns to the file picker and stops the worker (`tools/check-cancel.mjs`).
- The progress text shows the model download ("first time only… x of 96 MB"), then "Listening for sounds… m:ss of h:mm:ss".

## Not measured

- Downloading from Hugging Face over a real network (the model isn't uploaded yet)
- Chrome, Firefox, Safari
- Slower or low-memory machines, and phones
- Real field recordings with labels (that's the evaluation step)
- The fallback path (whole-file decode, then scoring) beyond the 10 min speed check
