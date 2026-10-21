# Video clip test: tricycle (2026-10-20)

A private 27 s phone video (480×864, AAC mono 48 kHz; not in this repo): a tricycle rolling on a hard floor, children's voices, and a ball that falls around 8.7–9.3 s and is handed back around 11.5–13 s while the tricycle stands still.

## Labels

- **Who made them:** Claude, from 4 frames per second plus spectrograms, without listening and before running the model.
- **Where:** `test-audio/whatsapp/labels.json` (ignored by git), and the same labels as an Audacity label file in `labels-audacity.txt`, so they can be checked by ear.
- **What's in them:** tricycle rolling (two stretches), 9 child-voice stretches, a ball bounce, and 4 faint squeaks. A noise burst at 7.8–8.15 s is left out as unsure.

## Result (the real app, default sensitivity)

`model-check/eval_datasets/eval_clip.py`, from the app's own saved scores (`tools/dump-scores.mjs`).

| Sound | Model sounds | Found | Notes |
|---|---|---|---|
| Child voice | child speech, laughter, giggle, shout, babbling… | 9 of 9 stretches; per second P 0.85, R 1.00, F1 0.92 | The voices are what the model gets right |
| Tricycle rolling | "Bicycle, tricycle" | 0 of 2 (max score 0.009) | The model has this sound but calls the rolling noise water tap, frying and sizzle (0–10.7 s) |
| Tricycle rolling, broad (rattle, roll, rumble, skateboard…) | | 1 of 2, "Rattle" at 19–26 s | The per-second F1 isn't meaningful here: the tricycle rolls through almost every second |
| Ball bounce | bouncing, thump, tap… | 0 of 1 (max 0.016) | The model hears laughter and a giggle at 9.2–10.0 s. Either my bounce label or the model is wrong; needs a listen |
| Squeak | squeak, creak, squeal | 0 of 4 (max 0.04) | Faint; my labels are low confidence |

Other things the app lists that aren't in the labels: water tap 0.1–10.7 s, frying 0.1–8.4 s, sizzle 0.2–7.0 s, music 11.1–18.1 s, bird 11.0–14.5 s (short), male speech 11.3–13.8 s. The male speech may be right: an adult's hand is in frame then, and I had labelled that stretch as a child's voice.

## What this says

- **Voices are fine from audio alone.**
- **The "sound effects" of the scene are where audio alone fails.** The tricycle's rolling, the ball and the squeaks are in the audio, but the model mistakes the rolling noise for water or frying, and misses the rest. Someone watching the video knows straight away it's a tricycle.
- **Sensitivity can't fix it:** "Bicycle, tricycle" never goes above 0.009, so any setting that low would flood the timeline.
- This is one 27 s clip with labels made without listening. It shows a pattern, not an accuracy number.

## With EfficientSED (the app's model since 2026-10-20)

Run again through the real app with the model loaded from Hugging Face: voices 9 of 9, "Bicycle, tricycle" still never listed, broad rolling sounds found in 1 of 2 stretches (13.8–26.8 s), ball and squeaks still missed. Scores in `test-audio/whatsapp/app_esed_hf/`.
