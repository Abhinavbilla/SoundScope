"""Recompute the app's frame_mn10 scores in Python (onnxruntime, same model, 10 s windows every 5 s
crossfaded with Hann weights) from the exact samples the app fed the model, and compare after the
app's 8-bit log encoding. HOP = SEG gives the old no-overlap scores.
Usage: python tools/verify_scores_framemn.py <scoresDir> <name> [<name> ...]   (model-check venv)
"""
import sys
import numpy as np
import onnxruntime as ort

C, SEG, HOP, ROW, ROWS = 447, 160000, 80000, 640, 250
W = np.hanning(ROWS + 2)[1:-1]
s = ort.InferenceSession("model-check/models/frame_mn10.onnx", providers=["CPUExecutionProvider"])


def decode(b):
    b = b.astype(np.float64)
    return np.where(b == 0, 0.0, 10 ** (b / 255 * 4 - 4))


def encode(p):
    out = np.round((np.log10(np.maximum(p, 1e-12)) + 4) / 4 * 255).clip(1, 255)
    return np.where(p > 1e-4, out, 0).astype(np.uint8)


d = sys.argv[1]
for name in sys.argv[2:]:
    x = np.fromfile(f"{d}/{name}.samples.f32", "<f4")
    app = np.fromfile(f"{d}/{name}.scores.u8", np.uint8).reshape(-1, C)
    rows = int(np.ceil(len(x) / ROW))
    acc = np.zeros((rows + ROWS, C)); wsum = np.zeros(rows + ROWS)
    i = 0
    while True:  # same windows as the app: full windows every HOP, then one padded window if needed
        seg = x[i:i + SEG]
        if len(seg) < SEG:
            if i > 0 and (i - HOP) // ROW + ROWS >= rows:
                break  # the last full window already reached the end
            seg = np.pad(seg, (0, SEG - len(seg)))
        r0 = i // ROW
        acc[r0:r0 + ROWS] += W[:, None] * s.run(None, {"waveform": seg[None]})[0][0]
        wsum[r0:r0 + ROWS] += W
        if i + SEG >= len(x):
            break
        i += HOP
    ref = (acc[:rows] / np.maximum(wsum[:rows], 1e-12)[:, None])
    ref_b = encode(ref)
    step_diff = np.abs(app.astype(int) - ref_b.astype(int))
    p_app, p_ref = decode(app), ref
    big = p_ref > 1e-3
    rel = np.abs(p_app[big] - p_ref[big]) / p_ref[big]
    flips = np.mean((p_app >= 0.02) != (p_ref >= 0.02)) * 100
    print(f"{name}: {len(x)/16000:.2f} s, rows app {app.shape[0]} ref {ref.shape[0]} "
          f"{'OK' if app.shape == ref.shape else 'MISMATCH'} | encoded steps differing: {np.mean(step_diff > 0)*100:.3f}% "
          f"(max {step_diff.max()}) | relative error for scores > 0.001: median {np.median(rel)*100:.2f}%, max {rel.max()*100:.2f}% "
          f"| decisions changed at 0.02: {flips:.4f}%")
