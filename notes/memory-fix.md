# Flat page memory for long files

Date: 2026-10-18. Edge 154, i5-1340P laptop (other programs were using 29–33 GB of a 35 GB commit limit). Page memory = the renderer process's private bytes (page + workers), polled by the OS.

## Result

| File | Before (40 ms scores in memory) | After |
|---|---|---|
| 10 min MP3 | 270 MB | 275 MB |
| 1 h MP3 | 463 MB | 415 MB |
| 3 h MP3 | 626 MB | 415 MB |
| 10 h MP3 | ~750 MB | 481 MB |

Memory over the 10 h run (% of run: MB): 10%:384 20%:366 30%:382 40%:387 50%:389 60%:405 70%:408 80%:432 90%:446. That's a plateau of about 400 MB with a slight remaining rise (about 7 MB per hour of audio). Before the fixes, the same run went 10%:407 → 90%:635.

## What was growing, and the fixes

1. **Scores (≈ 2× 40 MB per hour).** The page held every 40 ms score (447 sounds, 1 byte each) and copied them once more when joining the parts.
   **Fix:** the worker writes full-resolution scores to OPFS as they're produced (`src/store/scoreStore.js`). The page only gets a 1-second overview (max per second per sound, about 1.6 MB per hour) and each sound's highest score. Full timelines are read from OPFS on demand.

2. **Mediabunny's frame index (MP3, ADTS/AAC, FLAC).** Its demuxers keep one entry per audio frame for the whole file (about 1.5 million for 10 h of MP3). The JS heap stayed small (5–20 MB), but growth showed in packet reading alone (10 h, no decoding: +120 MB). Forced GC didn't help, and the stream reader (`useStreamReader: false`) made no difference.
   **Fix:** subclasses in `src/vendor/` replace the list with paged typed arrays (pages of 65,536 entries; fields that never change, like frame duration, are stored once), wired in by a Vite plugin. Mediabunny's files are not modified. Side effect: reading 10 h of MP3 packets went from 214 s to 27 s.

3. **Remaining:** the paged index (about 30 MB for 10 h) and some memory inside the browser's WebCodecs decoder. A plain AudioDecoder test rose about 60 MB over 10 h.

## Storage layout (OPFS, folder `results/`)

Per analysed file, key = SHA-256 of name, size, last modified and model id (first 16 bytes):
- `<key>.scores`: 1 byte per score, in blocks of 7,500 rows (5 min); inside a block, class-major (all rows of sound 0, then sound 1, …)
- `<key>.overview`: max per 1 s per sound
- `<key>.peaks`: waveform peaks
- `<key>.json`: metadata, written last (`complete: true`)

Disk use: about 40 MB per hour (3 h: 121 MB of scores). In a class-major layout gzip would shrink it to 26% (not done; it would need an index and per-read decompression).

## Checks

- Stored scores are byte-identical to the previous in-memory scores (5 s, 23.7 s, 60 s, 10 min), and match Python as before (`tools/verify_scores_framemn.py`).
- Decoded audio and scores are byte-identical with and without the frame-index fix for MP3, M4A, AAC, FLAC and OGG (`SS_NO_FRAME_INDEX=1` build vs normal). The paged index has a unit test (`tools/test-frame-index.mjs`).
- Reading one sound's full timeline from OPFS: 3 h file (270,000 rows, 36 blocks) 16–36 ms; 1 h file 4–10 ms.
- Reopening the same file after a reload: 0.01–0.02 s (`path: "saved"`), versus 38 s (1 h) / 119 s (3 h) to analyse.
- A cancelled run leaves a partial `.scores` file, which the next analysis removes. Without OPFS, or when storage is full (both simulated), the analysis still works with 1-second detail and a short message (`tools/check-store-edges.mjs`).
- Space: before writing, the worker checks `navigator.storage.estimate()` and deletes the least recently used results if needed.

## Not measured

- Other browsers (Chrome, Firefox, Safari) with OPFS storage
- Files over 10 hours
- (Real storage-full, private windows, Chrome and Firefox storage, 10 h video: tested later, see `more-checks.md`.)
- Phones
