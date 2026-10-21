# Sound + picture test (2026-10-21)

Question: for videos, does adding an image model to the sound model find sounds better?

## Data

- UnAV-100 test set from Hugging Face (`nguyenminh04/unav100-videos`, CC BY-NC-SA, local only, never committed). 549 videos, 40 h, people marked by hand when each event starts and stops.
- 68 of its 100 event types match one of our model's sounds. Instruments, sports and a few others have no match and are left out. 36 sounds had enough videos to measure (2+ videos in each half).
- Big catch: UnAV only marks events you can both hear and see. An off-screen sound counts as a wrong answer. This flatters anything that hides off-screen sounds, so the absolute numbers are low for every version and only the comparisons mean something.
- Also checked on the tricycle clip (`test-audio/whatsapp`). Its labels are mine from frames and spectrograms; the user's ear check is still pending.

## Image models

| Model | File the browser would use | Licence | ms per frame here (4 threads) |
|---|---|---|---|
| CLIP ViT-B/32 (`Xenova/clip-vit-base-patch32`) | vision int8, 89 MB | MIT | 24–45 |
| MobileCLIP-S0 (`Xenova/mobileclip_s0`) | vision fp32, 45 MB (the int8 file gives NaN and nonsense) | Apple AMLR, research only | 21–40 |
| SigLIP B/16 (`Xenova/siglip-base-patch16-224`) | vision int8, 99 MB | Apache 2.0 | 165–215 |

Speed in the browser was not measured. Frames: one every 2 s (one a second scored the same on the first 166 videos). Each of the 447 sounds gets a text embedding from its everyday name, made once offline, so the browser would not need the text model.

## How it was combined

The picture only nudges the sound score: `logit(sound) + w * v`, where v is how well the frame matches the sound's name (standardised). "Up only" means v below 0 is ignored, so the picture can raise a score but never lower it. Settings were picked on one half of the videos and measured on the other, then swapped. Scripts: `model-check/fusion/` (prep, audio, vision, evaluate, selective, clip_check).

## Results (test halves, averaged)

| Version | AP | F1 | Precision | Recall | Threshold |
|---|---|---|---|---|---|
| Sound only (now) | 0.166 | 0.180 | 0.155 | 0.400 | tuned (0.2, 0.4) |
| + CLIP, all sounds | 0.187 | 0.204 | 0.161 | 0.512 | tuned (0.7) |
| + MobileCLIP, all sounds | 0.197 | 0.212 | 0.153 | 0.588 | tuned (0.7) |
| + SigLIP, all sounds | 0.191 | 0.220 | 0.171 | 0.528 | tuned (0.6, 0.7) |
| + CLIP, all sounds | | 0.178 | 0.122 | 0.663 | sound only's |
| + MobileCLIP, all sounds | | 0.167 | 0.105 | 0.712 | sound only's |
| + SigLIP, all sounds | | 0.179 | 0.120 | 0.654 | sound only's |
| + CLIP, chosen sounds only | 0.178 | 0.201 | 0.155 | 0.512 | sound only's |
| + MobileCLIP, chosen sounds only | 0.179 | 0.189 | 0.144 | 0.512 | sound only's |
| + SigLIP, chosen sounds only | 0.177 | 0.196 | 0.150 | 0.487 | sound only's |

- Ranking (AP) gets better with every model, by 12–18%.
- The F1 gain for "all sounds" only shows up when the threshold rises to 0.6–0.7. In practice that hides sounds that aren't on screen, which this dataset rewards and real use doesn't. At sound only's threshold, F1 is the same or worse: more right answers, but more wrong ones too, because seeing a thing isn't hearing it.
- Boosting only the sounds where the tuning half showed a gain is the one version that is better at sound only's threshold. Both halves improved for all three models: precision stays the same and recall goes from 40% to about 50%. CLIP did best. The chosen list is small and not stable between halves (CLIP: 8 and 17 sounds, 6 in both: Car passing by, Chirp/tweet, Lawn mower, Meow, Rain, Train wheels squealing).
- Voices get worse with the picture. Tricycle clip: the child is on screen the whole time, so every second became "child voice" (wrong seconds went from 3 to about 20). The ball got flagged whenever it was visible, not when it bounced. The tricycle itself, which the sound model missed completely, was found (F1 0 → 0.84–0.96).

## Speed in the browser (rough, Edge 154, i5-1340P, 4 threads)

Measured with the device test page (`device-test.html`, `clip_vision` and `efficientsed_local`, random input, 2 runs) and `tools/measure-frame-grab.mjs` (seek a `<video>`, draw at 224×224, read pixels).

| Step | Per minute of video | For a 1 h video |
|---|---|---|
| Sound model (12 windows a minute) | 0.56–0.58 s | about 35 s |
| CLIP on one frame every 2 s (30 a minute) | 1.7–2.3 s | about 1.7–2.3 min |
| Pulling those frames, small videos (UnAV, 360p) | 0.5–0.8 s | about 0.5–0.8 min |
| Pulling those frames, 1080p and 4K | 3.4–3.6 s | about 3.4–3.6 min |

- The sound + picture mode adds about 2.3–5.9 s per minute of video, which is 4–10× the sound model's own work. Model time only for sound: file decoding is extra in both modes and isn't in this table.
- CLIP's download is 89 MB once, against 19 MB for the sound model. It takes 3–4 s to load.
- Each step was timed on its own. Running both at once on the same CPU would probably add up roughly, but that wasn't measured.

## Decision

2026-10-21: the app stays sound-only for now. The test data was deleted, except the saved scores in `model-check/data/unav/scores` (430 MB), so `evaluate.py` and `selective.py` still run. The speed rows come from the `clip_vision` and `efficientsed_local` entries in `src/workers/bench.worker.js`. They're no longer listed on the device test page; add them back to the list in `src/deviceTest.js` to rerun.

## Verdict

- Adding the picture to every sound: don't. It either hides off-screen sounds or adds about as many wrong moments as right ones.
- CLIP for a short list of sounds (vehicles, machines, some animals, rain): the only version that was better here without hiding anything. The gain is modest (F1 0.180 → 0.201) and the list is shaky. It costs an 89 MB download and extra time per video (not measured in a browser yet).
- MobileCLIP can't ship because of its licence. SigLIP is about 5x slower than CLIP and wasn't better.
