"""Recompute the app's scores in Python (onnxruntime, same int8 model, same windowing as the
model check) from the exact samples the app fed the model, and compare.
Usage: python tools/verify_scores.py <scoresDir> <name> [<name> ...]   (run with model-check's venv)
"""
import sys
import numpy as np
import onnxruntime as ort

C = 527
WIN, HOP, ROWS, HOP_ROWS, ROW = 327680, 163840, 32, 16, 10240

so = ort.SessionOptions()
so.add_session_config_entry("session.disable_prepacking", "1")
s = ort.InferenceSession("model-check/models/cnn14_sed_int8.onnx", so, providers=["CPUExecutionProvider"])


def reference(x):
    """Same as model-check eval_models.cnn14_windowed."""
    n_rows = int(np.ceil(len(x) / ROW))
    acc = np.zeros((n_rows, C)); cnt = np.zeros(n_rows)
    start = 0
    while True:
        seg = x[start * ROW: start * ROW + WIN]
        if len(seg) < WIN:
            seg = np.pad(seg, (0, WIN - len(seg)))
        o = s.run(None, {"waveform": seg[None].astype(np.float32)})[0][0][:ROWS]
        k = min(ROWS, n_rows - start)
        acc[start:start + k] += o[:k]; cnt[start:start + k] += 1
        if start + ROWS >= n_rows:
            break
        start += HOP_ROWS
    return acc / cnt[:, None]


d = sys.argv[1]
for name in sys.argv[2:]:
    x = np.fromfile(f"{d}/{name}.samples.f32", "<f4")
    app = np.fromfile(f"{d}/{name}.scores.u16", "<u2").reshape(-1, C) / 65535
    ref = reference(x)
    same_shape = app.shape == ref.shape
    diff = np.abs(app - ref[: len(app)]) if same_shape or len(app) <= len(ref) else None
    print(f"{name}: samples {len(x)} ({len(x)/32000:.2f} s), rows app {app.shape[0]} ref {ref.shape[0]} "
          f"{'OK' if same_shape else 'MISMATCH'}, max |diff| {diff.max():.2e}, mean {diff.mean():.2e}, "
          f"decisions changed at 0.02: {np.mean((app >= 0.02) != (ref[:len(app)] >= 0.02)) * 100:.4f}%")
