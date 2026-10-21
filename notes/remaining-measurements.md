# Remaining measurements

Date: 2026-10-18. Same laptop as before (i5-1340P, Windows 11). App built with `vite build`, served by `vite preview`.

## 1. Real, human-labelled recordings (proxy for my own evaluation)

**Dataset:** TUT Sound Events 2017, development set: 24 real street recordings, 92 min, 44.1 kHz stereo, labelled by people (and partly verified by three more listeners). **Licence:** "internal and non-commercial use and … scientific research" only, and explicitly not "in connection with the creation of commercial products". It's kept in `model-check/` (ignored by git). If SoundScope becomes commercial, these results shouldn't be relied on and the data should be deleted.

**Pipeline:** the same as the app (verified identical earlier): mono, 32 kHz, Cnn14 int8, 10.24 s windows / 5.12 s step, detections merged when less than 1 s apart. Thresholds were **not** tuned on this set; I report a sweep instead. Script: `model-check/eval_tut.py`.

AudioSet classes used per sound: car = Car / Car passing by / Motor vehicle (road) / Vehicle; people walking = Walk, footsteps; people speaking = Speech / Conversation; large vehicle = Truck / Bus; brakes squeaking = Squeal / Tire squeal / Air brake; children = Children shouting / Child speech / Children playing.

Labelled events (as given / merged when less than 1 s apart): car 304/140, people walking 130/116, people speaking 117/109, large vehicle 61/37, brakes squeaking 59/54, children 58/38.

### Event F1 (the spec's rule: start within 1 s), labels merged

| Sound | 0.01 | 0.02 | 0.03 | 0.05 | 0.1 | 0.2 | 0.3 | 0.5 |
|---|---|---|---|---|---|---|---|---|
| car | 0.15 | 0.12 | 0.11 | 0.13 | 0.12 | 0.11 | 0.07 | 0.00 |
| people walking | 0.01 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| people speaking | 0.28 | 0.30 | 0.28 | 0.28 | 0.26 | 0.21 | 0.19 | 0.12 |
| large vehicle | 0.04 | 0.03 | 0.03 | 0.02 | 0.08 | 0.00 | 0.00 | 0.00 |
| brakes squeaking | 0.24 | 0.16 | 0.06 | 0.03 | 0.00 | 0.00 | 0.00 | 0.00 |
| children | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| **average** | 0.12 | 0.10 | 0.08 | 0.08 | 0.08 | 0.05 | 0.04 | 0.02 |

With labels as given (not merged), the average is 0.15 at 0.01, and the best single sound is people speaking at 0.31.

### Segment F1 (is the sound present in this 1 s segment?)

| Sound | 0.01 | 0.02 | 0.03 | 0.05 | 0.1 | 0.2 | 0.3 | 0.5 |
|---|---|---|---|---|---|---|---|---|
| car | 0.69 | 0.70 | 0.70 | 0.68 | 0.59 | 0.35 | 0.16 | 0.02 |
| people walking | 0.06 | 0.02 | 0.01 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| people speaking | 0.66 | 0.70 | 0.68 | 0.66 | 0.62 | 0.57 | 0.53 | 0.37 |
| large vehicle | 0.38 | 0.33 | 0.25 | 0.12 | 0.04 | 0.01 | 0.00 | 0.00 |
| brakes squeaking | 0.22 | 0.16 | 0.12 | 0.10 | 0.01 | 0.00 | 0.00 | 0.00 |
| children | 0.19 | 0.12 | 0.10 | 0.09 | 0.04 | 0.01 | 0.00 | 0.00 |
| **average** | 0.37 | 0.34 | 0.31 | 0.27 | 0.22 | 0.16 | 0.11 | 0.06 |

### Why: at threshold 0.02

