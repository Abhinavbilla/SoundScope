// Search sounds by name. Each query word may match the sound's own name or the name of any group
// above it in the AudioSet ontology, so "dog" finds Dog plus Bark, Howl, Growling..., and
// "door knock" finds Knock (it sits under Door). The everyday names shown in the app match too.
import tree from "../model/sound-tree.json";
import { plainName } from "./names.js";

const words = (text) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const nodeWords = tree.nodes.map((n) => words(n.name === plainName(n.name) ? n.name : `${n.name} ${plainName(n.name)}`));

// For each node, the nodes above it (all paths).
const parents = tree.nodes.map(() => []);
tree.nodes.forEach((n, k) => n.children.forEach((c) => parents[c].push(k)));
const ancestors = tree.nodes.map((_, k) => {
  const out = [];
  const seen = new Set();
  const stack = [...parents[k]];
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    stack.push(...parents[p]);
  }
  return out; // nearest first along each path
});
const soundNodes = tree.nodes.map((n, k) => k).filter((k) => tree.nodes[k].label >= 0);

// Query word q matches name word w: the same word, a plural/singular of it, or (4+ letters) the
// start of it. Short prefixes only count when nothing else matches ("car" shouldn't find "carbon").
function wordMatch(q, w, loose) {
  if (w === q || w === `${q}s` || w === `${q}es` || (q.endsWith("s") && w === q.slice(0, -1))) return true;
  return (loose || q.length >= 4) && w.startsWith(q);
}

const nameHas = (k, q, loose) => nodeWords[k].some((w) => wordMatch(q, w, loose));

function find(qs, loose) {
  const out = [];
  for (const k of soundNodes) {
    let own = 0;
    let via = null;
    let all = true;
    for (const q of qs) {
      if (nameHas(k, q, loose)) { own++; continue; }
      const a = ancestors[k].find((p) => nameHas(p, q, loose));
      if (a === undefined) { all = false; break; }
      via ??= a;
    }
    if (!all) continue;
    const name = tree.nodes[k].name;
    const first = words(name.split(",")[0]).join(" ");
    out.push({
      c: tree.nodes[k].label,
      direct: own === qs.length,
      via: own === qs.length ? null : plainName(tree.nodes[via].name),
      exact: first === qs.join(" ") || words(name).join(" ") === qs.join(" ") || words(plainName(name)).join(" ") === qs.join(" "),
      own,
    });
  }
  return out;
}

// ---- typos: every word used in a name (or group name), and how many names use it
const vocab = new Map();
for (const ws of nodeWords) for (const w of new Set(ws)) if (!/^\d+$/.test(w)) vocab.set(w, (vocab.get(w) ?? 0) + 1);

/** Damerau (optimal string alignment) distance: insert, delete, change or swap two neighbouring letters. */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** q's letters appear in w in order ("anmal" in "animal"). */
function isSubsequence(q, w) {
  let i = 0;
  for (const ch of w) if (ch === q[i]) i++;
  return i === q.length;
}

/**
 * Name words a mistyped query word may have meant, likeliest first (at most 3). Up to 2 left-out letters
 * ("anmal" -> animal, same first letter, 3+ letters typed), or 1 wrong, extra or swapped letter (2 for 7+
 * letters): "dgo" -> dog, "sirne" -> siren. At the same cost, left-out letters win ("dor" -> door, not
 * dog), then the word more names use, then the shorter one.
 */
function candidates(q) {
  if (q.length < 3) return [];
  const maxEdits = q.length >= 7 ? 2 : 1;
  const found = [];
  for (const [w, n] of vocab) {
    let cost = Infinity;
    let sub = false;
    if (w[0] === q[0] && w.length > q.length && w.length - q.length <= 2 && isSubsequence(q, w)) {
      cost = w.length - q.length;
      sub = true;
    }
    if (Math.abs(w.length - q.length) <= maxEdits) {
      const d = distance(q, w);
      if (d < cost && d <= maxEdits) { cost = d; sub = false; }
    }
    if (cost !== Infinity) found.push({ w, n, cost, sub });
  }
  found.sort((a, b) => (a.cost - b.cost) || (b.sub - a.sub) || (b.n - a.n) || (a.w.length - b.w.length));
  return found.slice(0, 3).map((f) => f.w);
}

/** Typed word q is close to word w by the same rules as sound names: up to 2 left-out letters, or 1 wrong, extra or swapped letter (2 for 7+). */
function close(q, w) {
  if (q.length < 3) return false;
  if (w[0] === q[0] && w.length > q.length && w.length - q.length <= 2 && isSubsequence(q, w)) return true;
  const maxEdits = q.length >= 7 ? 2 : 1;
  return Math.abs(w.length - q.length) <= maxEdits && distance(q, w) <= maxEdits;
}

/**
 * How well a bookmark note matches a query: 2 = every query word is in the note as typed (any case, any
 * order), 1 = every word is there or close to one of the note's words ("neigbor" -> neighbour's,
 * "brthday" -> birthday), 0 = no match.
 */
export function noteMatch(note, query) {
  const qs = words(query);
  if (!note || !qs.length) return 0;
  const text = note.toLowerCase();
  if (qs.every((q) => text.includes(q))) return 2;
  const ws = words(note);
  return qs.every((q) => text.includes(q) || ws.some((w) => close(q, w) || close(q, w.replace(/s$/, "")))) ? 1 : 0;
}

function search(qs) {
  let out = find(qs, false);
  if (!out.length) out = find(qs, true);
  return out;
}

const knownWord = (q) => nodeWords.some((ws) => ws.some((w) => wordMatch(q, w, true)));

/**
 * @returns {{c: number, direct: boolean, via: string|null, exact: boolean}[]} matching model sounds:
 *   direct = every query word is in the sound's own name; via = the group that matched otherwise.
 *   Exact names first, then direct matches, then the rest by how many words the own name matched.
 *   Empty for an empty query. When nothing matches because of a typo or a split word, the query is
 *   corrected and searched again; the array then has `corrected` set to the query that was used ("animal").
 */
export function searchSounds(query) {
  const qs = words(query);
  if (!qs.length) return [];
  const out = searchWords(qs);
  if (out.length || qs.length < 2) return out;
  const joined = searchWords([qs.join("")]); // "foot steps" -> footsteps
  if (joined.length) joined.corrected ??= qs.join("");
  return joined;
}

function searchWords(qs) {
  let out = search(qs);
  if (!out.length) {
    // each unknown word's candidates, tried in order of likelihood until a combination finds something
    const options = qs.map((q) => (knownWord(q) ? [q] : candidates(q)));
    if (options.every((o) => o.length) && options.some((o, i) => o[0] !== qs[i])) {
      let combos = [[]];
      for (const o of options) combos = combos.flatMap((c) => o.map((w) => [...c, w]));
      for (const fixed of combos) {
        const found = search(fixed);
        if (found.length) {
          out = found;
          out.corrected = fixed.join(" ");
          break;
        }
      }
    }
  }
  return out.sort((a, b) => (b.exact - a.exact) || (b.direct - a.direct) || (b.own - a.own)); // in place, keeps `corrected`
}
