import sys, json
for l in sys.stdin:
    l = l.strip()
    if not l.startswith("{"): print(l); continue
    r = json.loads(l); m = r["memMB"]; res = r["result"]; t = res.get("timings", {})
    print(f"{r['file']:16s} {r['fileMB']:5d}MB ok={res['ok']!s:5s} path={res.get('path','-'):8s} shown={r.get('durationShown')} "
          f"total={t.get('totalMs',0)/1000:6.1f}s wall={r['wallSeconds']:6.1f}s | renderer base {m['rendererBaseline']} peak {m['rendererPeak']} after {m['rendererAfter']} "
          f"| all-edge peak {m['allEdgePeak']} | commit {r['systemCommitBefore']['committedMB']}/{r['systemCommitBefore']['limitMB']} "
          f"{res.get('kind','') or ''} {res.get('detail','')[:60] if not res['ok'] else ''} {res.get('harness','')}")