| Sound | Event P / R | Segment P / R | Labels (median length) | Detections (median length) | Found within 3 s, median start error |
|---|---|---|---|---|---|
| car | 0.10 / 0.14 | 0.58 / 0.88 | 140 (10.7 s) | 196 (5.6 s) | 39, 1.00 s |
| people walking | 0.00 / 0.00 | 1.00 / 0.01 | 116 (4.3 s) | 4 (1.1 s) | 0 |
| people speaking | 0.26 / 0.35 | 0.79 / 0.62 | 109 (3.3 s) | 145 (1.9 s) | 56, 0.59 s |
| large vehicle | 0.02 / 0.08 | 0.43 / 0.26 | 37 (17.8 s) | 181 (1.3 s) | 9, 1.73 s |
| brakes squeaking | 0.30 / 0.11 | 0.36 / 0.10 | 54 (1.1 s) | 20 (1.0 s) | 6, 0.16 s |
| children | 0.00 / 0.00 | 1.00 / 0.06 | 38 (1.8 s) | 10 (1.3 s) | 0 |

Peak score inside labelled events vs score where the sound isn't labelled:

| Sound | Inside events: p10 / median / p90 | Outside: median / p90 / p99 |
|---|---|---|
| car | 0.081 / 0.218 / 0.414 | 0.013 / 0.175 / 0.402 |
| people walking | 0.000 / 0.002 / 0.007 | 0.0004 / 0.001 / 0.003 |
| people speaking | 0.003 / 0.091 / 0.668 | 0.003 / 0.006 / 0.117 |
| large vehicle | 0.009 / 0.039 / 0.087 | 0.001 / 0.011 / 0.045 |
| brakes squeaking | 0.001 / 0.003 / 0.028 | 0.0003 / 0.003 / 0.010 |
| children | 0.000 / 0.000 / 0.029 | 0.000 / 0.000 / 0.000 |

What this says:
- **"Start within 1 s" is far worse on real recordings than on the synthetic set** (average event F1 about 0.1 vs 0.95–1.00). Long, gradual sounds (cars, trucks) get split into several detections, and their starts are fuzzy.
- **Presence in a given second works for loud, common sounds** (car and speech segment F1 0.70) and badly for quiet or rare ones (walking 0.06, children 0.19).
- **A single threshold range doesn't fit all sounds.** Walking peaks around 0.002 (separable from the 0.0004 background, but far below 0.01). Car scores reach 0.175 in about 10% of seconds with no car label (some may be unlabelled background traffic; not checked).
- For children, the model barely responds at all in these recordings.

## 2. Browsers

All runs in a visible window, 10 min files (and the 1 min mix0.wav), model with 4 threads.

| Browser | MP3 | M4A | AAC | FLAC | OGG | WAV | Damaged file | Model speed | Page memory peak |
|---|---|---|---|---|---|---|---|---|---|
| Edge 154 | ok | ok | ok | ok | ok | ok | clear message | 3.2–3.7 s/min | 695–707 MB |
| Chrome (installed) | ok | ok | ok | ok | ok | ok | clear message | 3.2–3.6 s/min | 664–757 MB |
| Firefox 142 (Playwright build) | ok | ok | ok | ok | ok | ok | clear message | **30.8–37.7 s/min** | 635–700 MB |
| WebKit (Playwright, Windows) | message | message | message | message | message | ok | clear message | 4.2 s/min (WAV) | not measured |

Edge also handled a 60 min M4A (254.9 s total, 695 MB peak).

**Firefox:** about 10× slower for every model (bench page: Cnn14 int8 27.6–30.4 s/min with 4 threads, 83–85 s/min with 1 thread; YAMNet 2.9 s/min; Cnn14 fp32 44 s/min. Edge numbers: about 2.7, 7.4, 0.3–0.4 and 3.7 s/min). Threads do help, so the slowness is in the WebAssembly itself. This is Playwright's modified Firefox build; **stock Firefox not tested**. At this speed, 1 hour of audio would take about 35 minutes.

**WebKit on Windows is not Safari.** It has no WebCodecs audio decoder and almost no codecs here, so only WAV works. Real Safari uses Apple's system codecs. **Safari not tested** (needs a Mac).

## 3. Slower machines

Edge, 10 min MP3, fewer model threads to mimic smaller CPUs:

