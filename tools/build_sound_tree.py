"""Build src/model/sound-tree.json: the AudioSet ontology trimmed to what search needs.

Each model label is placed in the ontology by its AudioSet ID (class_labels_indices_strong.csv from
PretrainedSED); 11 of them are in the ontology under slightly different names. 31 newer "strong"
labels aren't in the ontology at all: EXTRA_PARENTS gives them parents by hand (my own choice, not
from AudioSet). Nodes without any model label below them are dropped.

Output: {"nodes": [{"name", "label" (model class index or -1), "children": [node indexes]}],
         "roots": [node indexes]}
The ontology is CC BY-SA 4.0 (Google), so this derived file is too.
Usage: python -I tools/build_sound_tree.py   (model-check venv; ontology in model-check/ontology/)
"""
import csv
import json

ONT = "model-check/ontology/ontology.json"
MIDS = "model-check/pretrainedsed/hf_dataset_gen/metadata/class_labels_indices_strong.csv"
LABELS = "src/model/audioset-strong-labels.json"
OUT = "src/model/sound-tree.json"

EXTRA_PARENTS = {
    "Alert": ["Alarm"],
    "Audio logo": ["Music"],
    "Bathroom sounds": ["Domestic sounds, home sounds"],
    "Brief tone": ["Beep, bleep"],
    "Carbon monoxide detector, CO detector": ["Alarm"],
    "Cart": ["Non-motorized land vehicle"],
    "Chain": ["Mechanisms"],
    "Crockery breaking and smashing": ["Breaking", "Dishes, pots, and pans"],
    "Dong, bong": ["Bell"],
    "Electric rotor drone, quadcopter": ["Aircraft"],
    "Error signal": ["Beep, bleep"],
    "Keypress tone": ["Telephone"],
    "Kitchen and dining room sounds": ["Domestic sounds, home sounds"],
    "Knife": ["Cutlery, silverware"],
    "Lock": ["Door", "Mechanisms"],
    "Mechanical bell": ["Bell"],
    "Pant (dog)": ["Dog"],
    "Paper rustling": ["Rustle"],
    "Power saw, circular saw, table saw": ["Power tool"],
    "Refrigerator": ["Domestic sounds, home sounds"],
    "Ringing tone, ringback tone": ["Telephone"],
    "Shower": ["Bathroom sounds", "Water"],
    "Slurp, drinking straw": ["Digestive"],
    "Stairs": ["Walk, footsteps"],
    "Stomp, stamp": ["Walk, footsteps"],
    "Sweeping": ["Domestic sounds, home sounds"],
    "Tap dance": ["Walk, footsteps"],
    "Unknown sound": [],
    "Video game sound": ["Sound effect"],
    "Washing machine": ["Domestic sounds, home sounds"],
    "Windscreen wiper, windshield wiper": ["Car"],
}

ont = json.load(open(ONT, encoding="utf-8"))
labels = json.load(open(LABELS, encoding="utf-8"))
mid_of = {name: mid for mid, name in csv.reader(open(MIDS, encoding="utf-8"))}
by_id = {n["id"]: n for n in ont}
id_of_name = {n["name"]: n["id"] for n in ont}

# graph over ids: ontology edges + new labels as extra nodes
children = {n["id"]: list(n["child_ids"]) for n in ont}
name = {n["id"]: n["name"] for n in ont}
label_of = {}
for i, lab in enumerate(labels):
    mid = mid_of[lab]
    if mid not in by_id:
        assert lab in EXTRA_PARENTS, f"no ontology node and no hand-picked parent: {lab}"
        children.setdefault(mid, [])
        for p in EXTRA_PARENTS[lab]:
            pid = mid_of.get(p) if mid_of.get(p) in children else id_of_name[p]
            children[pid].append(mid)
    name[mid] = lab  # the model's name, which is what users see
    label_of[mid] = i
missing = set(EXTRA_PARENTS) - set(labels)
assert not missing, missing

# keep only nodes with a model label at or below them
keep = {}
def has_label(nid, seen=()):
    if nid in keep:
        return keep[nid]
    if nid in seen:
        return False
    r = nid in label_of or any(has_label(c, seen + (nid,)) for c in children.get(nid, []))
    keep[nid] = r
    return r
for nid in list(children):
    has_label(nid)

ids = [nid for nid in children if keep[nid]]
index = {nid: k for k, nid in enumerate(ids)}
nodes = [{"name": name[nid], "label": label_of.get(nid, -1),
          "children": sorted({index[c] for c in children[nid] if keep.get(c)})} for nid in ids]
has_parent = {c for n in nodes for c in n["children"]}
roots = [k for k in range(len(nodes)) if k not in has_parent]
assert sorted(n["label"] for n in nodes if n["label"] >= 0) == list(range(len(labels)))
json.dump({"nodes": nodes, "roots": roots}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"{len(nodes)} nodes ({sum(n['label'] >= 0 for n in nodes)} model sounds), {len(roots)} roots: "
      + ", ".join(nodes[r]["name"] for r in roots))
