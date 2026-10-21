// Check the paged frame index against a plain array. Usage: node tools/test-frame-index.mjs
import { createFrameIndex, FLAC_FIELDS, PACKET_FIELDS } from "../src/vendor/mediabunny-frame-index.js";

let failed = 0;
function check(name, fields, n, make) {
  const idx = createFrameIndex(fields);
  const ref = [];
  for (let i = 0; i < n; i++) {
    const e = make(i);
    ref.push(e);
    idx.push(e);
  }
  let bad = idx.length !== ref.length ? `length ${idx.length} vs ${ref.length}` : null;
  for (let i = 0; i < n && !bad; i++) {
    const a = idx[i], b = ref[i];
    for (const k of Object.keys(fields)) {
      if (!Object.is(a[k], b[k])) bad = `index ${i} field ${k}: ${a[k]} vs ${b[k]}`;
    }
  }
  if (idx[n] !== undefined || idx[-1] !== undefined) bad ??= "out-of-range access returned a value";
  console.log(`${bad ? "FAIL" : "ok  "} ${name} (${n} entries)${bad ? ": " + bad : ""}`);
  if (bad) failed++;
}

const P = 1 << 16;
// MP3-like: constant duration, offsets above 4 GB, sizes vary
check("packets, constant duration", PACKET_FIELDS, 3 * P + 123, (i) => ({
  timestamp: (i * 1152) / 48000, duration: 1152 / 48000, dataStart: 5e9 + i * 417 + (i % 7), dataSize: 417 + (i % 2),
}));
// duration changes exactly at a page boundary, and again later
check("duration changes at page boundary", PACKET_FIELDS, 2 * P + 10, (i) => ({
  timestamp: i * 0.024, duration: i < P ? 0.024 : i < P + 5 ? 0.012 : 0.024, dataStart: i * 100, dataSize: 100,
}));
// a field changes at entry 1 (smallest possible materialisation)
check("changes at entry 1", PACKET_FIELDS, 1000, (i) => ({ timestamp: i, duration: i === 0 ? 1 : 2, dataStart: i, dataSize: 3 }));
// everything constant
check("all constant except timestamp", PACKET_FIELDS, P + 1, (i) => ({ timestamp: i, duration: 0.5, dataStart: 7, dataSize: 9 }));
// FLAC fields
check("flac", FLAC_FIELDS, 2 * P + 1, (i) => ({ blockOffset: i * 4096, blockSize: i === 2 * P ? 1200 : 4096, byteOffset: 1e10 + i * 9000, byteSize: 9000 + (i % 13) }));
// empty
check("empty", PACKET_FIELDS, 0, () => ({}));
process.exit(failed ? 1 : 0);
