import sys, json
for l in sys.stdin:
    l = l.strip()
    if not l.startswith("{"): print("  ", l[:200]); continue
    r = json.loads(l); m = r["memMB"]; res = r["result"]; t = res.get("timings", {})
    dur = res.get("duration") or 0
    spm = f"{t['inferenceMs']/1000/(dur/60):.2f}s/min" if t.get("inferenceMs") and dur else "-"
    print(f"{r['file']:14s} ok={res['ok']!s:5s} {res.get('path','-'):8s} shown={r.get('durationShown')} total={t.get('totalMs',0)/1000:6.1f}s model={spm} "
          f"threads={t.get('threads','-')} | page peak {m['rendererPeak']} MB, all peak {m['allEdgePeak']} MB "
          f"{'' if res['ok'] else '| ' + str(res.get('message') or res.get('harness'))[:90]}")
