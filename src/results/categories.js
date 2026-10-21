// Friendly categories for the model's sounds, from the top level of the AudioSet ontology,
// with colour-blind-safe colours (Okabe-Ito, adjusted for dark and light backgrounds in styles.css).
// Also marks generic "background" sounds that normal users don't need to see by default.
import tree from "../model/sound-tree.json";

export const CATEGORIES = {
  human: { name: "People", color: "var(--cat-human)" },
  animal: { name: "Animals", color: "var(--cat-animal)" },
  music: { name: "Music", color: "var(--cat-music)" },
  nature: { name: "Nature", color: "var(--cat-nature)" },
  things: { name: "Things", color: "var(--cat-things)" },
  other: { name: "Other", color: "var(--cat-other)" },
  background: { name: "Background", color: "var(--cat-background)" },
};

const ROOTS = {
  "Human sounds": "human",
  Animal: "animal",
  Music: "music",
  "Natural sounds": "nature",
  "Sounds of things": "things",
  "Source-ambiguous sounds": "other",
  "Channel, environment and background": "background",
  "Unknown sound": "background",
};

// Sounds that say little about what happened. Hidden from "Sounds in this recording" and the default
// timeline rows (still searchable). Most of the ontology's "Channel, environment and background"
// branch, plus a few catch-all labels.
const GENERIC = new Set([
  "Mechanisms", "Generic impact sounds", "Sound effect", "Other sourceless", "Surface contact", "Deformable shell",
  "Sine wave", "Pulse", "Chirp tone", "Hum", "Unknown sound",
]);
const KEEP_FROM_BACKGROUND = new Set(["Television", "Radio"]);

const parents = tree.nodes.map(() => []);
tree.nodes.forEach((n, k) => n.children.forEach((c) => parents[c].push(k)));

function rootOf(k) {
  const queue = [k];
  const seen = new Set([k]);
  while (queue.length) {
    const x = queue.shift();
    if (!parents[x].length) return tree.nodes[x].name;
    for (const p of parents[x]) if (!seen.has(p)) { seen.add(p); queue.push(p); }
  }
  return null;
}

const byLabel = [];
tree.nodes.forEach((n, k) => {
  if (n.label < 0) return;
  const cat = ROOTS[rootOf(k)] ?? "other";
  byLabel[n.label] = {
    cat,
    generic: GENERIC.has(n.name) || (cat === "background" && !KEEP_FROM_BACKGROUND.has(n.name)),
  };
});

/** Category key of a model sound (index into the labels). */
export const categoryOf = (c) => byLabel[c]?.cat ?? "other";
/** True for sounds hidden by default (background noise, room tone, catch-all labels). */
export const isGeneric = (c) => !!byLabel[c]?.generic;
export const colorOf = (c) => CATEGORIES[categoryOf(c)].color;
