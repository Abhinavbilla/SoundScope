# UI redesign

Date: 2026-10-19. Done before step 7, at my request: a top-quality, attractive UI that hides values normal users don't need.

## What I looked at

- **Linear-style dark UI:** a near-black canvas, depth from small lightness steps rather than shadows, hairline borders, and one restrained accent (2025: fewer, bolder accents). Inter type, 4 px spacing grid, keyboard-first with Ctrl+K.
- **SoundCloud waveform:** the played part in the accent colour, the rest muted, markers anchored on the waveform.
- **Audio/event timeline guidance:** every view on the same time axis, a hover line showing the time under the mouse, play from any point, the most important information first.
- **Descript:** a waveform timeline of horizontal tracks with coloured clips.
- **Adobe Podcast:** one big drop area, processing starts right after upload.
- **Colour-blind-safe categories:** Okabe-Ito palette, with black swapped out on dark backgrounds.

Sources: help.descript.com (editor interface), buildmvpfast.com (Linear aesthetic tokens), bootcamp.uxdesign.cc (Linear-style design), blog.logrocket.com (Linear 2025), webdesignhot.com (SoundCloud design notes), screensdesign.com (audio waveform UIs), wac.ircam.fr (audio UI components paper), audioeye.com (Okabe-Ito palette), amcharts.com (colour-blind dark theme).

## What changed

- **Look:** dark and light themes (system, light or dark; remembered in this browser), violet→teal accent, soft aurora glow, Inter Variable and Lucide icons bundled locally (no third-party requests), new logo and favicon.
- **Landing:** headline, short explanation, a large drop area with an animated waveform, three feature cards. Files can be dropped anywhere on the page.
- **While analysing:** "Listening…" with an animated equaliser, a progress bar, time left ("About 2 min left"), and results filling in below ("Found so far").
- **Workspace:**
  - Search (`/` or Ctrl+K) and sensitivity at the top. Search results open in a popover that closes when you click elsewhere.
  - Player card: file name, length, kind, sounds found, and whether results are kept. Video above the waveform.
  - Waveform with the selected sound's moments marked on it; timeline lanes right under it on the same time axis; a playhead and a hover time line across both; a time ruler.
  - Play controls: play/pause, back/forward 5 s, time, playback speed (1×, 1.5×, 2×), keyboard hints (Space, ←, →).
  - Moments and Bookmarks as tabs. The moments list scrolls inside its panel.
  - "Sounds in this recording": chips coloured by kind (People, Animals, Music, Nature, Things, Other, Background), with filters.
- **Hidden from normal users:**
  - raw scores (0.42 etc.): replaced by a strength meter (Possible / Likely / Strong)
  - the threshold value: the slider just says Fewer / More
  - sample rate, channels, processing time
  - storage jargon: replaced by "Private · saved on this device" or "Private · not kept after you close the tab"
  - generic background labels ("Background noise", "Mechanisms", "Sound effect", room tone, hum…): hidden from the list and the default rows, behind "Show N background sounds". They're still searchable.
  - The CSV export still includes confidence (that's part of the spec's export format).
- Credits (model, ontology, Mediabunny, wavesurfer, Lucide, Inter) are in the footer, as the licences need.

## Checks

- Steps 4–6 checks all pass again in Edge and Firefox after updating the tests to the new markup. Clips still match ffmpeg at 0.0 ms.
- `tools/check-ui-controls.mjs`: drop anywhere, Space play/pause, arrows skip 5 s, `/` and Ctrl+K focus search, play and skip buttons, speed button, theme switch remembered after reload, and no technical values on screen (no 0.xx scores, kHz, "score", "threshold", "channels", "analysed in", ms). All pass.
- Screenshots reviewed: landing, analysing, results, search, bookmarks, video, error, in dark and light at 1280 px and at 390 px phone width. No horizontal overflow at 390 px.
- Two small UX fixes came out of testing: the search popover now closes on an outside click (it could cover the timeline), and scrolling to an item keeps it clear of the sticky top bar.

## Not done

- Zooming the timeline.
- A real phone (emulated widths only).
