# Video files (sound track only)

Date: 2026-10-18. Edge 154 / Chrome / stock Firefox 158, i5-1340P laptop.

## How it works

The worker opens a video the same way as an audio file (Mediabunny, read piece by piece). It picks the sound track (the one marked default if there are several; `getPrimaryAudioTrack` prefers the default disposition), and decodes only that. Video frames are never decoded and never held in memory. The page shows the video in a `<video>` element that streams from the file, and WaveSurfer drives that element, so clicking the waveform seeks the video.

Videos never use the whole-file fallback decoder, because it would load the entire video into memory. If the streaming path can't open a video, the user gets a message instead.

## Test files (local, `test-audio/video/`, synthetic picture + real sound)

| File | Container / video / sound | Size |
|---|---|---|
| v10min.mp4, v10min.mov | H.264 + AAC (copied from t10min.m4a) | 98 MB |
| v10min.ts | MPEG-TS, H.264 + AAC (copied) | 105 MB |
| v10min.webm | VP9 + Opus (copied from a10min_opus.webm) | 42 MB |
| v10min.mkv | H.264 + Opus (copied) | 96 MB |
| v10min_ac3.mkv | H.264 + AC-3 | 100 MB |
| v_2tracks.mp4 | H.264 + AAC (default, copied) + a second AAC track | 108 MB |
| v_noaudio.mp4 | H.264 only, 60 s | 8 MB |
| v2h_1080p.mp4 | 1920×1080 H.264 3 Mbit/s + AAC 160k, 2 h | 2,687 MB |

## Same sound, same result

| Video | Compared with | Result |
|---|---|---|
| v10min.mp4, v10min.mov | t10min.m4a (same AAC stream) | decoded audio and scores byte-identical |
| v_2tracks.mp4 | t10min.m4a | identical except the last 17 samples (the video was cut 24 ms shorter) → the default track was used |
| v10min.webm, v10min.mkv | a10min_opus.webm | identical except the last 16 samples (cut 41 ms shorter) |
| v10min.ts | t10min.m4a | starts 23 ms early: AAC encoder padding isn't recorded in MPEG-TS (MP4 has an edit list), same as raw .aac. 0.41% of decisions differ at 0.02 |

## Browsers (10 min videos)

| File | Edge | Chrome | Firefox 158 |
|---|---|---|---|
| MP4, WebM, MKV, TS | ok (6–8 s) | ok (6.4–7.6 s, 295–322 MB) | ok (10–11 s, 324–370 MB) |
| AC-3 (MKV) | **decoded** (Edge on Windows has a Dolby decoder) | message: "This video's sound format (AC-3 (Dolby Digital)) can't be decoded in this browser." | same message |
| No sound track | "This video has no sound track." | same | same |

## Long video (Edge, visible window)

| 2 hours | File size | Total time | Read from disk | Page memory peak |
|---|---|---|---|---|
| 1080p MP4 | 2,687 MB | 85.6 s | 2,819 MB | 416 MB (flat: 346–389 MB during the run) |
| Same audio as MP3 | 134 MB | 87.7 s | 140 MB | 354 MB |

Mediabunny reads straight through the file (sound and picture are interleaved), so the whole video is read from disk. On this laptop that cost no extra time, because decoding and the model take longer. On slow disks or network drives it might. Reading only the sound's byte ranges (`useStreamReader: false`) was tried later: it still read the whole file and was slower (see `more-checks.md`).

## Player

- `tools/check-video-player.mjs`: the video is shown (640×360, 600 s). Clicking the waveform at 25% / 75% moved the video to 149.5 s / 450 s.
- Saved results for videos reopen in 0.02 s with the player (`tools/check-store.mjs`).

## Not measured

- Slow disks and network drives
- Phones

4K and 10 h videos, AVI, WMV, E-AC-3 and DTS were tested later: see `more-checks.md`.
