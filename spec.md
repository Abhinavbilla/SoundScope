# SoundScope

Upload a long audio or video recording, pick a sound (dog bark, rain, applause...), and jump straight to the moments where it likely happens. Everything runs in the browser, so the audio never leaves the user's device.

## Why

Finding a specific sound in a long recording means scrubbing through it by hand. Speech transcripts don't help with non-speech sounds. I want to make recordings searchable by what you can hear.

## Who it's for

Mainly people who edit or review long recordings (creators, field recordists). One use case first: open a file, see what's in it, find a sound, check it, save it.

## What it does (v1)

1. Upload an audio or video file and show its waveform and duration. For a video, only its sound track is read (the default track if there are several), and the video is shown in a player that the waveform controls.
2. Run a pretrained sound-detection model in the browser (no training, no backend).
3. Turn the model's output into time intervals per sound, with a confidence score.
4. Show a list of the sounds found in the file, plus search by sound name. Searching "dog" also matches related sounds like bark, howl and growl, using the AudioSet ontology.
5. Show the intervals on a timeline. Many sounds can happen at the same time, so the timeline has one row per sound or a filter. Clicking an interval plays it from 2 seconds before.
6. A sensitivity slider to get fewer or more detections. It never runs the model again (see "Saved scores" below). Its range is set for the chosen model (see "Sensitivity" below).
7. Bookmark moments and export them:
   - CSV with columns: start, end, label, confidence, note.
   - WAV clips with a little padding around each one. One file per clip, no zip in v1.
8. Show progress, errors and unsupported-file states properly. Long runs have a cancel button, and results show up as each chunk finishes.

## What it doesn't do

- Train or fine-tune a model.
- Search by free text ("a door slamming then a car starting").
- Speech transcription.
- Upload audio anywhere. No analytics and no third-party scripts.
- Claim exact timestamps. Everything is an estimated interval.
- Work offline (no service worker for now).

## How it works

File -> read and decode it piece by piece, mono, resample to 16 kHz -> run the model on 10 s windows -> join the scores into one timeline -> pick intervals above a threshold and merge ones that are close -> UI.

For video files the same path reads only the sound track; video frames are never decoded or kept. The whole file is never decoded at once. Each piece of audio is dropped once it's been used, and only the scores and waveform peaks are kept. That keeps memory flat for any file length. Playback streams from the file through the browser's audio player, and exported clips decode only the few seconds they need.

### Time resolution

The model gives one score every 40 ms. With frame_mn10 that was its real resolution: a short real sound slid in 40 ms steps was located within 0.04 s. The current model has the same 40 ms rows; the slide test wasn't repeated for it, but its starts are closer on every dataset except BirdVox (the PANNs model before frame_mn10 only had 0.32 s steps and started 0.3–0.7 s early). On real street recordings, starts of long, gradual sounds are still fuzzy, so every interval is still an estimate. The 2 seconds of playback before an event stays. No timestamp shifting is needed for the new model.

### Saved scores

After the analysis, the scores for every moment in the audio are saved. The threshold, merging and minimum-length steps run again from those saved scores, so moving the slider is instant.

The scores are saved at the model's own step (40 ms) as one byte per score on a log scale from 0.0001 to 1 (each step about 3.7%, so thresholds down to 0.001 still work). That's about 40 MB per hour for all 447 sounds, so they don't stay in page memory. The worker writes them to the browser's private file storage (OPFS) as it goes. The page keeps only a 1-second overview and each sound's highest score, and reads a sound's full 40 ms timeline from storage when it's needed (3 h file: 16–36 ms). Page memory stays at about 400 MB from 1 h to 10 h. Results are kept after the tab closes: reopening the same file (same name, size and date) takes about 0.02 s. The least recently used results are deleted when storage runs low. Without OPFS, or with storage full (also when it fills up during analysis), the app falls back to 1-second detail and says so. Firefox private windows have no OPFS; Chrome Incognito and Edge InPrivate keep results for the session.

### Post-processing settings

Starting values, to be tuned during the evaluation:

