# Step 5: search

Date: 2026-10-19. Edge 154, stock Firefox 158, i5-1340P laptop.

## What it does

- A search box above the sensitivity slider. Typing "dog" lists Dog plus the sounds under it in the AudioSet ontology: Bark, Yip, Howl, Bow-wow, Growling, Whimper (dog), Pant (dog), and "Canidae, wild dogs, wolves". Each match shows why it matched ("Bark · Dog") and how long it's heard in this file. Sounds heard in the file come first; the rest are greyed out and marked "not heard".
- Tick a match to put it on the timeline, or press **Show all as one row** to put every match on one combined row (“dog” (9 sounds)). A combined row's score is the highest of its sounds' scores at each moment, and each of its moments shows which sound was strongest there ("0:24.9 – 0:29.7 Bark").
- Works while the analysis is still running ("46 matching sounds · 0 heard so far").
- No match: "No sound called “xyzzy”. Try a broader word, like animal, vehicle, water or music."

## Matching rules (`src/results/search.js`)

- Each query word has to match the sound's own name or the name of a group above it. So "door knock" finds Knock (under Door), and "dog bark" finds Bark.
- A word matches the same word, its plural or singular, or (for 4+ letters) the start of a word ("chew" finds "Chewing"). Short prefixes only count when nothing else matches, so "car" finds Car, Car alarm, Vehicle horn, car horn… but not "Carbon monoxide detector" or "Cart".
- Order: exact names first, then sounds whose own name matched, then sounds found through a group.
- Not searched: descriptions. So "woof" finds nothing, though AudioSet's description of Bark mentions it.

## The sound tree (`src/model/sound-tree.json`, built by `tools/build_sound_tree.py`)

- AudioSet ontology (`ontology.json` from github.com/audioset/ontology, CC BY-SA 4.0 by Google), trimmed to the 461 entries with a model sound at or below them. 25 KB.
- Our 447 sounds are placed by their AudioSet ID (PretrainedSED's `class_labels_indices_strong.csv`). 11 are in the ontology under slightly different names (e.g. "Glass shatter" is "Shatter"); the app shows the model's names.
- 31 newer AudioSet "strong" sounds aren't in the ontology. I gave them parents by hand, e.g. Pant (dog) → Dog, Knife → Cutlery, Shower → Bathroom sounds and Water, Refrigerator → Domestic sounds. This mapping is my own choice, not AudioSet's (listed in `EXTRA_PARENTS`).
- The ontology files are kept in `model-check/ontology/` (ignored by git). The tree file is derived from the ontology, so it's CC BY-SA 4.0 too, and the About page needs to credit it.

## Minimum event length: changed from 0.5 s to 0.12 s

The first search test found no moments for "dog" in the synthetic mixes, although Bark was clearly heard: single barks are 0.2–0.3 s long and the 0.5 s minimum dropped them. The 0.5 s value was an untested starting value; the model comparison had used no minimum at all. Measured with the current windowing (`model-check/minlen_test.py`, best threshold per sound, start within 1 s):

| Minimum length | TUT start F1 | Synthetic start F1 | Synthetic dog |
|---|---|---|---|
| 0 | 0.206 | 0.892 | 1.00 |
| 0.08 s | 0.207 | 0.900 | 1.00 |
| **0.12 s** | **0.208** | **0.900** | **1.00** |
| 0.25 s | 0.206 | 0.909 | 1.00 |
| 0.5 s (before) | 0.192 | 0.815 | 0.71 |

Now 0.12 s (three 40 ms rows): it drops single-row flickers without losing short sounds.

## Checks

`tools/test-search.mjs` (matching rules), `tools/check-search.mjs` (browser, labelled mixes), `tools/check-timeline-firefox.mjs` (Firefox, now with search).

Searching the 4 synthetic mixes at the default sensitivity (0.05) and comparing the matches' row with the labelled times (an event counts as found if a moment overlaps it, 1 s slack):

| Search | Found | Moments with no labelled event |
|---|---|---|
| dog (combined row, 9 sounds) | 8 / 8 | 0 |
| knock (2 sounds) | 8 / 8 | 0 (one knock split in two) |
| glass (3 sounds) | 7 / 8 (missed a 0.25 s glass break) | 0 |
| clap (1 sound) | 8 / 8 | 1 |

These mixes are synthetic and were used to pick the model, so this only shows search works end to end; it isn't an accuracy result.

| Check | Result |
|---|---|
| Tick a match → row added, untick → removed | pass (all 4 files) |
| No-match message | pass |
| "door knock" → Knock · Door | pass |
| Combined row moment → plays from 2 s before | 24.9 s → 22.9 s |
| Search during analysis (Firefox) | "46 matching sounds · 0 heard so far" |
| Combined row in Firefox ("wind", 6 sounds) | pass |
| Phone width 375 px | pass |

## Speed note

During these checks the laptop was on battery ("Balanced" plan): model time in both Edge and Firefox was 0.9–1.9 s per minute of audio, against 0.42–0.45 on mains power this morning. So the battery runs don't measure the app; speed numbers in the spec are from mains power. Battery speed is worth knowing for users, but I haven't measured it properly.

## Not done

- Searching descriptions or extra synonyms ("woof", "meow" works because Meow is a sound name).
- Combined rows aren't saved; they're gone when the file is reopened.
