// Bookmarks in IndexedDB, per file (name, size, last modified), so they survive reloads and a model
// change. If IndexedDB isn't available (some private windows), bookmarks live only in this tab.

const DB = "soundscope";
const STORE = "bookmarks";
let dbPromise = null;
const memory = new Map(); // fallback: id -> bookmark

/** Key for a file's bookmarks: SHA-256 of name, size and date (16 bytes, hex). */
export async function fileKey(file) {
  const text = `${file.name}|${file.size}|${file.lastModified}`;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function open() {
  dbPromise ??= new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: "id" });
      s.createIndex("file", "file");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
  });
}

/** True if bookmarks are kept after the tab closes. */
export async function bookmarksPersist() {
  return !!(await open());
}

/** All bookmarks of a file, in time order. */
export async function listBookmarks(file) {
  const db = await open();
  const all = db
    ? await run(db, "readonly", (s) => s.index("file").getAll(file))
    : [...memory.values()].filter((b) => b.file === file);
  return all.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Add or update. A bookmark: { id, file, start, end, label, confidence (or null), note, createdAt } */
export async function saveBookmark(b) {
  const db = await open();
  if (db) await run(db, "readwrite", (s) => s.put(b));
  else memory.set(b.id, b);
}

export async function deleteBookmark(id) {
  const db = await open();
  if (db) await run(db, "readwrite", (s) => s.delete(id));
  else memory.delete(id);
}
