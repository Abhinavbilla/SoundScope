// Memory fix for Mediabunny's frame-by-frame demuxers (MP3, ADTS/AAC, FLAC; mediabunny 1.61.x).
//
// These demuxers keep one JavaScript object per audio frame they have read ("loadedSamples", so
// they can seek back): ~150,000 objects per hour of MP3, never released. We measured page memory
// growing ~30-40 MB per hour of MP3 (10 h file: 400 -> 635 MB). The subclasses in this folder swap
// that list for typed arrays behind the same array-like interface the demuxers use
// (push, length, [index]). Mediabunny's own files are not modified.
//
// Wired in by the `mediabunnyFrameIndex` plugin in vite.config.js. Remove this folder and the
// plugin if upstream changes how frames are stored.

const PAGE_BITS = 16;
const PAGE = 1 << PAGE_BITS; // entries per page
const MASK = PAGE - 1;

/**
 * Array-like frame list stored in fixed-size typed-array pages (no copying as it grows).
 * A field that has had the same value for every frame so far (e.g. frame duration) is stored
 * once; it switches to pages the first time a different value arrives.
 * @param {Record<string, Float64ArrayConstructor | Uint32ArrayConstructor>} fields
 *   field name -> typed array type, e.g. { timestamp: Float64Array, dataSize: Uint32Array }
 */
export function createFrameIndex(fields) {
  const names = Object.keys(fields);
  const types = names.map((n) => fields[n]);
  const pages = names.map(() => []); // per field: list of typed-array pages (empty while constant)
  const constant = names.map(() => true);
  const constValue = names.map(() => undefined);
  let len = 0;

  function materialize(k) {
    // Fill pages up to the current length with the constant value, then switch to per-frame storage.
    const lastPage = len >> PAGE_BITS;
    for (let q = 0; q <= lastPage; q++) {
      const page = new types[k](PAGE);
      page.fill(constValue[k], 0, q < lastPage ? PAGE : len & MASK);
      pages[k].push(page);
    }
    constant[k] = false;
  }

  const target = {
    push(entry) {
      const p = len >> PAGE_BITS, o = len & MASK;
      for (let k = 0; k < names.length; k++) {
        const v = entry[names[k]];
        if (constant[k]) {
          if (len === 0) { constValue[k] = v; continue; }
          if (Object.is(v, constValue[k])) continue;
          materialize(k);
        }
        let page = pages[k][p];
        if (!page) {
          page = new types[k](PAGE);
          pages[k][p] = page;
        }
        page[o] = v;
      }
      return ++len;
    },
  };

  return new Proxy(target, {
    get(t, prop) {
      if (prop === "length") return len;
      if (prop === "push") return t.push;
      if (typeof prop === "string") {
        const i = Number(prop);
        if (Number.isInteger(i) && i >= 0) {
          if (i >= len) return undefined;
          const entry = {};
          for (let k = 0; k < names.length; k++) {
            entry[names[k]] = constant[k] ? constValue[k] : pages[k][i >> PAGE_BITS][i & MASK];
          }
          return entry;
        }
      }
      return undefined;
    },
  });
}

// Byte offsets and sample positions use Float64 (exact up to 2^53, so files over 4 GB are fine).
export const PACKET_FIELDS = { timestamp: Float64Array, duration: Float64Array, dataStart: Float64Array, dataSize: Uint32Array };
export const FLAC_FIELDS = { blockOffset: Float64Array, blockSize: Uint32Array, byteOffset: Float64Array, byteSize: Uint32Array };