| Setting | Start value |
|---|---|
| Window length | 10 s |
| Step between windows | 5 s |
| Combining overlapping windows | Hann crossfade (a window's edges count least) |
| Merge detections closer than | 1 s |
| Minimum event length | 0.12 s (0.5 s dropped single barks; see `notes/search.md`) |
| Playback before the event | 2 s |
| Padding around exported clips | 1 s |

The window and step are multiples of 40 ms so they line up with the model's output rows. Without overlap, scores jumped at every 10 s window edge and intervals snapped to those edges. Overlapping windows with a crossfade removed the jumps and were slightly more accurate on the street recordings (AP 0.590 → 0.602, F1 0.616 → 0.625), at twice the model time. Details are in `notes/timeline.md`.

### Sensitivity

On real recordings (TUT street set) one fixed range doesn't fit all sounds: useful thresholds ranged from about 0.001 to 0.5 depending on the sound. The slider works on a log scale from 0.001 to 0.5 and starts at 0.05. There's one slider for all sounds for now; per-sound thresholds may come later. The best thresholds for the current model still need checking on my own recordings.

## Tech

- React + Vite + JavaScript
- ONNX Runtime Web (WASM backend) running **EfficientSED fmn10 + transformer** (checkpoint `fmn10+tf-256_advanced-kd-weak-strong`, 22.09 MB, 19.20 MB as .gz), hosted on Hugging Face at `Abhinavbilla/efficientsed-fmn10-tf256-onnx`. The app downloads the .gz, unpacks it in the browser, checks its SHA-256, and keeps it in the Cache API. Input 16 kHz mono in fixed 10 s windows, output 447 AudioSet classes every 40 ms. (Earlier models: frame_mn10, still on Hugging Face at `Abhinavbilla/frame-mn10-sed-onnx`; PANNs Cnn14 int8, kept only as a comparison in the device test.)
- Model loading stays simple and in one place (model URL, sample rate, window, step, labels), so the model can be swapped later.
- WaveSurfer.js for the waveform, drawn from precomputed peaks (20 per second) so it never decodes the file itself.
- Saved results (scores, overview, peaks) live in OPFS (`src/store/scoreStore.js`), found by a hash of file name, size, last modified time and model id. IndexedDB is for bookmarks.
- Decoding and inference both run in a Web Worker. The worker reads the file itself in small pieces using Mediabunny (MPL-2.0), which decodes through the browser's WebCodecs, plus a small streaming resampler to the model's rate (16 kHz). For MP3 it trims the encoder delay the same way the browser does.
- Fallback: if the streaming path can't read a file (unknown format, or no WebCodecs), the browser's whole-file decoder runs on the main thread. That path needs about 60 MB of memory per minute of stereo audio, so it only works for shorter files (see "Decoding tests").

## File formats

Audio: WAV, MP3, M4A, AAC, FLAC and OGG. Video: MP4, MOV, WebM, MKV and MPEG-TS (sound in AAC, Opus, MP3, Vorbis, FLAC or PCM). AVI and WMV aren't supported (they get a clear message). Videos never use the whole-file fallback, because it would load the whole video into memory. Browser support differs, especially on Safari. A file the browser can't decode gets a clear message, not a silent failure. If a file fails only because it's too long for the fallback path, the message says that instead of calling the file damaged.

Tested: all six formats work in Edge and Chrome, and decode in Firefox. Stock Firefox 158: all six work, including a 60 min WAV (7.1 min, about 960 MB page memory, about 1.3–2× slower than Edge). Playwright's WebKit on Windows only decodes WAV and shows the message for the rest, but that isn't Safari. Real Safari is not tested yet.

## Licenses

- **EfficientSED (current model):** MIT (theMoro/EfficientSED, copyright (c) 2024 Florian Schmid). The Hugging Face copy includes the licence and credits the paper: Morocutti, Schmid, Greif, Foscarin, Widmer, "Exploring Performance-Complexity Trade-Offs in Sound Event Detection Models", EUSIPCO 2025. The app's credits say the same.
- **frame_mn10 (previous model):** MIT (PretrainedSED, copyright (c) 2024 Florian Schmid). The Hugging Face copy includes the licence and credits the paper: Schmid, Morocutti, Foscarin, Schlüter, Primus, Widmer, "Effective Pre-Training of Audio Transformers for Sound Event Detection", ICASSP 2025. The app's About page should say the same.
- **PANNs weights (previous model):** CC BY 4.0 (Zenodo, DOI 10.5281/zenodo.3987831). Hosting a converted and compressed copy is allowed, including for commercial use, as long as I give credit, link the license, and say what I changed. The model card on Hugging Face and the app's About page should say: "PANNs Cnn14_DecisionLevelMax by Qiuqiang Kong, Yin Cao, Turab Iqbal, Yuxuan Wang, Wenwu Wang and Mark D. Plumbley (Zenodo, DOI 10.5281/zenodo.3987831), licensed CC BY 4.0. Converted to ONNX and quantized to int8 by me." Also cite the paper: Kong et al., "PANNs: Large-Scale Pretrained Audio Neural Networks for Audio Pattern Recognition", IEEE/ACM TASLP 2020.
- **PANNs code:** MIT. I only use it to convert the model, not in the app.
- **YAMNet:** Apache 2.0.
- **AudioSet:** the models were trained on AudioSet (YouTube audio). The label data is CC BY 4.0, but the audio belongs to the YouTube uploaders. It's an open question whether that affects the weights. This isn't legal advice; check before any commercial launch.
- **AudioSet ontology:** CC BY-SA 4.0 (Google). `src/model/sound-tree.json` is derived from it (trimmed, plus my own parents for 31 newer sounds), so it's CC BY-SA 4.0 too. The About page should credit it.
- **Evaluation datasets** (kept in `model-check/datasets/`, ignored by git): STARSS23 (MIT), Powdermill (CC0), DCASE 2021 few-shot development set (CC BY 4.0), BirdVox-full-night (CC BY 4.0) and URBAN-SED (CC BY 4.0). All allow commercial use. Credit them if results are published.
- **ESC-50:** CC BY-NC, for local testing only. It's in `.gitignore` and must never be committed or published.
- **TUT Sound Events 2017:** internal non-commercial / research use only, and not "in connection with the creation of commercial products". Used only as a local check, kept in `model-check/` (ignored by git). If SoundScope becomes commercial, drop these results and delete the data.
- **Mediabunny:** MPL-2.0. Its files are not modified. `src/vendor/` subclasses its MP3, ADTS and FLAC demuxers (our own code) to store the frame index compactly. If I ever change its files directly, those changed files must stay open under MPL-2.0. Credit it on the About page.
- **Long test recordings:** Radio Aporee field recordings on the Internet Archive, public domain mark. Kept local in `test-audio/` (ignored by git).

## Things I already know are tricky

- The model download is 19.2 MB (first visit: ready in 5.3 s from Hugging Face, headless Edge on my connection; with frame_mn10 it was 13.5 MB and 3.9 s). Loading from the cache on later visits isn't measured for the new model yet (frame_mn10: 0.16 s).
- Detections will be wrong sometimes. The UI should make it easy to listen and verify.
- Speed with the current model: about 1.37× slower than frame_mn10 (84-minute regression pack in Edge: 64 s of model time against 47 s). The full-length timings below are for frame_mn10 and haven't been re-measured.
- Speed with frame_mn10 and overlapping windows (Edge, tab visible): 10 min in 11–12 s, 1 h in 57 s, 3 h in 184 s. The model takes about 0.42–0.45 s per minute of audio (it was 0.21 without overlap: 1 h in 40 s). Background tabs are about 1.5× slower (1 h: 62.7 s vs 41.5 s).
- Memory: page peak 275 MB (10 min), 415 MB (1 h and 3 h), 481 MB (10 h). It plateaus at about 400 MB with a slight rise (about 7 MB per hour of audio) from Mediabunny's frame index and the browser's decoder. Details are in `notes/memory-fix.md`.
- Browsers without WebCodecs (older Safari and Firefox) fall back to whole-file decoding, which only works for shorter files.
- Firefox: stock Firefox runs frame_mn10 at about the same speed as Edge (0.23 s/min). The 10× slowdown I saw earlier came from Playwright's modified Firefox build. Not re-measured for the current model.
- Slower machines: frame_mn10 on 1 thread takes 0.57 s per minute of audio in Edge (0.75 in Firefox). Not re-measured for the current model.
- Not measured yet:
  - my own labelled recordings (the evaluation step)
  - real Safari (needs a Mac)
  - real phones: the layout is fine at 320–412 px (emulated), and a self-test page (`device-test.html`) is ready to run on a real phone
  - low-memory machines
  - slow disks and network drives
- Firefox and Chrome with frame_mn10: all six audio formats and the videos work, results are saved and reopen. Details are in `notes/more-checks.md`.

## Decoding tests (done)

Real field recordings, cut or joined to exact lengths, in Edge on my laptop. Memory is the browser page's peak private memory, measured by the OS. Full numbers are in `notes/decoding.md`.

| File | Streaming (current) | Whole-file decode (old way, now fallback) |
|---|---|---|
| 10 min MP3 | 3.2 s, 125 MB | 1.3 s, 555 MB |
| 30 min MP3 | 9.9 s, 148 MB | 3.5 s, 1.6 GB |
| 60 min MP3 | 17–36 s, 223–230 MB | 13.9 s, 3.65 GB (failed earlier when the machine had less free memory) |
| 60 min WAV (659 MB) | 17.7 s, 119 MB | hung for over 15 min |
| 2 h MP3 | 78–80 s, 225–236 MB | failed (out of memory) |
| 2 h WAV (1.3 GB) | 47.8 s, 174 MB | not tried |
| 3 h MP3 | 119 s, 235 MB | not tried |

**Maximum file length:** on the streaming path there isn't a fixed limit. Memory stayed under 240 MB from 10 minutes to 3 hours. The limit is time instead (a few minutes per hour with the model). I tested up to 3 hours. Longer files should behave the same, but that isn't measured. On the fallback path, files can fail above about 45 minutes, depending on free memory.

Streamed audio matches the browser's own decoder: the same length, no time offset, and 35–46 dB SNR (the difference comes from the resampler). Running the model on both versions changed fewer than 0.03% of decisions at a threshold of 0.02.

## Model in the app (done, with the previous Cnn14 model)

These numbers are from before the switch to frame_mn10 (see "Model switch" above for the current ones). The worker ran 10.24 s windows with a 5.12 s step as the audio streams in, averages overlapping rows, and sends score rows (Uint16, 527 sounds every 0.32 s) to the page as soon as they're final. Full numbers are in `notes/model-in-app.md`.

| File | Total time (tab visible) | Page memory peak |
|---|---|---|
| 10 min MP3 | 43–44 s | — |
| 60 min MP3 | 238 s (~4 min) | 702 MB |
| 3 h MP3 | 730 s (~12 min) | 657 MB |

- The app's scores match a Python reference on the same audio (mean difference about 5e-6; at most 0.001% of decisions differ at 0.02). That holds for files shorter than one window and for lengths that aren't a multiple of the step.
- Running the 4 synthetic test recordings through the real app gives exactly the model check's F1 at thresholds 0.01, 0.02 and 0.05.
- Model load: 6.9 s the first time (from a local server), 0.36 s after that (from cache).

## UI redesign (done)

- Dark and light themes, a landing page with a big drop area (or drop anywhere), progress with time left, and a workspace with search, sensitivity, a player whose waveform shows the selected sound's moments, timeline lanes on the same time axis, play controls with keyboard shortcuts, Moments/Bookmarks tabs and colour-coded sound categories.
- Normal users don't see raw scores (a Maybe/Likely/Very likely meter instead), threshold values, sample rates, processing times or generic background labels (those are behind "Also show background noises" and still searchable).
- Fonts and icons are bundled, so the page still makes no third-party requests. Credits are in the footer. Details are in `notes/ui.md`.
- Second pass (2026-10-20): a quieter, tool-like look. Neutral surfaces, one solid blue for the playhead and progress, no gradients or glow. The timeline has sound names in a left column, like an editor. Videos sit next to the moments list, with the timeline below. The landing page shows a small example timeline and three steps.
- Click or drag anywhere on the waveform or a sound's lane to play from that point (the picture follows for videos). Clicking a moment in the list still plays from 2 s before it. Checked with `tools/check-seek.mjs` on an audio file and a video; the timeline, controls and bookmark checks still pass.
- Plain wording (2026-10-20): every label, hint and error message was rewritten for people who aren't technical. The sensitivity slider is now "Show: Clear only … Also faint". Errors say what to do next and never show codec names or error codes. About 190 AudioSet names that read like research terms get everyday names in `src/results/names.js` ("Female speech, woman speaking" → "Woman speaking", "Mains hum" → "Electrical hum"). Search matches both the everyday and the original names.

## Bookmarks and export (done)

- ☆ next to a moment bookmarks it; "Bookmark this point" marks a spot by hand. Bookmarks have notes, are kept per file in IndexedDB and come back when the file is reopened.
- Export ("Download list" and "Download all clips"): a CSV for Excel (Start, End, Sound, Note, Start (seconds), End (seconds), Score (0 to 1)) and WAV clips with 1 s of padding, at the file's own sample rate, one file per clip. Chrome and Edge can save all clips into a folder you pick; Firefox downloads them one by one.
- Clips decode only the seconds they need. They line up with ffmpeg's decode of the same file within 0.5 ms (MP3, FLAC, Ogg, AAC, WebM). Ogg Vorbis is read from the start, because seeking in it was 3–23 ms off. A clip from the end of a 10 h MP3 takes about 6 s; from M4A about 0.1 s anywhere.
- Tested in Edge and Firefox, at phone width and in dark mode. Details are in `notes/bookmarks.md`.
- Notes (2026-10-21):
  - **Search:** the search bar finds notes, with the same typo rules as sound names ("ckae" → cake, "neigbor" → neighbour's). Bookmarks whose note has all the typed words (any case, any order) are listed above the sounds, exact matches first, 3 at first; a click plays from 2 s before. When no note matches, search looks as before. A word found in a note isn't turned into a sound-name guess ("mama" stays "mama").
  - **Clip names:** a clip's file name includes its note, shortened to 5 words and 40 characters (`party-Laughter-Riya-laughing-at-the-cake-1-15.2.wav`). Without a note, the name is unchanged.
  - **Delete:** each bookmark has a visible delete (bin) button. It used to be an invisible ✕ that showed only on hover, so a click on empty-looking space deleted the bookmark. After a delete, "Undo" brings it back with its note.
  - Checked with `tools/check-note-search.mjs` at desktop and phone width.

## Search (done)

- Typing "dog" finds Dog and everything under it in the AudioSet ontology (Bark, Howl, Growling, Whimper, Pant…). Each query word can match the sound's name or a group above it, so "door knock" finds Knock.
- Sounds heard in the file come first. A match can go on the timeline by itself, or all matches as one combined row whose moments say which sound was strongest.
- 31 newer AudioSet sounds aren't in the ontology; I placed them by hand (e.g. Pant (dog) under Dog).
- On the labelled synthetic mixes, "dog", "knock", "glass" and "clap" found 31 of 32 events with 1 extra moment (only shows it works end to end). Tested in Edge and Firefox, during analysis and at phone width. Descriptions aren't searched, so "woof" finds nothing. Details are in `notes/search.md`.
- Typos (2026-10-21): when nothing matches, each unknown word is corrected and the search runs again, with "Showing results for “animal”" above the results (click it to put it in the box). It handles up to 2 left-out letters ("anmal" → animal, "footstps" → footsteps), 1 wrong, extra or swapped letter (2 for 7+ letters: "dgo" → dog, "sirne" → siren, "vehical" → vehicle), and split words ("foot steps" → footsteps). If the first guess finds nothing, the next likeliest is tried ("dor knok" → door knock). Words under 3 letters aren't guessed. Checked in `tools/test-search.mjs` and in the browser with `tools/check-search-typos.mjs`.

## Intervals and timeline (done)

- A list of the sounds found, most heard first, with how long each is heard. Tick a sound to add it to the timeline.
- One timeline row per chosen sound. Until you pick, it shows the 3 most heard sounds that come and go (sounds heard through more than 80% of the file are skipped for the default).
- The selected row's moments are listed with start, end and confidence. Clicking a moment, or an interval on the timeline, plays from 2 s before (the video too). A line follows playback.
- The sensitivity slider recomputes everything from the saved scores: 4–11 ms on 10 min, 25 ms on 3 h.
- While the analysis runs, results fill in at 1-second detail; afterwards the timeline uses the full 40 ms detail.
- Tested in Edge, Chrome and Firefox, at phone width and in dark mode. Not done: per-sound thresholds and zooming the timeline. Details are in `notes/timeline.md`.

## Video files (done)

The sound track of MP4, MOV, WebM, MKV and MPEG-TS videos goes through the same streaming path. A 2 h 1080p MP4 (2.7 GB) took 85.6 s with a flat 416 MB page peak, about the same as the same 2 h as MP3 (87.7 s, 354 MB). The whole file is read from disk (sound and picture are interleaved), which cost no extra time on my laptop. Results are byte-identical to the same AAC/Opus stream as an audio file. Known differences:
- **AC-3 / E-AC-3 / DTS:** Edge on Windows decodes AC-3 and E-AC-3. Chrome and Firefox show "This video's sound format (AC-3 (Dolby Digital)) can't be decoded in this browser" (same for E-AC-3). DTS gets that message in all three.
- **AVI / WMV:** "This video format can't be opened. Supported video formats: MP4, MOV, WebM, MKV and MPEG-TS."
- **Big videos:** 10 min 4K (1.4 GB) took 11 s with a 538 MB page peak; a 10 h video took 6.5 min, 430–520 MB during analysis and 686 MB at the end when the player loads it.
- Reading only the sound's byte ranges didn't read less (the reads merge) and was twice as slow on 4K, so it isn't used.
- **No sound track:** "This video has no sound track."
- **MPEG-TS (and raw .aac):** starts 23 ms early because AAC encoder padding isn't recorded (less than one 40 ms row).

The video plays in a player above the waveform; clicking the waveform seeks the video. Details are in `notes/video.md`.

## Flat memory for long files (done)

Full-resolution scores go to OPFS instead of page memory, and Mediabunny's per-frame index is stored compactly. Page memory before → after: 1 h 463 → 415 MB, 3 h 626 → 415 MB, 10 h ~750 → 481 MB. Stored scores are byte-identical to before, and decoded audio is byte-identical with and without the index fix in all compressed formats. Details are in `notes/memory-fix.md`.

## Model switch to EfficientSED (done, 2026-10-20)

The app now uses EfficientSED fmn10 + transformer instead of frame_mn10. Why: see "Model comparison" below (more accurate on 4 of 5 datasets, fewer wrong moments, about 1.37× slower).
- Uploaded to Hugging Face (`Abhinavbilla/efficientsed-fmn10-tf256-onnx`, public, MIT, with model card and credits). The app loads the .gz from there and checks the hash (`src/model/config.js`, model id `efficientsed-fmn10-tf256-hann5s`). Results saved with frame_mn10 aren't reused, because the id changed.
- Checked in the real app: it downloads the model from Hugging Face (5.3 s), the hash matches, and the tricycle video gives the same result as the earlier test run.
- Since 2026-10-21 the app loads the model from its own site (`/models/efficientsed_fmn10_tf256.onnx.gz`), not from Hugging Face; see "Deployment". The Hugging Face copy stays up for anyone else.
- New regression baseline saved (the old one is kept as `regression/baseline_frame_mn10.json`). The app and Python agree on 0.014–0.037% of decisions (8 kHz file: 5.6%).
- All dataset numbers below are re-done for the new model. The Python copy of the pipeline (`common.py`) now runs the new model by default; `SS_MODEL=frame_mn10` runs the old one. The old numbers are in `model-check/ref/spec_before_switch.md` and in the `ref/` files without a model suffix.

## Model switch to frame_mn10 (done)

Uploaded to Hugging Face (`Abhinavbilla/frame-mn10-sed-onnx`, public, MIT, with model card and credits) and loaded by the app from there.

- The app's scores match Python on the same audio for all lengths (5 s, 23.7 s, 60 s, 10 min): row counts identical, stored scores within one 8-bit step (median 0.9% relative), about 0.01% of decisions differ at 0.02.
- All 24 TUT street recordings run through the real app give the same results as the Python comparison: present-in-second AP 0.593 (Python 0.593), F1 0.618 (0.618), start within 1 s 0.200 (0.203). 92 minutes took 148 s.
- Speed and memory are in "Things I already know are tricky". Full numbers are in `notes/model-switch.md`.

## Model check (done)

I compared the frame-by-frame PANNs model (full size and int8), small PANNs (MobileNetV1) and YAMNet on timestamp precision, file size and speed. The browser output matched the Python output for all of them. Details are in `model-check/NOTES.md` (local only).

**The results are provisional.** The test recordings were synthetic (real ESC-50 sounds mixed into real backgrounds at known times, 4 × 60 s, 32 events), and the thresholds were tuned on the same events. So the detection scores are optimistic, and the model choice holds only until I test on real recordings I label myself.

Key numbers for the chosen model (int8): F1 1.00 at the 1 s tolerance on the synthetic set (0.69 at 0.5 s), about 3 s to process one minute of audio in Edge (WASM, 4 threads). The compressed small PANNs model gave broken output, and WebGPU doesn't speed up the int8 model.

### First check on real recordings (TUT Sound Events 2017, 24 street recordings, 92 min)

Thresholds not tuned on this set. Details are in `notes/remaining-measurements.md`.

| Sound | Event F1, start within 1 s (best threshold) | "Present in this second" F1 (best threshold) |
|---|---|---|
| car | 0.15 | 0.70 |
| people speaking | 0.30 | 0.70 |
| large vehicle | 0.08 | 0.38 |
| brakes squeaking | 0.24 | 0.22 |
| children | 0.00 | 0.19 |
| people walking | 0.01 | 0.06 |

This is much worse than the synthetic set. Long sounds like cars get split up and have fuzzy starts. Quiet or rare sounds (footsteps, children) barely register. **The model choice is now in real doubt**, and "start within 1 s" may be the wrong main measure for long sounds. "Present in this second" fits "jump to the moments" better.

### Model comparison on the same real recordings

Details are in `notes/model-comparison.md`. Every model got its own best threshold per sound; AP needs no threshold.

| Model | Size | Present-in-second AP | Present-in-second F1 | Start within 1 s F1 | Speed in Edge |
|---|---|---|---|---|---|
| PANNs Cnn14 int8 (current) | 101 MB | 0.49 | 0.49 | 0.16 | 2.9 s/min |
| YAMNet | 16 MB | 0.36 | 0.38 | 0.11 | 0.3 s/min |
| **frame_mn10** (PretrainedSED) | **15 MB** | **0.59** | **0.62** | **0.20** | **0.21 s/min** |
| frame_mn06 (PretrainedSED) | 7 MB | 0.58 | 0.59 | 0.18 | 0.13 s/min |
| BEATs strong (reference only) | 364 MB | 0.60 | 0.63 | 0.22 | not run |

frame_mn10 was trained on AudioSet's time-stamped labels. It outputs a real score every 40 ms, and its starts were within 0.04 s in the sliding-sound test (Cnn14: 0.32 s steps, 0.3–0.7 s early). It's close to the big transformer, clearly ahead of the current model, a seventh of the size, and about 14× faster in the browser. **Recommendation: switch to frame_mn10** (not done yet). It would change: 16 kHz input, 447 classes instead of 527, 40 ms rows, and score storage (about 80 MB per hour at full rate, so store a coarser copy for the timeline).

"Start within 1 s" stays low for every model (0.11–0.22) on the real street recordings, so "present in this second" should be the main measure, with start time reported as a second number.

## Accuracy on public datasets (done)

Five labelled public datasets, scored one by one: 91.5 hours of audio in total. None of them was used to choose or tune the model's weights. All use the app's default sensitivity (0.05). These are the numbers for the current model (EfficientSED). The frame_mn10 numbers are in "Model comparison" below.

| Dataset | Kind | Audio | "Present in this second" P / R / F1 / accuracy | "Start within 1 s" P / R / F1 |
|---|---|---|---|---|
| 1. STARSS23 | real rooms, 13 everyday sounds | 7.4 h | 0.63 / 0.83 / **0.72** / 0.93 | 0.60 / 0.57 / **0.58** |
| 2. Powdermill | real dawn chorus (any bird, crow) | 6.4 h | 0.88 / 0.98 / **0.93** / 0.92 | 0.66 / 0.11 / **0.19** |
| 3. DCASE few-shot | wild animals (birds, hyenas, meerkats) | 9.4 h | 0.21 / 0.67 / **0.32** / 0.79 | 0.43 / 0.32 / **0.37** |
| 4. BirdVox-full-night | faint bird calls in 10 h nights | 62.8 h | 0.37 / 0.77 / **0.50** / 0.81 | 0.53 / 0.26 / **0.35** |
| 5. URBAN-SED | synthetic street scenes, 10 sounds | 5.6 h | 0.68 / 0.36 / **0.47** / 0.89 | 0.65 / 0.33 / **0.43** |

(Micro totals over each dataset's classes. Per-class tables are below.)

Main takeaways:
- **Clear, distinct sounds work well:** speech, clapping, laughter, sirens, car horns, dog barks, birds, crows (F1 about 0.6–0.9 per second).
- **Short quiet sounds are weak:** doors, knocks, bells, footsteps (0.35–0.42).
- **Steady background machines are almost never found at the default sensitivity:** fans, boilers, air conditioners, drills, jackhammers, engines. A much lower sensitivity would find many of them, so they'd need per-sound sensitivity.
- **Speech and music are over-detected at the default.** A stricter per-sound sensitivity would help them. Tuning the sensitivity per sound (the "best F1 if tuned" column) would lift the average F1 by +0.01 (Powdermill, DCASE), +0.06 (STARSS23), +0.11 (BirdVox) and +0.17 (URBAN-SED).
- **Wildlife at species level is outside what the model knows.**
- **"Present in this second" is the more useful measure.** Start times are close only for short, separate sounds.
- **Speed and memory held up** (measured with frame_mn10): 60+ hours were scored at 0.2–0.3 s of model time per minute of audio, with flat memory. The current model is about 1.3× slower in Python (25 ms against 19 ms per 10 s window).

### How it was measured

- **Same model and settings as the app.** EfficientSED fmn10 + transformer, 10 s windows every 5 s with the crossfade, scores rounded to the app's 1-byte scale, and the app's interval rules: score at or above the sensitivity, gaps under 1 s joined, shorter than 0.12 s dropped. The scoring code is a Python copy of the app's pipeline (`model-check/eval_datasets/common.py`). On the regression pack it matches the app's own saved scores, with 0.014–0.037% of decisions different (the two use slightly different resamplers; 5.6% on an 8 kHz file, see "Regression pack").
- **Sensitivity:** the app's default, 0.05, for the main numbers. The last column shows the best F1 if the sensitivity were tuned for each sound on this same data. That's optimistic, but it shows how much a per-sound setting could help.
- **Mapping:** each dataset class is matched to the model's own sounds, and a class's score is the highest of its sounds. Example: "Telephone" covers Ringtone, Telephone bell ringing, and so on.
- **"Present in this second"** (the main measure): every second of audio is one yes/no decision per class. It counts as detected if the score passes the sensitivity anywhere in that second (the same 1-second view the app uses for "Sounds found"), and as labelled if a labelled event touches it. From the counts of true positives (TP), false alarms (FP), misses (FN) and true negatives (TN):
  - **Precision** = TP / (TP + FP): of the seconds the app marked, how many really had the sound.
  - **Recall** = TP / (TP + FN): of the seconds that had the sound, how many the app found.
  - **F1** combines precision and recall into one number.
  - **Accuracy** = (TP + TN) / all seconds. Most seconds don't contain a given sound, so accuracy is high even for a weak detector (a detector that never says "yes" would still score 0.95+ on rare sounds). It's reported because it was asked for, but F1 is the honest number.
- **"Start within 1 s"** (second measure): labelled events (joined when under 1 s apart) are matched to the app's detected intervals when the start times are within 1 s. This gives precision, recall and F1. There's no accuracy here, because "no event" can't be counted.
- **Micro** totals add up the counts over all classes, so common sounds weigh more. **Macro** is the plain average of the per-class F1, so every sound weighs the same.

### 1. STARSS23 (Sony + Tampere University), real rooms

- **What:** real multichannel recordings of people in rooms in Tampere and Tokyo, with 13 classes labelled by people in 100 ms frames. Licence MIT. Only the development set has labels: 168 recordings, 7.4 hours, 4-channel 24 kHz, mixed to mono as the app does. Zenodo record 7880637.
- **Mapping notes:** "Domestic sounds" = vacuum cleaner, boiling water and fans (from the dataset's README). The model knows "Music" but no individual instruments, so "Music" and "Musical instrument" both use the model's "Music" detector, and they can't be told apart.

| Sound | Labelled events | Seconds with it | Precision | Recall | F1 | Accuracy | Start within 1 s: P / R / F1 | Best F1 if tuned (second / start) |
|---|---|---|---|---|---|---|---|---|
| Female speech | 1607 | 8474 | 0.78 | 0.96 | 0.86 | 0.90 | 0.68 / 0.54 / 0.61 | 0.90 @ 0.2 / 0.73 @ 0.2 |
| Male speech | 2161 | 10388 | 0.81 | 0.97 | 0.88 | 0.90 | 0.76 / 0.64 / 0.70 | 0.91 @ 0.2 / 0.79 @ 0.2 |
| Clapping | 62 | 183 | 0.83 | 0.87 | 0.85 | 1.00 | 0.78 / 0.85 / 0.82 | 0.88 @ 0.1 / 0.90 @ 0.1 |
| Telephone | 50 | 276 | 0.88 | 0.39 | 0.54 | 0.99 | 0.67 / 0.40 / 0.50 | 0.56 @ 0.03 / 0.51 @ 0.1 |
| Laughter | 530 | 1240 | 0.68 | 0.70 | 0.69 | 0.97 | 0.71 / 0.63 / 0.67 | 0.69 @ 0.05 / 0.67 @ 0.05 |
| Domestic sounds | 82 | 4460 | 0.95 | 0.17 | 0.29 | 0.86 | 0.15 / 0.16 / 0.16 | 0.70 @ 0.01 / 0.24 @ 0.02 |
| Walk, footsteps | 181 | 929 | 0.39 | 0.45 | 0.42 | 0.96 | 0.18 / 0.28 / 0.22 | 0.42 @ 0.05 / 0.24 @ 0.1 |
| Door, open or close | 98 | 236 | 0.33 | 0.36 | 0.35 | 0.99 | 0.33 / 0.40 / 0.36 | 0.35 @ 0.05 / 0.36 @ 0.05 |
| Music | 74 | 6302 | 0.64 | 0.98 | 0.77 | 0.86 | 0.14 / 0.45 / 0.21 | 0.80 @ 0.2 / 0.43 @ 0.2 |
| Musical instrument | 107 | 2501 | 0.24 | 0.95 | 0.39 | 0.72 | 0.09 / 0.20 / 0.12 | 0.51 @ 0.5 / 0.29 @ 0.3 |
| Water tap, faucet | 33 | 382 | 0.96 | 0.40 | 0.57 | 0.99 | 0.74 / 0.42 / 0.54 | 0.66 @ 0.002 / 0.58 @ 0.01 |
| Bell | 69 | 323 | 0.32 | 0.63 | 0.42 | 0.98 | 0.30 / 0.38 / 0.34 | 0.42 @ 0.05 / 0.37 @ 0.02 |
| Knock | 22 | 36 | 0.23 | 0.72 | 0.35 | 1.00 | 0.26 / 0.73 / 0.39 | 0.37 @ 0.1 / 0.39 @ 0.05 |
| **All (micro)** | | | **0.63** | **0.83** | **0.72** | **0.93** | **0.60 / 0.57 / 0.58** | macro 0.63 / 0.50 |
| Macro F1 (mean over sounds) | | | | | 0.57 | | 0.43 | |

Totals, "present in this second": TP 29,569, FP 17,326, FN 6,161, TN 292,653. "Start within 1 s": TP 2,883, FP 1,922, FN 2,193.

What this says:
- **People sounds work well:** speech (F1 0.86–0.88, recall 0.96+), clapping (0.85, and 0.82 on start times) and laughter (0.69).
- **Speech is still a bit over-detected:** recall is very high, precision 0.78–0.81. Raising the sensitivity to 0.2 would lift speech to 0.90–0.91.
- **Weak:** doors, bells, knocks and footsteps (F1 0.35–0.42). These are short, quiet sounds in reverberant rooms, often under speech. Knocks are found (recall 0.72) but with many false alarms.
- **Quiet steady sounds are missed** at the default: domestic sounds (fans, boilers) have recall 0.17 and water taps 0.40. A much lower sensitivity (0.002–0.01) would lift them to F1 0.66–0.70.
- **Instruments can't be scored fairly**, because the model only has "Music".

### 2. Powdermill bird soundscapes (Chronister et al. 2021), real dawn chorus

- **What:** 77 five-minute recordings (385 min, 44.1 kHz mono) of the dawn chorus at Powdermill Nature Reserve, Pennsylvania. 16,052 bird sounds boxed in time and frequency by three annotators and named to species (48 species). Licence CC0 (public domain). Zenodo record 4656848.
- **Classes:** the model doesn't know North American species, so two classes are scored:
  - **Bird (any):** every annotation, against all the model's bird sounds.
  - **American crow:** species code AMCR, 534 annotations, against the model's "Crow" and "Caw".
- **Caveats:**
  - Short "chip" calls weren't annotated, so if the model hears them they count as false alarms.
  - Birds are singing in 84% of all seconds, which makes "Bird (any)" an easy target for the per-second measure.
  - "Labelled events" in the table counts calls joined when under 1 s apart (16,052 calls become 2,588 stretches).

| Sound | Labelled events | Seconds with it | Precision | Recall | F1 | Accuracy | Start within 1 s: P / R / F1 | Best F1 if tuned (second / start) |
|---|---|---|---|---|---|---|---|---|
| Bird (any) | 2588 | 19347 | 0.87 | 1.00 | 0.93 | 0.88 | 0.80 / 0.06 / 0.11 | 0.95 @ 0.3 / 0.67 @ 0.3 |
| American crow | 374 | 4574 | 0.93 | 0.92 | 0.93 | 0.97 | 0.57 / 0.46 / 0.51 | 0.93 @ 0.05 / 0.51 @ 0.05 |
| **All (micro)** | | | **0.88** | **0.98** | **0.93** | **0.92** | **0.66 / 0.11 / 0.19** | macro 0.94 / 0.59 |
| Macro F1 (mean over sounds) | | | | | 0.93 | | 0.31 | |

Totals, "present in this second": TP 23,553, FP 3,156, FN 368, TN 19,123. "Start within 1 s": TP 329, FP 168, FN 2,633.

What this says:
- **Finding the birds works very well** (F1 0.93), and so does **finding the crow** among 47 other species (F1 0.93, precision 0.93).
- **Start times are poor for "any bird"** (recall 0.06). The chorus is nearly continuous, so the app joins it into a few long stretches and most individual song starts aren't separate detections. A stricter sensitivity (0.3) splits the chorus and lifts start F1 to 0.67. For a sound that's everywhere, "present in this second" is the meaningful measure.
- Crow start times are moderate (F1 0.51).

### 3. DCASE 2021 few-shot bioacoustics, wild animals

- **What:** long recordings of wild animals from several research groups, with each call's start and end marked. Development set, CC BY 4.0, Zenodo record 5412896.
- **Scored:** 14 files, 9.4 hours: jackdaw (JD, 10 min), blackbird and song thrush (PB, 3 h), spotted hyena (HT 3 h, HV 2 h), meerkat (MT, 76 min). The BV subset is left out, because it comes from the same BirdVox recorders as dataset 4.
- **Classes:** the model has no hyena or meerkat sounds, so calls are scored at the level it knows:
  - **Bird call** (jackdaw, blackbird, thrush) against all the model's bird sounds.
  - **Mammal call** (hyena, meerkat) against all its non-bird animal sounds.
- **How it was scored:**
  - Calls the annotators marked "unknown" are ignored, as in the DCASE challenge.
  - Each file has only its own animal labelled, so each class is scored only on its own files.
  - Other animals the model hears in a file still count as false alarms.
- **Note:** the hyena recordings (HT) are sampled at only 6 kHz, so they have no sound above 3 kHz.

| Sound | Labelled events | Seconds with it | Precision | Recall | F1 | Accuracy | Start within 1 s: P / R / F1 | Best F1 if tuned (second / start) |
|---|---|---|---|---|---|---|---|---|
| Bird call | 238 | 361 | 0.48 | 0.33 | 0.39 | 0.97 | 0.54 / 0.28 / 0.37 | 0.42 @ 0.03 / 0.37 @ 0.05 |
| Mammal call | 1239 | 2117 | 0.20 | 0.73 | 0.31 | 0.69 | 0.42 / 0.33 / 0.37 | 0.31 @ 0.05 / 0.37 @ 0.05 |
| **All (micro)** | | | **0.21** | **0.67** | **0.32** | **0.79** | **0.43 / 0.32 / 0.37** | macro 0.36 / 0.37 |
| Macro F1 (mean over sounds) | | | | | 0.35 | | 0.37 | |

Per animal ("present in this second" unless noted):

| Subset | Labelled events | Precision | Recall | F1 | Accuracy | Start-within-1 s F1 |
|---|---|---|---|---|---|---|
| Jackdaw (JD) | 39 | 0.64 | 0.21 | 0.32 | 0.82 | 0.29 |
| Blackbird, song thrush (PB) | 199 | 0.45 | 0.39 | 0.42 | 0.98 | 0.38 |
| Hyena (HT) | 226 | 0.14 | 0.52 | 0.23 | 0.77 | 0.21 |
| Hyena (HV) | 44 | 0.04 | 0.88 | 0.08 | 0.66 | 0.18 |
| Meerkat (MT) | 969 | 0.39 | 0.82 | 0.53 | 0.58 | 0.47 |

Totals, "present in this second": TP 1,658, FP 6,325, FN 820, TN 24,772. "Start within 1 s": TP 479, FP 623, FN 998.

What this says:
- **This is the hardest set, as expected.** These are expert wildlife recordings of species and call types the model was never taught, so they're scored only as "bird" or "mammal".
- **Birds are found with moderate precision** (jackdaw 0.64, blackbird and thrush 0.45) **but low recall** (0.21–0.39): many calls are quiet or distant. Jackdaw got worse than with frame_mn10 (0.43 → 0.32), but it's only 39 calls.
- **Mammal calls trigger the detector often, but so does a lot else.** Hyena precision is 0.04–0.14: the broad "any animal" detector fires on other sounds in those recordings (wind, other animals, vehicles), which aren't labelled. Meerkat start times improved most (0.29 → 0.47).
- SoundScope isn't a wildlife tool. For species-level work, a specialised bioacoustics model would be needed.

### 4. BirdVox-full-night, 10-hour night recordings

- **What:** 6 night recordings (62.8 hours in total, 24 kHz mono) from autonomous recorders near Ithaca, NY, in autumn 2015. An expert marked 35,402 bird flight calls as single points in time. CC BY 4.0, Zenodo record 1205569.
- **How it was scored:**
  - Flight calls are tiny (about 50–150 ms) and usually faint, so each call is scored as a 100 ms event centred on its marked time.
  - Class: **Bird (any)**, against all the model's bird sounds.
  - Calls under 1 s apart are joined, so 35,402 calls become 20,397 events.
- **Long-file test** (frame_mn10): each 10.9 h night was read piece by piece and scored in 2.3–3.9 min. That's 0.28 s of model time per minute of audio, with flat memory.

| Sound | Labelled events | Seconds with it | Precision | Recall | F1 | Accuracy | Start within 1 s: P / R / F1 | Best F1 if tuned (second / start) |
|---|---|---|---|---|---|---|---|---|
| Bird (any) | 20397 | 28286 | 0.37 | 0.77 | 0.50 | 0.81 | 0.53 / 0.26 / 0.35 | 0.61 @ 0.1 / 0.54 @ 0.1 |
| **All (micro)** | | | **0.37** | **0.77** | **0.50** | **0.81** | **0.53 / 0.26 / 0.35** | macro 0.61 / 0.54 |

Totals, "present in this second": TP 21,919, FP 37,163, FN 6,367, TN 160,632. "Start within 1 s": TP 5,242, FP 4,672, FN 15,155.

What this says:
- **Better than expected for such faint, short calls:** 77% of the seconds with a flight call were found.
- **Many false alarms (precision 0.37).** The likely cause is other night sounds the model labels as bird or "Chirp, tweet", such as insects, which are loud in autumn nights. I haven't checked which model sounds cause them.
- **This is the one dataset where the current model is worse than frame_mn10** (0.52 → 0.50 per second, 0.40 → 0.35 on start times).
- A stricter sensitivity (0.1) improves the balance (F1 0.61 per second, 0.54 on start times).

### 5. URBAN-SED, synthetic street scenes

- **What:** 10 s street soundscapes mixed by computer (Scaper) from UrbanSound8K clips (Freesound), so the labels are exact. Test split only: 2,000 soundscapes, 5.6 hours, 10 classes, about 8,400 events. CC BY 4.0, Zenodo record 1324404.
- **Mapping notes:**
  - Car horn = Vehicle horn plus Air horn.
  - Engine idling = Idling plus the Engine sounds.
  - Dog bark, gunshot and siren include everything under them in the ontology.
  - Street music = Music.
- The archive also contains 2,000 tiny macOS metadata files (`._name.wav`), which were skipped.

| Sound | Labelled events | Seconds with it | Precision | Recall | F1 | Accuracy | Start within 1 s: P / R / F1 | Best F1 if tuned (second / start) |
|---|---|---|---|---|---|---|---|---|
| Air conditioner | 812 | 2685 | 0.00 | 0.00 | 0.00 | 0.87 | 0.00 / 0.00 / 0.00 | 0.35 @ 0.001 / 0.24 @ 0.001 |
| Car horn | 902 | 2144 | 0.74 | 0.66 | 0.70 | 0.94 | 0.76 / 0.63 / 0.69 | 0.70 @ 0.05 / 0.69 @ 0.05 |
| Children playing | 835 | 2870 | 0.88 | 0.35 | 0.51 | 0.90 | 0.67 / 0.33 / 0.44 | 0.65 @ 0.005 / 0.53 @ 0.01 |
| Dog bark | 851 | 2605 | 0.88 | 0.47 | 0.62 | 0.92 | 0.78 / 0.47 / 0.59 | 0.64 @ 0.02 / 0.59 @ 0.05 |
| Drilling | 865 | 2775 | 0.89 | 0.11 | 0.20 | 0.87 | 0.78 / 0.10 / 0.18 | 0.54 @ 0.002 / 0.45 @ 0.001 |
| Engine idling | 831 | 2849 | 0.49 | 0.12 | 0.19 | 0.86 | 0.38 / 0.07 / 0.12 | 0.45 @ 0.01 / 0.29 @ 0.01 |
| Gunshot | 872 | 2264 | 0.63 | 0.39 | 0.48 | 0.91 | 0.68 / 0.49 / 0.57 | 0.54 @ 0.02 / 0.61 @ 0.02 |
| Jackhammer | 805 | 2674 | 0.83 | 0.08 | 0.15 | 0.88 | 0.67 / 0.06 / 0.11 | 0.62 @ 0.001 / 0.52 @ 0.001 |
| Siren | 823 | 2800 | 0.76 | 0.65 | 0.70 | 0.92 | 0.70 / 0.50 / 0.59 | 0.70 @ 0.05 / 0.62 @ 0.1 |
| Street music | 809 | 2742 | 0.52 | 0.83 | 0.64 | 0.87 | 0.46 / 0.56 / 0.51 | 0.70 @ 0.2 / 0.60 @ 0.2 |
| **All (micro)** | | | **0.68** | **0.36** | **0.47** | **0.89** | **0.65 / 0.33 / 0.43** | macro 0.59 / 0.51 |
| Macro F1 (mean over sounds) | | | | | 0.42 | | 0.38 | |

Totals, "present in this second": TP 9,521, FP 4,440, FN 16,887, TN 169,232. "Start within 1 s": TP 2,742, FP 1,488, FN 5,663.

What this says:
- **Distinct, sharp sounds work:** siren (0.70), car horn (0.70), music (0.64), dog bark (0.62) and gunshot (0.48, with 0.57 on start times).
- **Steady machine noise is almost never found at the default sensitivity:**
  - air conditioner 0.00, jackhammer 0.15, engine 0.19, drilling 0.20
  - When they are found, precision is high (0.83–0.89 for drilling and jackhammer).
  - At a much lower sensitivity (0.001–0.002), drilling and jackhammer reach 0.54–0.62.
  - This is the same pattern as fans and boilers in STARSS23: the model gives steady noises low scores.
- **Scores are capped by the source clips:** many UrbanSound8K clips are quiet or low quality, and the soundscapes mix several sounds over background noise.

### Extra checks for production (done)

Four more checks on top of the dataset results. The first two reuse the saved scores; the last two run the model again. All re-done for the current model.

#### Wrong moments per hour

This is what a user feels: how many of the listed moments for a sound lead nowhere. A moment is **wrong** if it doesn't overlap any labelled sound of that kind (1 s slack). **Found** is the share of labelled sounds that some moment overlaps. This uses overlap, not "start within 1 s", because a moment that lands inside the sound is useful even if it starts late. Default sensitivity, ranges are 95%.

| Sound (dataset) | Wrong moments per hour | Moments that are right | Labelled sounds found |
|---|---|---|---|
| Clapping (STARSS23) | 1.6 (0.7–2.8) | 82% | 89% |
| Telephone (STARSS23) | 0.3 (0.0–0.7) | 93% | 54% |
| Laughter (STARSS23) | 12.9 (9.3–16.9) | 80% | 72% |
| Female speech (STARSS23) | 36.8 (28.3–47.4) | 79% | 93% |
| Male speech (STARSS23) | 31.2 (24.2–38.5) | 87% | 95% |
| Walk, footsteps (STARSS23) | 23.2 (16.6–31.2) | 41% | 56% |
| Door (STARSS23) | 9.0 (5.5–12.7) | 44% | 50% |
| Knock (STARSS23) | 6.1 (3.9–8.7) | 26% | 73% |
| Music (STARSS23) | 21.6 (17.1–26.7) | 32% | 100% |
| Bird, any (Powdermill) | 0.6 (0.0–1.4) | 98% | 100% |
| American crow (Powdermill) | 13.4 (8.4–19.0) | 71% | 72% |
| Bird, any (BirdVox nights) | 44.6 (40.2–49.4) | 72% | 73% |
| Mammal call (DCASE few-shot) | 75.4 (54.3–99.7) | 52% | 77% |
| Dog bark (URBAN-SED) | 6.3 (4.3–8.3) | 93% | 54% |
| Car horn (URBAN-SED) | 21.1 (17.3–25.0) | 84% | 70% |
| Siren (URBAN-SED) | 12.2 (9.2–15.3) | 88% | 64% |
| Gunshot (URBAN-SED) | 27.2 (22.9–31.9) | 76% | 53% |
| Street music (URBAN-SED) | 63.9 (57.2–70.6) | 64% | 82% |
| Drilling (URBAN-SED) | 1.3 (0.4–2.3) | 94% | 12% |

All sounds are in `model-check/ref/extras_*__esed_fmn10_tf_256_advanced_kd_weak_strong.json`.

What this says:
- **Speech has about half the wrong moments it had with frame_mn10** (female 68.8 → 36.8 per hour, male 58.4 → 31.2), and most of the rest are the other voice: 91% of the wrong "Female speech" moments overlap labelled male speech, and 73% the other way round. A user searching "speech" wouldn't see these as wrong.
- **Wrong music moments are mostly not explained by the instrument labels** (31% overlap them). I haven't checked what they are.
- **Steady machines are the opposite case:** almost no wrong moments, but little found (drilling: 12%).
- **Crow is the one listed sound with more wrong moments than before** (10.8 → 13.4 per hour), while it finds more crows (66% → 72%).
- **Per-hour numbers depend on how busy the recording is.** URBAN-SED packs several sounds into every 10 s, so its rates are high. A quiet home recording would have fewer.

#### Error ranges

Each number was recomputed 1,000 times on random re-draws of the audio (bootstrap). Files are cut into 10-minute pieces; shorter files are one piece each. The 95% ranges for F1 per second:

| Dataset | F1 per second | F1 start within 1 s |
|---|---|---|
| STARSS23 | 0.72 (0.70–0.73) | 0.58 (0.56–0.61) |
| Powdermill | 0.93 (0.91–0.94) | 0.19 (0.14–0.25) |
| DCASE few-shot | 0.32 (0.23–0.42) | 0.37 (0.29–0.43) |
| BirdVox | 0.50 (0.47–0.53) | 0.35 (0.33–0.36) |
| URBAN-SED | 0.47 (0.46–0.48) | 0.43 (0.42–0.44) |

- **The dataset totals are solid,** within about ±0.02, except DCASE few-shot (±0.09, only 14 files).
- **Rare sounds are not.** Water tap 0.57 (0.26–0.82), Bell 0.42 (0.23–0.56), Telephone 0.54 (0.36–0.68), Musical instrument 0.39 (0.25–0.52). For these, treat the number as a rough guide.
- **BirdVox ranges are a bit too narrow:** its 10-minute pieces come from only 6 nights, and pieces of one night are alike.
- For comparing two models on the same audio, a paired range is tighter; see "Model comparison".

#### Compressed audio

Real uploads are rarely WAV. Each file of three datasets was mixed to mono, encoded with ffmpeg, decoded and scored again: MP3 128 kbit/s (a typical download), AAC 64 kbit/s (low-bitrate phone or video audio), and Opus 24 kbit/s (like a voice message). Total 19.4 hours per codec. Timing was checked: the decoded files line up with the originals to the sample.

| Dataset | Original | MP3 128 | AAC 64 | Opus 24 |
|---|---|---|---|---|
| STARSS23, F1 per second / start | 0.72 / 0.58 | 0.72 / 0.59 | 0.72 / 0.58 | 0.71 / 0.57 |
| URBAN-SED | 0.47 / 0.43 | 0.47 / 0.43 | 0.49 / 0.44 | 0.46 / 0.43 |
| Powdermill | 0.93 / 0.19 | 0.93 / 0.19 | 0.93 / 0.19 | 0.93 / 0.21 |
| Decisions changed (40 ms rows) | – | 0.06–0.15% | 0.24–1.17% | 1.12–1.81% |

- **MP3 and AAC make no real difference.** The overall F1 stays within 0.01, or goes up slightly. AAC raised jackhammer (0.15 → 0.22) and engine (0.19 → 0.26) in URBAN-SED, as it did with frame_mn10. Their F1 is very low to begin with, so small shifts move them a lot; this is not a reason to prefer AAC.
- **Opus at 24 kbit/s hurts quiet, high or steady sounds:** water tap 0.57 → 0.42, bell 0.42 → 0.33, knock 0.35 → 0.29, domestic sounds 0.29 → 0.26, children playing 0.51 → 0.43, drilling 0.20 → 0.14. Speech, clapping, birds, sirens and dog barks are unaffected.
- Results: `model-check/ref/codec_*__esed_fmn10_tf_256_advanced_kd_weak_strong.json` (frame_mn10: `codec_*.json`).

#### Regression pack

A fixed 84-minute test, to run after any change to the app, the model or the settings:
- **What's in it:** six files cut from the five datasets, with their labels. Rooms (10 STARSS23 recordings, all 13 sounds), streets (90 URBAN-SED scenes, also as an MP3), dawn chorus (3 Powdermill files), a 20-minute busy stretch of a BirdVox night, and 10 minutes of meerkats.
- **How it runs:** it builds the app and serves it on a separate port for the test only. Each file goes through the real app in headless Edge, then the app's own saved scores are scored. It also runs the Python copy of the pipeline and checks that the two still agree.
- **It fails when:**
  - a file's F1 drops by more than 0.02, or
  - a sound's F1 drops by more than 0.05 (sounds with 30+ labelled seconds), or
  - the app and the Python copy differ on more than 0.5% of decisions in a file. The limit is 12% for files below 16 kHz (see the next point).
- **Baseline:** saved for the current model on 2026-10-20 (the frame_mn10 one is kept as `regression/baseline_frame_mn10.json`). The run took 130 s, with 109 s of that spent on analysis (frame_mn10: about 2 minutes and 80 s). The app and the Python copy differ on 0.014–0.037% of decisions in five files. The exception is the 8 kHz meerkat file, at 5.6%.
- **App F1 per second / start within 1 s:** rooms 0.615 / 0.416, street 0.483 / 0.445 (MP3 0.483 / 0.449), dawn chorus 0.944 / 0.400, night stretch 0.953 / 0.027, meerkats 0.715 / 0.612.
- **Why the meerkat file differs:**
  - The app's own model run is exact: from the app's samples, Python gets the same scores (checked with frame_mn10: 0.007% of decisions differ).
  - The difference is in upsampling from 8 kHz. The app's resampler leaves faint sound just above 4 kHz (about −86 dB), where soxr leaves almost none, and the model reacts to it.
  - F1 on that file is about the same either way (0.715 app, 0.712 Python).
  - Not checked: whether this changes accuracy on other low-rate files, such as 8 kHz phone recordings. The DCASE hyena and meerkat numbers come from the Python resampler.
- **Checked that it catches problems** (with frame_mn10): with every score made slightly weaker, it failed on 7 sounds.
- **Not for accuracy claims:** the pack's F1 values aren't accuracy numbers. Its files were picked to be busy (for example, the BirdVox stretch scores 0.95 per second against 0.50 for the full nights).
- **Usage:** `python model-check/eval_datasets/make_pack.py` builds the pack (once). `python regression.py` compares with the baseline, and `--save-baseline` accepts a deliberate change.

Scripts: `model-check/eval_datasets/` (`fetch.py` downloads in parallel with MD5 checks; `eval_*.py` per dataset; `extras.py` for wrong moments and error ranges; `codec_test.py`; `make_pack.py` and `regression.py`; `compare_two.py` for two models). Scores are cached in `model-check/ref/score_cache/`. Results: `model-check/ref/eval_*.json`, `extras_*.json`, `codec_*.json` (with `__esed_fmn10_tf_256_advanced_kd_weak_strong` for the current model, without it for frame_mn10). The datasets and the pack are in `model-check/` (ignored by git).

## Model comparison: frame_mn10 vs EfficientSED fmn10 + transformer (switched)

I searched Hugging Face, GitHub and recent papers for ready-to-use models (no fine-tuning) that give timestamps, beat frame_mn10, and fit in a browser.
- **Nothing on Hugging Face qualified.** "Surround Sound" knows only 54 sounds and is non-commercial; CED and similar taggers give no timestamps.
- **The best candidate is on GitHub:** EfficientSED (theMoro/EfficientSED, EUSIPCO 2025, MIT licence), checkpoint `fmn10+tf-256_advanced-kd-weak-strong`.
  - It's the same kind of MobileNet with a small 2-layer transformer on top.
  - It uses the same 447 sounds, 10 s windows and 40 ms rows, so it drops into the app as is.
  - Its authors report a benchmark score (PSDS1) of 45.3, against 42.3 for their plain fmn10.
- **frame_mn10's official score is unknown.** EfficientSED's plain fmn10 is a different set of weights from our frame_mn10 (scores differ by up to 0.40), so its 42.3 doesn't apply to our model.

**Conversion:** exported to ONNX (`model-check/export_efficientsed.py`): 5.03M parameters, 22 MB, against 3.83M and 15 MB for frame_mn10. ONNX output matches PyTorch within 0.000001.

**Accuracy** on the five datasets, at the default sensitivity. The 95% range is for the difference, from a paired bootstrap over 10-minute pieces.

| Dataset | F1 per second: frame_mn10 → candidate | Difference (95% range) | F1 start within 1 s | Difference (95% range) |
|---|---|---|---|---|
| STARSS23 | 0.695 → 0.716 | +0.021 (+0.013 to +0.028) | 0.496 → 0.584 | +0.088 (+0.075 to +0.099) |
| Powdermill | 0.924 → 0.930 | +0.006 (+0.004 to +0.009) | 0.157 → 0.190 | +0.033 (+0.015 to +0.051) |
| DCASE few-shot | 0.294 → 0.317 | +0.023 (+0.001 to +0.050) | 0.257 → 0.371 | +0.115 (+0.052 to +0.161) |
| BirdVox | 0.518 → 0.502 | −0.016 (−0.023 to −0.010) | 0.404 → 0.346 | −0.058 (−0.071 to −0.046) |
| URBAN-SED | 0.421 → 0.472 | +0.050 (+0.045 to +0.056) | 0.375 → 0.434 | +0.059 (+0.051 to +0.068) |

- **Better on 4 of 5 datasets, beyond the error range.** The biggest gains are in start times (+0.03 to +0.12), so moments begin closer to the real start.
- **Fewer wrong moments.** Per hour, over all sounds: STARSS23 262 → 175, URBAN-SED 240 → 153, BirdVox 63 → 45, DCASE 64 → 55. Powdermill is the exception, 12 → 14.
- **Gains by sound:** speech (0.82–0.86 → 0.86–0.88), water tap (0.45 → 0.57), bell (0.31 → 0.42), knock (0.26 → 0.35), car horn (0.63 → 0.70), siren (0.64 → 0.70), dog bark (0.58 → 0.62), drilling (0.10 → 0.20), engine (0.11 → 0.19).
- **Losses:** domestic sounds (fans, boilers) 0.42 → 0.29, and faint night flight calls (BirdVox) are slightly worse.
- Results: `model-check/ref/eval_*__esed_fmn10_tf_256_advanced_kd_weak_strong.json` and `ref/compare_frame_mn10__vs__esed_fmn10_tf_256_advanced_kd_weak_strong.json`.

**In the real app** (Edge, headless, plugged in; loaded through a test-only model URL and hash hook):
- **It runs.** The browser and Python agree on 0.01–0.04% of decisions. The 8 kHz file differs by 5.6%, the same resampler effect as with frame_mn10.
- **Speed:** on the same 84-minute pack, model time was 64 s for the candidate against 47 s for frame_mn10, so about 1.37× slower. That's roughly 45 s against 33 s of model time per hour of audio.
- **Regression pack:**
  - Better on 5 of 6 files, for example the 8 kHz meerkats 0.600 → 0.715 per second and street scenes 0.437 → 0.483.
  - The busy BirdVox stretch is unchanged per second (0.954 → 0.953), but start-within-1 s fell from 0.066 to 0.027.
- **Tricycle video:** no better. It still calls the rolling "water", and adds trickle, gush and coin dropping. The voices are found as before (9 of 9).

**Decision:** switched to the candidate on 2026-10-20 (see "Model switch to EfficientSED").
- It's clearly more accurate on most sounds and has fewer false alarms.
- It costs about 37% more processing time and 6 MB more download (19.2 MB against 13.5 MB as .gz).

## Sound + picture test (done, 2026-10-21; not in the app)

Can an image model help find sounds in videos? Tested on 549 UnAV-100 videos (40 h, events marked by hand) and the tricycle clip. Details are in `notes/sound-and-picture.md`, scripts in `model-check/fusion/`.

- Image models: CLIP B/32 (MIT, 89 MB), MobileCLIP-S0 (research-only licence, 45 MB) and SigLIP B/16 (Apache 2.0, 99 MB). The picture only nudges the sound score up or down; it never finds a sound on its own. Settings were tuned on half the videos and measured on the other half.
- UnAV only marks sounds you can also see, so it rewards hiding off-screen sounds. Absolute numbers are low for that reason; only the comparisons count.
- Every model ranks the right seconds higher (AP 0.166 → 0.187–0.197).
- Boosting every sound only looks better if the threshold rises so far that off-screen sounds get hidden. At the threshold sound alone would use, F1 stays the same or drops (0.180 → 0.167–0.179): more right answers, but just as many more wrong ones. Seeing a car isn't hearing one. On the tricycle clip, every second became "child voice" because the child is always on screen.
- Boosting only the sounds where the tuning half improved is the one version that's better without hiding anything. With CLIP, F1 goes 0.180 → 0.201, precision stays at 0.155 and recall goes 0.40 → 0.51, and both halves improved. But the chosen list is short and not stable (6 sounds picked in both halves: Car passing by, Chirp/tweet, Lawn mower, Meow, Rain, Train wheels squealing).
- Rough browser speed (Edge, this laptop): the sound model takes about 0.57 s per minute. CLIP adds 1.7–2.3 s per minute, plus 0.5–3.6 s to pull the frames (higher for 1080p and 4K). For a 1 h video that's about 35 s for sound alone against 3–6 extra minutes for the picture, and an 89 MB download instead of 19 MB.
- Decision (2026-10-21): the app stays sound-only for now. If this comes back, it would be CLIP for a short list of sounds, after measuring browser speed and checking the list on more videos.

## Deployment (done, Render)

- **Live site: https://soundscope-cglz.onrender.com** (Render static site, free plan, made from `render.yaml` as a Blueprint). Render rebuilds it on every push to `main` on GitHub. `check-site.mjs` passes there in full: multi-threaded, model from the site and cached, no outside requests, no CSP blocks, test files not published.
- Chosen over Cloudflare Pages on 2026-10-21. Analysis speed is the same on both, and Render downloaded the model a little faster here (1.8 s against 4.3 s over HTTP/2). The Cloudflare preview, the leftover `workers.dev` worker and the Pages project were all deleted. Steps, checks and the Cloudflare history are in `notes/deploy.md`.
- `npm run build:site` makes the public build in `dist-site/` (34 MB). It has the app, the model (served from the site, so the page talks to no other site), `_headers` and `THIRD-PARTY-NOTICES.txt`. The test models, test samples and the device test page are left out. The build stops if the model file doesn't match `config.js`.
- Headers: cross-origin isolation (multi-threaded analysis), a strict Content-Security-Policy, no referrer, a 1-year cache for code and model files.
- The model loader now unpacks the .gz only if it's still compressed, in case a host already did that on the way.
- Checked locally on the exact build, served with the same headers (`tools/serve-site.mjs` + `tools/check-site.mjs`), in Edge and Firefox:
  - cross-origin isolated;
  - the model comes from the site and is cached after the first visit;
  - audio and video analyse;
  - no requests to other sites and no CSP blocks;
  - test files not published.
  
  The UI, click-to-play, timeline, search, typo, bookmark, note and video-sound checks all pass against it too.
- Cloudflare preview (since deleted): classic Pages, because this network blocks `*.workers.dev`, where Cloudflare now sends new projects. `check-site.mjs` passed there in Edge, Chrome and Firefox.
- Known issue: on networks that throttle HTTP/3, like this one, the first visit in Edge or Chrome is slow: the 19.2 MB model took 79 s on Render and 104 s on Cloudflare, against about 2–4 s over HTTP/2. Render serves through Cloudflare and offers HTTP/3, and neither `onrender.com` nor `pages.dev` lets you turn it off. A custom domain on Cloudflare would. Later visits use the cached model.
- Code on GitHub (2026-10-21): https://github.com/Abhinavbilla/SoundScope (public), with a README. Left out: personal recordings, models, test data, the model-check folder, and personal details in notes. The model isn't in git: `tools/fetch-model.mjs` downloads it from Hugging Face during the build and checks its hash.

## Done when

I can upload a real recording, search a sound, click a result, hear it, bookmark it, and export it.

And I've tested it on recordings I labeled myself in Audacity. I only label 3 to 5 target sounds in them, and measure:

- Precision, recall and F1 for those target sounds only. A detection counts as correct if its start is within 1 second of the real start.
- Processing time per minute of audio.

Test set: _N recordings, X total minutes (fill in once known)._

I write down what worked and what didn't, with these numbers.

## Order of work

1. Model check (done)
2. Decoding and waveform (done, streaming)
3. Running the model (done, in the same worker, fed by the decoded pieces)
4. Intervals and timeline (done)
5. Search (done)
6. Bookmarks and export (done)
7. Evaluation

## Open questions

- Main measure: "present in this second" as the main number, with "start within 1 s" reported alongside? Waiting for my decision.
- Model weights licence: the EfficientSED repo (and PretrainedSED, for frame_mn10) is MIT, with no separate statement for the weights. Confirm with the authors before commercial use.
- Low-sample-rate files (8 kHz and below, like phone calls): the app's resampler and soxr give different scores (8% of decisions on one file, same F1). Check accuracy on more such files before choosing a sharper filter.
