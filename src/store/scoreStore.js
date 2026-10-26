// Saved analysis results in the Origin Private File System (OPFS), so full-resolution scores
// never have to sit in page memory, and reopening the same file is instant.
//
// Per result (key = hash of file name, size, last modified, model id):
//   <key>.scores    full scores, 1 byte each, in blocks of BLOCK_ROWS rows; inside a block the
//                   bytes are class-major (all rows of class 0, then class 1, ...), so reading one
//                   sound's timeline is one small read per block
//   <key>.overview  max per 1 s per class (rows x classes, row-major), kept in memory by the page
//   <key>.peaks     waveform peaks (Float32)
//   <key>.json      metadata, written last; "complete": true marks a finished result
//
// Writing uses sync access handles (dedicated workers only, supported by Chrome, Firefox, Safari).
// Reading uses the async File API, so the page can do it after the worker has finished.

const DIR = "results";
const VERSION = 1;
export const BLOCK_ROWS = 7500; // 5 min at 40 ms

export function storeSupported() {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
}

async function dir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

export async function resultKey(file, modelId) {
  const text = `${file.name}|${file.size}|${file.lastModified}|${modelId}|v${VERSION}`;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function scoreBytes(rows, classes) {
  return rows * classes;
}

// ---------------------------------------------------------------- writing (worker only)

async function syncHandle(d, name) {
  const fh = await d.getFileHandle(name, { create: true });
  const h = await fh.createSyncAccessHandle();
  h.truncate(0);
  return h;
}

/**
 * Collects finished score rows. Always computes the per-second overview and per-class max;
 * also writes full scores to OPFS unless `persist` is false (no OPFS, no space, or locked).
 * If a write fails later (e.g. the storage quota runs out mid-file), saving stops, the partial
 * files are deleted and the analysis carries on without them (`failed` says why).
 */
export async function createWriter({ key, classes, rowsPerSecond, persist }) {
  let d = null, scoresH = null;
  if (persist) {
    try {
      d = await dir();
      scoresH = await syncHandle(d, `${key}.scores`);
    } catch {
      scoresH = null; // e.g. the same file is being analysed in another tab
    }
  }
  let block = scoresH ? new Uint8Array(BLOCK_ROWS * classes) : null; // row-major
  const blockCm = scoresH ? new Uint8Array(BLOCK_ROWS * classes) : null; // class-major
  let failed = null; // "no-space" or "write-error" once a write has failed
  let blockFill = 0, blockIndex = 0, rows = 0;

  const overviewParts = [];
  const second = new Uint8Array(classes); // running max for the current second
  let secondFill = 0;
  const classMax = new Uint8Array(classes);

  function giveUp(e) {
    failed = e?.name === "QuotaExceededError" ? "no-space" : "write-error";
    try { scoresH.close(); } catch { /* already closed */ }
    scoresH = null;
    block = null;
    deleteResult(key, d).catch(() => {});
  }

  function writeBlock() {
    const n = blockFill;
    for (let r = 0; r < n; r++) {
      const src = r * classes;
      for (let c = 0; c < classes; c++) blockCm[c * n + r] = block[src + c];
    }
    blockIndex++;
    blockFill = 0;
    try {
      scoresH.write(blockCm.subarray(0, n * classes), { at: (blockIndex - 1) * BLOCK_ROWS * classes });
    } catch (e) {
      giveUp(e);
    }
  }

  return {
    get persisted() { return !!scoresH; },
    get failed() { return failed; },
    /** rows: Uint8Array, rows x classes, row-major. Returns new overview rows (Uint8Array). */
    push(rowsU8) {
      const n = rowsU8.length / classes;
      const newOverview = [];
      for (let r = 0; r < n; r++) {
        const src = r * classes;
        for (let c = 0; c < classes; c++) {
          const v = rowsU8[src + c];
          if (v > second[c]) second[c] = v;
          if (v > classMax[c]) classMax[c] = v;
        }
        if (++secondFill === rowsPerSecond) {
          newOverview.push(second.slice());
          second.fill(0);
          secondFill = 0;
        }
        if (block) {
          block.set(rowsU8.subarray(src, src + classes), blockFill * classes);
          if (++blockFill === BLOCK_ROWS) writeBlock();
        }
      }
      rows += n;
      const out = new Uint8Array(newOverview.length * classes);
      newOverview.forEach((row, i) => out.set(row, i * classes));
      overviewParts.push(out);
      return out;
    },
    /**
     * Flush the last block and the last partial second, then (if persisting) write overview,
     * peaks and finally the metadata. Returns { overviewTail, classMax, rows }.
     */
    async finish(meta, peaks) {
      let tail = new Uint8Array(0);
      if (secondFill) {
        tail = second.slice();
        overviewParts.push(tail);
      }
      const result = { overviewTail: tail, classMax, rows };
      if (!scoresH) return result;
      if (blockFill) writeBlock();
      if (!scoresH) return result;
      const overview = concat(overviewParts);
      let h = scoresH;
      try {
        h.flush();
        h.close();
        h = null;
        const json = new TextEncoder().encode(JSON.stringify({
          version: VERSION, complete: true, rows, classes, blockRows: BLOCK_ROWS, rowsPerSecond,
          bytes: rows * classes + overview.length + peaks.byteLength,
          createdAt: Date.now(), lastUsed: Date.now(), ...meta,
        }));
        const files = [[`${key}.overview`, overview],
          [`${key}.peaks`, new Uint8Array(peaks.buffer, peaks.byteOffset, peaks.byteLength)], [`${key}.json`, json]];
        for (const [name, data] of files) { // metadata last: it marks the result complete
          h = await syncHandle(d, name);
          if (h.write(data, { at: 0 }) < data.length) throw new DOMException("short write", "QuotaExceededError");
          h.flush();
          h.close();
          h = null;
        }
      } catch (e) {
        scoresH = h ?? scoresH;
        giveUp(e);
      }
      return result;
    },
  };
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------------------------------------------------------------- reading (page or worker)

async function readFile(d, name) {
  const fh = await d.getFileHandle(name);
  return (await fh.getFile()).arrayBuffer();
}

/** Metadata + overview + peaks of a finished result, or null. */
export async function loadResult(key) {
  if (!storeSupported()) return null;
  try {
    const d = await dir();
    const meta = JSON.parse(new TextDecoder().decode(await readFile(d, `${key}.json`)));
    if (meta.version !== VERSION || !meta.complete) return null;
    const overview = new Uint8Array(await readFile(d, `${key}.overview`));
    const peaks = new Float32Array(await readFile(d, `${key}.peaks`));
    return { key, meta, overview, peaks };
  } catch {
    return null;
  }
}

/** Full-resolution timeline of one class (Uint8Array, one byte per row). */
export async function readClass(key, meta, c) {
  const d = await dir();
  const file = await (await d.getFileHandle(`${key}.scores`)).getFile();
  const { rows, classes, blockRows } = meta;
  const out = new Uint8Array(rows);
  const reads = [];
  for (let b = 0, start = 0; start < rows; b++, start += blockRows) {
    const n = Math.min(blockRows, rows - start);
    const at = b * blockRows * classes + c * n;
    reads.push(file.slice(at, at + n).arrayBuffer().then((buf) => out.set(new Uint8Array(buf), start)));
  }
  await Promise.all(reads);
  return out;
}

/** Test only: rebuild the full row-major score matrix (small files only). */
export async function readAll(key, meta) {
  const { rows, classes } = meta;
  const out = new Uint8Array(rows * classes);
  for (let c = 0; c < classes; c++) {
    const col = await readClass(key, meta, c);
    for (let r = 0; r < rows; r++) out[r * classes + c] = col[r];
  }
  return out;
}

// ---------------------------------------------------------------- housekeeping

async function listMetas(d) {
  const metas = [];
  const keys = new Set();
  for await (const [name] of d.entries()) keys.add(name.split(".")[0]);
  for (const key of keys) {
    let meta = null;
    try {
      meta = JSON.parse(new TextDecoder().decode(await readFile(d, `${key}.json`)));
    } catch {
      // no metadata: unfinished or cancelled
    }
    metas.push({ key, meta });
  }
  return metas;
}

export async function deleteResult(key, d) {
  d ??= await dir();
  for (const ext of ["json", "scores", "overview", "peaks"]) {
    try { await d.removeEntry(`${key}.${ext}`); } catch { /* not there */ }
  }
}

/**
 * Delete results that never finished (cancelled or crashed runs), except `keepKey`.
 * A result another tab is still writing is locked, so removing it fails and it is skipped.
 */
export async function removeUnfinished(keepKey) {
  const d = await dir();
  for (const m of await listMetas(d)) {
    if (m.key !== keepKey && !m.meta?.complete) await deleteResult(m.key, d);
  }
}

/**
 * Make room for `need` bytes: delete unfinished results first, then the least recently used
 * finished ones (never `keepKey`). Returns true if there is enough space.
 */
export async function ensureSpace(need, keepKey) {
  const margin = 50 * 1024 * 1024;
  const free = async () => {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    return quota - usage;
  };
  if ((await free()) > need + margin) return true;
  const d = await dir();
  // copies made for playback go first: they can always be made again
  await (await navigator.storage.getDirectory()).removeEntry("playable", { recursive: true }).catch(() => {});
  if ((await free()) > need + margin) return true;
  const metas = (await listMetas(d)).filter((m) => m.key !== keepKey);
  metas.sort((a, b) => (a.meta ? a.meta.lastUsed : -1) - (b.meta ? b.meta.lastUsed : -1));
  for (const m of metas) {
    await deleteResult(m.key, d);
    if ((await free()) > need + margin) return true;
  }
  return (await free()) > need + margin;
}

/** Mark a result as just used (for least-recently-used cleanup). Best effort. */
export async function touchResult(key, meta) {
  try {
    const d = await dir();
    const fh = await d.getFileHandle(`${key}.json`);
    if (!fh.createWritable) return; // Safari: only sync handles (workers)
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ ...meta, lastUsed: Date.now() }));
    await w.close();
  } catch {
    // ignore
  }
}

/** For tests and a future settings page. */
export async function listResults() {
  if (!storeSupported()) return [];
  return (await listMetas(await dir())).map(({ key, meta }) => ({ key, ...meta }));
}
