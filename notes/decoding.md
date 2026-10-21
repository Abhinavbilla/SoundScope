# Decoding tests

Date: 2026-10-18. Edge 154 (headless, via Playwright), Windows 11, i5-1340P, 15.6 GB RAM.
The machine had little free memory: 29–34 GB committed out of a 35–36 GB commit limit during the tests, because of other programs.

## Test files (local only, in `test-audio/`, ignored by git)

Real field recordings from Radio Aporee (Internet Archive, public domain mark), cut or joined to exact lengths with soundfile. They're re-encoded, so they're real audio but not the original MP3 bitstreams.

| File | Source | Format |
|---|---|---|
| t10min.mp3 | "Large black ants nest" (aporee_51055_58283) | 44.1 kHz stereo |
| t30min.mp3 | "The Cricket Symphony at Old Orhei" (aporee_43330_49367) | 44.1 kHz stereo |
| t40/45min.mp3 | "Morning far walk" (aporee_48851_57820) | 48 kHz stereo |
| t60min.mp3 / .wav, t2h, t3h | "Morning far walk" + "Summer afternoon with cello" (aporee_47802_57205), looped for 2 h and 3 h | 48 kHz stereo |
| MorningfarwalkARIIwithbreak.mp3 | original 52.6 min file, unmodified | 48 kHz stereo |
| t10min.flac / .ogg | t10min.mp3 re-encoded | 44.1 kHz stereo |
| damaged.mp3, damaged_big.mp3, notes.wav | random bytes (200 KB, 20 MB) and a text file | — |

## How memory was measured

The OS's private bytes for the Edge processes running the test, polled about every 0.3 s. "Page" is the renderer process, which includes the worker. Short peaks between polls can be missed, so short files may read a little low.

## Whole-file decode (first version, now the fallback)

`decodeAudioData` on an `OfflineAudioContext` at 32 kHz, then mono mixed in place.

First runs (about 2.5 GB of free commit memory):

| File | Result | Decode | Page peak | Page after |
|---|---|---|---|---|
| 10 min MP3 | ok | 1.1–1.2 s | 555 MB | 182 MB |
| 30 min MP3 (2 runs) | ok | 3.4 s | 1,601–1,775 MB | 480 MB |
| 40 min MP3 | ok | 4.7 s | 2,131 MB | 630 MB |
| 45 min MP3 | ok | 5.6 s | 2,231 MB | 703 MB |
| 52.6 min MP3 (original) | **failed**: EncodingError | — | 1,376 MB | — |
| 60 min MP3 (2 runs) | **failed**: EncodingError | — | 1,510–1,598 MB | — |
| 60 min WAV | **hung**: no result after more than 15 min, page idle at 2.1 GB | — | — | — |

Later runs, same conditions as the streaming tests (about 6 GB of free commit memory):

| File | Result | Decode | Page peak |
|---|---|---|---|
| 10 min MP3 | ok | 1.3 s | 555 MB |
| 30 min MP3 | ok | 3.5 s | 1,601 MB |
| 60 min MP3 | ok | 13.9 s | 3,651 MB |
| 2 h MP3 | **failed** (out of memory; now shows the "too long" message) | — | 3,136 MB |

Findings:
- Peak memory is about 55–61 MB per minute of stereo audio, so the limit depends on how much memory is free.
- Edge reports running out of memory as `EncodingError`, the same error a damaged file gives. The app now checks whether the first 1 MB decodes, so it can tell the two apart.

## Streaming decode (current)

Mediabunny reads the file through `BlobSource` (8 MB cache), decodes with WebCodecs, mixes to mono, then resamples with our polyphase resampler, all in a Web Worker.

| File | Result | Total time | Page peak | Page after |
|---|---|---|---|---|
| 10 min MP3 | ok | 2.9–3.2 s | 121–125 MB | 68 MB |
| 10 min FLAC | ok | 2.3 s | 123 MB | 52 MB |
| 10 min OGG Vorbis | ok | 5.2 s | 176 MB | 119 MB |
| 30 min MP3 | ok | 9.9 s | 148 MB | 90 MB |
| 60 min MP3 (3 runs) | ok | 17.0, 35.3, 35.7 s | 223–230 MB | 121–134 MB |
| 60 min WAV (659 MB) | ok | 17.7 s | 119 MB | 76 MB |
| 2 h MP3 (2 runs) | ok | 77.6, 80.0 s | 225–236 MB | 128–146 MB |
| 2 h WAV (1.3 GB) | ok | 47.8 s | 174 MB | 72 MB |
| 3 h MP3 | ok | 119.1 s | 235 MB | 134 MB |
| damaged files | clear "couldn't be decoded" message | <0.5 s | — | — |

I don't know why one 60 min run took 17 s and two others took about 35 s. Laptop power or thermal state is a guess, not something I measured.

## Is streamed audio the same as the browser's decode?

`tools/compare-decoders.mjs`: the full file through both decoders, aligned by cross-correlation.

| File | Length (samples) | Offset | SNR | Max diff |
|---|---|---|---|---|
| t10min.mp3 (44.1 kHz) | equal, 19,200,000 | 0 | 35.2 dB | 0.066 |
| t40min.mp3 (48 kHz) | equal, 76,800,000 | 0 | 45.7 dB | 0.059 |
| t60min.wav (48 kHz) | equal, 115,200,000 | 0 | 45.6 dB | 0.060 |

Before I added MP3 gapless trimming, streamed MP3 was 23–25 ms late (1,105 samples of encoder + decoder delay) and slightly longer.

Model check, using Cnn14 int8 on the first 120 s of both versions (10.24 s windows, 5.12 s step):

| File | Max score diff | Mean diff | Decisions changed at threshold 0.02 |
|---|---|---|---|
| t10min | 0.015 | 1.8e-5 | 0.020% |
| t40min | 0.037 | 2.7e-5 | 0.016% |
| t60min | 0.051 | 3.1e-5 | 0.022% |

Top-5 sounds were the same for t40min and t60min. For t10min they weren't identical, and I didn't check exactly what changed.

Resampler unit test (`node tools/test-resampler.mjs`): chunked output is identical to one-shot output, lengths are exact, and SNR is 86–95 dB against an ideal 1 kHz tone (with a 20 kHz tone removed) for 22.05, 44.1, 48 and 96 kHz input.

## Not measured

- Chrome, Firefox, Safari (only Edge)
- M4A and AAC files (I had no encoder for them here)
- Files longer than 3 hours
- Memory with the model running alongside decoding (next step)
- Machines with more or less memory than this one
- Where the decode time goes (decoder vs resampler vs JS loops)

## How to rerun

```
node node_modules/vite/bin/vite.js build
node node_modules/vite/bin/vite.js preview --port 4173
node tools/measure-decode.mjs test-audio/t60min.mp3          # streaming
SS_FALLBACK=1 node tools/measure-decode.mjs test-audio/t60min.mp3   # whole-file
node tools/compare-decoders.mjs test-audio/t10min.mp3 test-audio/compare
node tools/test-resampler.mjs
```
