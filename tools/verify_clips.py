"""Compare exported WAV clips with ffmpeg's decode of the same stretch of the original file.
The whole file is decoded and cut by sample index (ffmpeg's own -ss trimming isn't sample-exact for Ogg Vorbis).
Exact bookmark times come from the exported CSV; each clip should cover start - 1 s .. end + 1 s
(kept inside the file). Reports the time offset (cross-correlation, first 5 s) and the SNR after aligning,
overall and the worst quarter second.
Usage: python tools/verify_clips.py <original file> <bookmarks.csv> <clip folder>   (model-check venv)
"""
import csv
import math
import os
import re
import subprocess
import sys
import numpy as np
import soundfile as sf
from scipy.signal import correlate

FF = os.path.abspath("model-check/.venv/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe")
src, csv_path, folder = sys.argv[1:4]


def fmt_time(s):  # same as formatTime in src/results/format.js
    t = max(0.0, math.floor(s * 10) / 10)
    h, m = int(t // 3600), int((t % 3600) // 60)
    sec = f"{t % 60:04.1f}"
    return f"{h}:{m:02d}:{sec}" if h else f"{m}:{sec}"


def safe(s):  # same as safe() in src/export/exportFiles.js
    s = re.sub(r'[\\/:*?"<>|]+', "", s)
    return re.sub(r"\s+", "-", s).replace(",", "")[:60]


base = safe(os.path.splitext(os.path.basename(src))[0])
dur = float(subprocess.run([FF, "-i", src], capture_output=True, text=True).stderr.split("Duration: ")[1].split(",")[0]
            .split(":")[-1]) + 60 * float(subprocess.run([FF, "-i", src], capture_output=True, text=True).stderr
                                          .split("Duration: ")[1].split(":")[1])
full = {}  # (rate, channels) -> whole decoded file
for row in csv.DictReader(open(csv_path, encoding="utf-8-sig")):
    start, end = float(row["start"]), float(row["end"])
    name = f"{base}-{safe(row['label'] or 'bookmark')}-{fmt_time(start).replace(':', '-')}.wav"
    path = os.path.join(folder, name)
    if not os.path.exists(path):
        print(f"{name}: missing")
        continue
    y, sr = sf.read(path, dtype="float32", always_2d=True)
    c0 = max(0.0, start - 1)
    pre = min(0.5, c0)
    key = (sr, y.shape[1])
    if key not in full:
        raw = subprocess.run([FF, "-v", "error", "-i", src, "-f", "f32le", "-ac", str(y.shape[1]), "-ar", str(sr), "-"],
                             capture_output=True, check=True).stdout
        full[key] = np.frombuffer(raw, np.float32).reshape(-1, y.shape[1])
    i0 = int(round((c0 - pre) * sr))
    r = full[key][i0:i0 + len(y) + int((pre + 0.5) * sr)]
    exp = int(round(pre * sr))
    w = min(len(y), 5 * sr)
    a = y[:w].mean(1)
    lo = max(0, exp - sr // 2)
    b = r[lo:exp + sr // 2 + w].mean(1)
    k = int(np.argmax(correlate(b, a, mode="valid", method="fft")))
    lag = lo + k
    seg = r[lag:lag + len(y)]
    n = min(len(seg), len(y))
    seg, yy = seg[:n], y[:n]
    snr = 10 * np.log10(np.sum(seg ** 2) / (np.sum((seg - yy) ** 2) + 1e-20))
    q = sr // 4
    worst = min((10 * np.log10(np.sum(seg[i:i + q] ** 2) / (np.sum((seg[i:i + q] - yy[i:i + q]) ** 2) + 1e-20)), i / sr)
                for i in range(0, n - q + 1, q))
    want = min(dur, end + 1) - c0
    print(f"{name}: {len(y) / sr:.3f} s (expected {want:.3f}), {sr} Hz, {y.shape[1]} ch | offset vs ffmpeg "
          f"{(lag - exp) / sr * 1000:+.2f} ms | SNR {snr:.1f} dB, worst quarter second {worst[0]:.1f} dB at {worst[1]:.2f} s")
