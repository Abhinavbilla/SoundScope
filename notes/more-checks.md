# More checks (everything left except phones)

Date: 2026-10-18. Edge 154, Chrome, stock Firefox 158, i5-1340P laptop. Model frame_mn10, downloaded from Hugging Face unless noted.

Not possible here: real Safari (needs a Mac), my own labelled recordings (needs my labels), low-memory machines. Phones are left for last.

## Firefox and Chrome with the new model

All six audio formats and five video formats, with results saved and reopened (`tools/measure-firefox.mjs` with `SS_REOPEN=1`, `tools/measure-decode.mjs`, `tools/check-store.mjs`).

| File | Firefox total | Firefox page peak | Chrome total | Chrome page peak |
|---|---|---|---|---|
| mix0.wav (1 min) | 5.1 s | 258 MB | 4.1 s | 254 MB |
| t10min.mp3 | 12.1 s | 366 MB | 9.7 s | 279 MB |
| t10min.m4a | 12.2 s | 288 MB | 12.0 s | 257 MB |
| t10min.aac | 12.2 s | 312 MB | 9.7 s | 302 MB |
| t10min.flac | 10.2 s | 341 MB | 10.2 s | 264 MB |
| t10min.ogg | 19.2 s | 327 MB | 17.7 s | 335 MB |
| v10min.mp4 | 30.4 s (slow download, see below) | 331 MB | 12.0 s | 285 MB |
| v10min.webm | 13.1 s | 334 MB | 14.1 s | 288 MB |
| v10min.mkv / .ts / .mov | 13.2 / 13.2 / 14.2 s | 340–392 MB | not run | |

- Model speed: 0.20–0.22 s per minute of audio in Firefox, 0.19–0.36 in Chrome.
- Results were saved in every case. Reopening gave "saved" in both browsers (Chrome: 0.04 s; Firefox: under the 1 s polling step of the test).
- **One network failure:** in the first Firefox run, the first six files all failed with "The sound detection model couldn't be downloaded. Check your internet connection and try again." (about 64 s each), then the videos worked. A direct download right after took 3–4 s, and a rerun of all six passed. So it was the connection or Hugging Face for those few minutes, not Firefox. The message was the right one. A single automatic retry would hide short outages like this; not added.

## Unsupported video formats (Edge, Chrome, Firefox)

| File | Edge | Chrome | Firefox |
|---|---|---|---|
| AVI (H.264 + MP3) | "This video format can't be opened. Supported video formats: MP4, MOV, WebM, MKV and MPEG-TS." | same | same |
| WMV (WMV2 + WMA) | same | same | same |
| E-AC-3 in MKV and MP4 | **decoded** (like AC-3) | "This video's sound format (E-AC-3 (Dolby Digital Plus)) can't be decoded in this browser." | same as Chrome |
| DTS in MKV | "This video's sound format (DTS) can't be decoded in this browser." | same | same |

All messages appear within 0.3–1 s.

## Private windows

| Browser | Analysis | Results saved? | Reopen in the same window |
|---|---|---|---|
| Firefox private | works | no: Firefox blocks the file storage (OPFS gives SecurityError). The page says "Results use 1-second detail and won't be kept (browser storage isn't available here)." | analyses again (8 s for 10 min) |
| Chrome Incognito (real `--incognito`) | works | yes, for the session | saved |
| Edge InPrivate (real `--incognito`) | works | yes, for the session | saved |

The model download is cached in all of them for the session.

## Storage really full (bug found and fixed)

Edge with the site's storage limit capped through DevTools (`Storage.overrideQuotaForOrigin`), so the browser itself refuses writes (`tools/check-private.mjs`, `SS_QUOTA_MB`).

- **Bug:** with a 30 MB limit and a 1 h file (needs about 40 MB), the write failed with `QuotaExceededError` near the end and the app stayed at "Listening for sounds… 1:00:00 of 1:00:00" forever. The earlier "storage full" test only simulated the up-front space check, which can't catch this: the browser's storage estimate still reported 10 GB under the cap. A real disk filling up during analysis would behave the same.
- **Fix** (`src/store/scoreStore.js`): any failed write now stops saving, closes the files and deletes the partial result. Analysis carries on with 1-second detail and the page says "Not enough browser storage to save full detail, so results use 1-second detail and won't be kept."
- After the fix:

