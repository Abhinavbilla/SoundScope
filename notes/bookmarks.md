# Step 6: bookmarks and export

Date: 2026-10-19. Edge 154, stock Firefox 158, i5-1340P laptop (on battery for most of these runs, so times are slower than on mains power).

## What it does

- **☆ next to every moment** bookmarks it (★ = bookmarked; click again to remove). The label is the sound; in a combined search row it's the sound that was strongest there ("Bark"). Confidence is the moment's highest score.
- **Bookmark current position** adds a 1 s bookmark at the playback position, with no label or confidence (for sounds the model missed).
- **Bookmarks panel:** each bookmark plays from 2 s before, has a note field (saved when you leave the field or press Enter), a **Clip** button and ×.
- **Saved per file** in IndexedDB (key: hash of name, size and date, without the model, so bookmarks survive a model change). They come back when the same file is opened again. If IndexedDB isn't available the page says bookmarks will be lost when the window closes.
- **Export CSV:** columns start, end, label, confidence, note; times in seconds (3 decimals). UTF-8 with a BOM so Excel shows non-English notes correctly; quotes and commas are escaped.
- **WAV clips:** bookmark ± 1 s (kept inside the file), at the file's own sample rate, 16-bit, mono or stereo (more channels are mixed to stereo). One file per clip, no zip. Names like `walk-Bark-0-24.9.wav`.
  - **Save all clips** in Chrome and Edge asks for a folder once and writes all clips into it. Firefox (no folder picker) gets one download per clip.
  - Clips are cut in a worker that decodes only the seconds each clip needs (plus 0.5 s before, thrown away, because a decoder starting mid-stream can glitch). MP3 encoder delay is added back so clips line up with the analysis timeline.
  - Formats the streaming reader can't open use the browser's whole-file decoder (files up to 200 MB, as for the analysis).

## Clip timing: found a problem with Ogg Vorbis, fixed

Clips were compared with ffmpeg's decode of the same stretch (`tools/verify_clips.py`: whole file decoded by ffmpeg, cut by sample index, aligned by cross-correlation; exact times from the exported CSV).

- **Ogg Vorbis, first version (seeking):** clips were 3–23 ms off, by a different amount each time. Mediabunny works out a Vorbis packet's length from the previous packet's block size, which a seek skips. Now Ogg Vorbis files are read from the start (all clips in one pass), placing audio by counting decoded frames, exactly like the analysis. That's exact, but slower for clips late in a long Ogg file.
- Note on the reference: ffmpeg's own `-ss` trimming isn't sample-exact for Ogg Vorbis either (it reported 4–10 ms "offsets" for correct clips), so the check decodes the whole file instead.
- The analysis timeline itself was checked too: the 16 kHz audio the model saw lines up with ffmpeg's decode at 0.0 ms every 25 s through the whole 10 min, for both Ogg and FLAC.

Results after the fix (Edge unless noted), bookmarks at 0.5 s, 5:02.5, 9:57 and two detected Wind moments (one 2 min long):

| Format | Offset vs ffmpeg | SNR (aligned) |
|---|---|---|
| MP3 | 0.0–0.2 ms | 49–54 dB |
| FLAC | 0.0–0.5 ms | 47–52 dB |
| OGG (Vorbis), Edge and Firefox | 0.0–0.5 ms | 49–54 dB |
| WebM video (Opus) | 1.0 ms | 49–53 dB |
| M4A, AAC, Edge and Firefox | 0.0–0.3 ms | 5–14 dB, see below |
| MP3 through the whole-file fallback | 0.0 ms | 49–53 dB |

- **AAC's low SNR isn't an error:** ffmpeg's own decode of the same .m4a matches the lossless FLAC at only 10.7 dB, the same as the app's clip (10.6 dB). The encoder that made the test files fills noisy bands with synthetic noise, which every decoder generates differently. The timing matches exactly.
- The first quarter second of each file is near-silent, which is why clips at 0.5 s show a lower worst-case SNR there.

## Speed of clip export

`tools/time-clips.mjs` (one 3 s clip, Edge, on battery):

| File | Near the start | Middle | Near the end |
|---|---|---|---|
| 3 h MP3 | 0.09 s | 0.99 s | 1.87 s |
| 10 h MP3 | 0.10 s | 3.11 s | 6.00 s |
| 1 h M4A | 0.08 s | 0.06 s | 0.07 s |

MP3 seeking reads through the file up to the clip (no seek index in MP3); within one "Save all clips" that happens once. A 10 min Ogg file: 5 clips up to 9:57 in 6.8–8.2 s. Long Ogg files: not measured (no long Ogg test file); expect time to grow with the position of the last clip.

## Checks

`tools/check-bookmarks.mjs` (Edge), `tools/check-bookmarks-firefox.mjs` (Firefox), `tools/verify_clips.py`, `tools/time-clips.mjs`.

| Check | Result |
|---|---|
| ☆ bookmarks a moment, ★ removes it | pass |
| Note with comma and quotes, kept after reopening | pass (`"first one, ""loud"""` in the CSV) |
| Bookmark at the playback position | pass (12.0, 40.0, 302.5, 597 s) |
| Bookmarks come back after reopening the file | pass, Edge and Firefox |
| CSV: header, BOM, one row per bookmark | pass |
| Single clip, all clips as downloads, all clips into a picked folder | pass (the folder picker was stood in for by a private-storage folder, since a script can't click the real dialog) |
| Formats | MP3, M4A, AAC, FLAC, OGG, WebM video (Edge); M4A and OGG (Firefox) |
| Phone width 375 px, dark mode | layout OK |
| Step 4 and 5 checks after the changes | pass |

## Not done / not measured

- Audacity label export (start, end, label as tab-separated text) would make it easy to compare with my own Audacity labels in the evaluation step. Not asked for; easy to add.
- Bookmarks can't be edited (start/end/label), only noted and removed.
- Real "Save all clips" folder dialog clicked by a person (only the stand-in folder was tested), and the whole-file fallback with a real format that only the browser can read.
- The Hugging Face connection was down during part of these tests. The app showed "The sound detection model couldn't be downloaded. Check your internet connection and try again." The tests then used the local copy of the model.
