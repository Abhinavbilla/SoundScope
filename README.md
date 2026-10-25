# SoundScope

**Find any sound in a long recording.** Open an audio or video file, and SoundScope marks where speech, dogs, sirens, applause and 440+ other sounds happen. You jump straight to them instead of listening to hours of audio.

Everything runs in your browser. **Your recordings are never uploaded.** The site only sends the app itself and its sound model; the listening happens on your own device.

---

## What it does

- **Finds sounds on a timeline.** Each sound gets its own lane under the waveform. Click or drag anywhere to play from that point.
- **Lists every moment.** Pick a sound to see each time it happens, how long it lasts, and how sure the app is (Maybe / Likely / Very likely). Clicking a moment plays it from 2 seconds before.
- **Search that forgives typos.** "dog" also finds barks, howls and growls. "anmal" still finds animal sounds, and "foot steps" finds footsteps.
- **A "Show" slider** goes from *clear sounds only* to *also faint ones*.
- **Bookmarks with notes.** Star a moment or mark any point, add a note, and search your notes from the same search bar.
- **Downloads.** Get a list for Excel, or each bookmark as a sound clip, named after its note.
- **Video too.** MP4, MOV, WebM, MKV and TS: the picture plays next to the timeline.
- **Long files.** Tested up to 10 hours. Results are saved on your device, so reopening a file is instant.
- **Light and dark themes.** Works on phone screens.

Formats: MP3, WAV, M4A/AAC, FLAC, OGG/Opus, and the video formats above. Dolby Digital sound (AC-3 / E-AC-3, common in movie MKVs) is decoded by SoundScope itself, because most browsers can't. Its decoder (1.1 MB) is only downloaded when such a file is opened. Most browsers can't *play* Dolby sound either: the video then plays silently, and a note says so. The results are complete, and clips have sound.

## How it works

1. The file is read and decoded piece by piece in a background worker, so long files don't fill memory.
2. Every 10 seconds of audio (in overlapping windows) goes through **EfficientSED**, a sound-event model that runs in the browser with ONNX Runtime Web. It gives a score for each of 447 sounds every 40 ms.
3. Scores are saved in the browser's private storage (OPFS). Moments are found from them instantly whenever you move the slider.

There's no server code. The site is static files: the app (about 15 MB) and the model (19 MB, downloaded once and then cached).

## Run it locally

Needs **Node.js 22.12 or newer**.

```bash
npm install
npm run dev            # http://localhost:5173
```

The model loads from `/models/efficientsed_fmn10_tf256.onnx.gz`. Get it once with:

```bash
node tools/fetch-model.mjs   # downloads from Hugging Face and checks its hash
```

## Build and deploy

```bash
npm run build:site     # public build in dist-site/ (fetches the model if needed)
npm run serve:site     # serve dist-site with the production headers, http://localhost:4174
```

`dist-site/` contains only the app, the model, the headers file and the licence notices.

**The server must send these two headers**, or analysis falls back to a single thread (about 3–4× slower):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**Live site: https://soundscope-cglz.onrender.com**, hosted on Render. It rebuilds automatically on every push to `main`.

Ready-made configs:

- **Render (used):** `render.yaml` (Blueprint). In Render, choose *New → Blueprint* and pick this repo. It builds with `npm ci && npm run build:site` and serves `dist-site/` with the headers. Don't create it as a plain Static Site, or the headers in `render.yaml` are skipped.
- **Cloudflare Pages:** `site/_headers` is copied into the build. Run `npm run deploy:preview`, then `npm run deploy`.

Any static host that can set custom headers works: Netlify, Vercel and others. GitHub Pages can't set headers, so it isn't suitable.

More detail, including checks and rollback: [`notes/deploy.md`](notes/deploy.md).

## Tests

Browser checks use Playwright with Edge or Chrome. Most need a test audio or video file of your own:

```bash
node tools/test-search.mjs                       # search and typo rules (no browser)
node tools/test-intervals.mjs                    # how moments are formed (no browser)
npm run build && npm run preview                 # then, in another terminal:
node tools/check-ui-controls.mjs <audio>         # keyboard, buttons, theme, no technical values
node tools/check-seek.mjs <audio or video>       # click / drag on the timeline
node tools/check-bookmarks.mjs <outDir> <audio>  # bookmarks, notes, downloads
node tools/check-note-search.mjs <outDir> <audio>
node tools/make-dolby-sample.mjs <audio or video> <out.mkv> [ac3|eac3] [sound file]   # a Dolby test file, no ffmpeg
SS_BROWSER=chrome node tools/check-dolby.mjs <outDir> <dolby file> [same recording, normal format]
node tools/check-site.mjs <site url> <audio> <video>   # a deployed site: headers, model, no outside requests
```

Set `SS_BASE=<url>` to run the browser checks against another address.

## Project layout

```
src/
  App.jsx, components/    the interface (React)
  audio/                  file reading and decoding (Mediabunny, WebCodecs)
  workers/                analysis and clip-export workers
  model/                  model settings, sound names and the sound tree
  results/                moments, search, everyday sound names
  store/                  saved scores (OPFS) and bookmarks (IndexedDB)
  export/                 Excel list and WAV clips
site/                     production headers and licence files
tools/                    tests and helper scripts
notes/                    design notes and measurements
spec.md                   the full spec, decisions and test results
```

## Accuracy, honestly

The model was checked on five public labelled datasets (real rooms, bird recordings, wild animals, 10-hour night recordings, synthetic street scenes). Results, including where it does badly, are in [`spec.md`](spec.md). In short: it's strong on speech, music, vehicles and many common sounds, and weaker on rare or very short sounds. Treat results as pointers to listen to, not final answers.

## Credits and licences

- **Sound model:** EfficientSED (fmn10 + transformer) by Tobias Morocutti, Florian Schmid, Jonathan Greif, Francesco Foscarin and Gerhard Widmer, *"Exploring Performance-Complexity Trade-Offs in Sound Event Detection Models"*, EUSIPCO 2025. MIT licence. The ONNX copy used here is on Hugging Face: [`Abhinavbilla/efficientsed-fmn10-tf256-onnx`](https://huggingface.co/Abhinavbilla/efficientsed-fmn10-tf256-onnx).
- **Sound categories:** AudioSet ontology by Google, CC BY-SA 4.0.
- **Libraries:**
  - ONNX Runtime Web (MIT)
  - Mediabunny (MPL-2.0), and its AC-3 extension (MPL-2.0) with FFmpeg's AC-3 decoder (LGPL-2.1)
  - wavesurfer.js (BSD-3-Clause)
  - React (MIT)
  - Lucide icons (ISC)
  - Inter font (OFL 1.1)

The full licence texts are published with the site as `THIRD-PARTY-NOTICES.txt`.

The model weights have no separate licence statement beyond the repository's MIT licence. Check with the authors before commercial use.