| Limit | File | Result |
|---|---|---|
| 30 MB | 1 h MP3 | finished in 36.7 s, not saved, note shown, partial files deleted (only the 14 MB model cache left) |
| 10 MB | 10 min MP3 | model not cached (it downloads again next time), results saved (6.7 MB), reopen "saved" |
| 25 MB | 10 min MP3 | model cached and results saved, reopen "saved" |

- The earlier checks still pass after the change: cancel clean-up, no storage, simulated full storage (`tools/check-store-edges.mjs`), and saved video results reopening (`tools/check-store.mjs`).
- Not done: when a write fails, older results could be deleted and the save retried. Today the up-front check deletes old results only when the browser's estimate says space is short.

## Big videos (Edge, visible window)

| File | Size | Total time | Read from disk | Page memory |
|---|---|---|---|---|
| 10 min 4K (3840×2160, 20 Mbit/s) | 1,454 MB | 11.0 s | 1,455 MB | 510–538 MB during analysis |
| 10 min 1080p-style (v10min.mp4) | 94 MB | 10.0 s | 94 MB | 283 MB |
| 10 h 320×180 MP4 (AAC 96k) | 1,088 MB | 388.7 s (6.5 min) | 1,088 MB | 430–520 MB during analysis, 686 MB peak at the end when the player loads the video |
| 10 h MP3 (earlier) | 673 MB | 413.3 s | | 481 MB |

- The 4K file's extra memory comes from reading 1.4 GB in 11 s; it doesn't grow with length (the 2 h 1080p file stayed flat at 416 MB).
- The 10 h video opened in 0.13 s and was saved.

## Reading only the sound's parts of a video (`useStreamReader: false`)

Test switch `__soundscopeNoStreamReader` / `SS_NO_STREAM_READER=1`.

| File | Mode | Total | Read from disk | Page peak |
|---|---|---|---|---|
| 10 min 4K | stream (current) | 11.0 s | 1,455 MB | 538 MB |
| 10 min 4K | range reads | 21.2 s | 1,455 MB | 363 MB |
| v10min.mp4 | stream (current) | 10.0 s | 94 MB | 283 MB |
| v10min.mp4 | range reads | 10.0 s | 94 MB | 275 MB |

Range reads didn't read less: the sound is packed in small pieces between the picture, so the reads merge and cover the whole file anyway. They were twice as slow on 4K. Kept the current stream reader. Slow disks and network drives: not measured (no such drive here).

## Background tab (new model, Edge, 1 h MP3)

| Tab | Total | Model s/min | Page peak |
|---|---|---|---|
| visible | 41.5 s | 0.21 | 395 MB |
| another tab in front | 62.7 s | 0.39 | 316 MB |

About 1.5× slower in the background (the old model was 1.6×).

## Whole-file fallback with the new model (Edge, 30 min MP3)

| Path | Total | Page peak | Rows |
|---|---|---|---|
| stream (normal) | 20.9 s | 297 MB | 45,000 |
| fallback (forced) | 13.5 s | 1,774 MB | 45,000 |

The fallback works with the new model and saves its results. It uses six times the memory, which is why it's only used for audio files up to 200 MB that the streaming path can't open.

## How to rerun

```
node node_modules/vite/bin/vite.js build
node node_modules/vite/bin/vite.js preview --port 4173 --strictPort
SS_REOPEN=1 node tools/measure-firefox.mjs <files>
SS_PRIVATE=1 SS_REOPEN=1 node tools/measure-firefox.mjs test-audio/t10min.mp3
SS_BROWSER=chrome node tools/measure-decode.mjs <files>
SS_QUOTA_MB=30 node tools/check-private.mjs test-audio/t60min.mp3
SS_NO_STREAM_READER=1 SS_HEADED=1 node tools/measure-decode.mjs test-audio/video/v10min_4k.mp4
SS_BACKGROUND=1 SS_HEADED=1 node tools/measure-decode.mjs test-audio/t60min.mp3
SS_FALLBACK=1 SS_HEADED=1 node tools/measure-decode.mjs test-audio/t30min.mp3
```
