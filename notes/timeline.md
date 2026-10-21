# Step 4: intervals and timeline

Date: 2026-10-19. Edge 154, Chrome, stock Firefox 158, i5-1340P laptop.

## What it does

- **Intervals** (`src/results/intervals.js`): rows at or above the threshold, joined when the gap is under 1 s, then dropped if shorter than 0.5 s (changed to 0.12 s in step 5, see `search.md`). Confidence = the highest score inside the interval. The threshold is compared on the stored byte scale, so moving the slider never runs the model again.
- **Sensitivity slider:** log scale from 0.001 to 0.5, starting at 0.05 (frame_mn10's best thresholds on the TUT street recordings were 0.01–0.05 per sound, up to 0.2 for exact starts). One slider for all sounds; per-sound thresholds not done.
- **Sounds found:** every sound heard at the current sensitivity, with how long it's heard, most heard first. Counted from the 1-second overview in one pass, so it's fast on long files.
- **Timeline:** one row per chosen sound, drawn on a canvas (a 3 h file had 789 intervals in one row). Stronger detections are drawn more solid. Until you pick sounds, it shows the 3 most heard sounds that come and go: sounds heard in more than 80% of the file (background noise and the like) are skipped for the default.
- **Moments list** for the selected row: start – end and confidence. Clicking a moment, or an interval on the timeline, plays from 2 s before. A line on the timeline follows playback. For videos, the video seeks too.
- **Live results:** while the analysis runs, the list and timeline fill in at 1-second detail (updated about once a second). Afterwards, the timeline rows switch to full 40 ms detail read from storage. Moments can be played once the analysis finishes.
- Reopened files show the timeline straight away (0.08–0.12 s).

## Window edges: found a problem, switched to overlapping windows

The first timeline showed intervals starting and ending at exactly 20.0, 30.0, 60.0 s. With 10 s windows and no overlap, frame_mn10's scores jump at every window edge:

- t10min (a real continuous recording): median score change between neighbouring rows was 0.118 (log10, averaged over 447 sounds) at window edges vs 0.007 elsewhere. 100% of the edges were above the 99th percentile of the other rows.

Measured fixes on the TUT street recordings and the synthetic set, with the same metrics as the model comparison (`model-check/overlap_test.py`, one model pass with 10 s windows every 5 s):

| Windows | TUT AP | TUT F1 | TUT start F1 | Synthetic F1 | Synthetic start F1 | Jump where windows switch |
|---|---|---|---|---|---|---|
| none (10 s, no overlap; before) | 0.590 | 0.616 | 0.203 | 0.889 | 0.888 | 0.145 |
| every 5 s, averaged | 0.603 | 0.625 | 0.208 | 0.914 | 0.887 | 0.076 |
| every 5 s, keep each window's middle | 0.596 | 0.620 | 0.200 | 0.919 | 0.906 | 0.088 |
| **every 5 s, Hann crossfade** | **0.602** | **0.625** | **0.206** | **0.931** | **0.892** | **0.008** (normal level) |

("none" is 0.590 here vs 0.593 in the model comparison: in this test the last few seconds of some files weren't covered by a no-overlap window.)

The app now uses 10 s windows every 5 s with Hann weights (`src/model/scorer.js`, `MODEL.rowWeights`). Rows covered by a single window (the first and last 5 s) keep that window's score. The model id for saved results changed (`pretrainedsed-frame_mn10-hann5s`), so old saved results are analysed again.

- **Same as Python:** the app's scores match a Python version of the same windowing (`tools/verify_scores_framemn.py`) for 5 s, 23.7 s, 60 s and 10 min files: same row counts, within one 8-bit step, 0.005–0.011% of decisions differ at 0.02.
- **In the app:** the jump at 10 s edges went from 0.118 to 0.007 (t10min), the same as elsewhere. Intervals no longer snap to 10 s marks.
- **Cost:** the model runs twice as often.

| File (Edge, tab visible) | Before | After | Page peak after |
|---|---|---|---|
| 10 min | 9.5 s | 11–12 s | about 300 MB |
| 1 h | 40–41.5 s | 56.8 s | 414 MB |
| 3 h | 148 s | 184 s | 417 MB |

Model time is now 0.42–0.45 s per minute of audio (was 0.21).

## Checks (`tools/check-timeline.mjs`, `tools/check-timeline-firefox.mjs`, `tools/test-intervals.mjs`)

| Check | Result |
|---|---|
| Interval rules (threshold, merge under 1 s, keep apart at 1 s, min 0.5 s, end of file, overview counting, slider mapping) | pass |
| Speed: 10 h timeline (900,000 rows) | 7 ms |
| Speed: recount all 447 sounds on a 10 h overview | 37 ms |
| Live results appear during analysis | after about 4–5 s (10 min, 3 h files) |
| Slider: more sensitive → more sounds, less → fewer | t10min: 175 / 32 / 7 sounds at 0.002 / 0.05 / 0.27 |
| Slider move to repaint | 4–11 ms (10 min), 25 ms (3 h) |
| Click a moment in the list | plays from 2 s before (e.g. 27.4 s → 25.4 s) |
| Click an interval on the timeline | same |
| Video follows | yes (26.2 s moment → video at 24.5 s) |
| Add a sound from the list / remove with × | 3 → 4 → 3 rows |
| Reopen the same file | saved results, timeline in 0.08–0.12 s |
| Cancel while live results show | results disappear, file picker back (Firefox) |
| Firefox 158 | all of the above that were run there pass (10 min in 10.3 s) |
| Phone width 375 px, dark mode | layout OK (screenshots) |

Files tested: mix0.wav (1 min), t10min.mp3, v10min.mp4, t3h.mp3, plus t60min.mp3 for cancel.

## Not done / not measured

- Per-sound thresholds (one slider for all sounds for now).
- Zooming the timeline. On long files, short intervals are thin lines; the moments list is the way to reach them.
- Whether 0.05 is a good starting threshold on my own recordings (evaluation step).
- Keyboard: the moments list and sound list work with the keyboard; clicking on the timeline canvas is mouse/touch only.