| Threads | Total | Model speed |
|---|---|---|
| 4 (default) | 43–44 s | 3.2 s/min |
| 2 | 57.3 s | 4.7 s/min |
| 1 | 90.1 s | 8.0 s/min (about 9 min per hour of audio) |

Chromium's CPU throttling (`Emulation.setCPUThrottlingRate` ×4) made **no difference** (mix0: 10.6 s vs 10.0 s). It evidently doesn't slow worker threads, so it's not a valid way to emulate a slow machine here. Phones and low-memory machines: **not tested**.

## 4. Downloading from Hugging Face

From the app's own page (cross-origin isolated), a public 104 MB ONNX file (`Xenova/whisper-base`, `decoder_model_fp16.onnx`), using the same fetch + Cache API steps as the app:

| | Result |
|---|---|
| Allowed under the page's isolation headers | yes |
| First visit | 104 MB in 11.3 s (73.7 Mbit/s on this connection), first byte after 2.0 s |
| Second visit | 80 ms, from cache |
| Compression | **none**: Hugging Face sent no content-encoding |

So users would download about 101 MB, not the 57 MB gzipped size. At 10 Mbit/s that's about 81 s (calculated, not measured). Option: host `cnn14_sed_int8.onnx.gz` and unpack it with `DecompressionStream`. Our own model upload: **not done** (needs my account).

## Still not measured

- My own labelled recordings (the evaluation step; needs my labels)
- Stock Firefox and real Safari
- Phones, low-memory machines
- Our model actually hosted on Hugging Face

## 5. Stock Firefox, all six formats (added 2026-10-18)

Installed Firefox (auto-updated to 158 during testing), driven by Puppeteer over WebDriver BiDi (`tools/measure-firefox.mjs`). The page was cross-origin isolated and had the WebCodecs audio decoder. Current model (Cnn14 int8), 4 threads.

| File | Result | Total | Model speed | Page memory peak |
|---|---|---|---|---|
| damaged.mp3 | clear "couldn't be decoded" message | 0.6 s | — | — |
| mix0.wav (1 min) | ok (stream) | 11.7 s | 3.44 s/min | 585 MB |
| t10min.mp3 | ok (stream) | 64.4 s | 4.84 s/min | 1,052 MB |
| t10min.m4a | ok (stream) | 86.0 s | 5.95 s/min | 872 MB |
| t10min.aac | ok (stream) | 71.5 s | 4.24 s/min | 886 MB |
| t10min.flac | ok (stream) | 70.8 s | 4.97 s/min | 879 MB |
| t10min.ogg | ok (stream) | 75.9 s | 4.32 s/min | 889 MB |
| t60min.wav (659 MB) | ok (stream) | 427 s | 6.41 s/min | 960 MB |

All six formats work. Compared with Edge, Firefox ran the full pipeline about 1.3–2× slower (Edge: 3.2–3.7 s/min) and its page used more memory (about 900 MB vs 700 MB). Memory stayed flat for 60 min. The model alone was close to Edge in the benchmark (3.3–3.7 s/min), so the extra time is probably decoding or worker overhead in Firefox (not measured further).

## 6. Phones

**Layout** (Chromium device emulation: screen size, touch and pixel ratio only, not a real phone's CPU, memory or codecs): Pixel 7 (412 px), iPhone 14 (390 px), Galaxy S9+ (320 px). No sideways scrolling; all states fit (empty, downloading, result). On phones, "or drop it here" is irrelevant, and the 96 MB model download is heavy on mobile data.

**Real phones: not measured yet.** No phone is connected to this machine. `device-test.html` (served by `vite preview --host`) checks capabilities, decodes a 20 s clip in each format, times both models, and runs an optional 20-minute full pipeline. Results show on screen and are appended to `test-audio/device-results.jsonl`. Checked end to end on desktop Edge with Pixel 7 emulation.

Over plain `http://<laptop-ip>` a phone is **not** in a secure context, so it would have no WebCodecs, no multi-threading and no Cache API. That isn't how the real (HTTPS) app will run. For realistic results the phone needs either `http://localhost` through USB (Android: `adb reverse`) or HTTPS.
