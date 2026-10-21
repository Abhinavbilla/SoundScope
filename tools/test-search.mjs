// Checks for src/results/search.js. Usage: node tools/test-search.mjs [query ...] (no args: run the checks)
import assert from "node:assert/strict";
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
export async function load(url, context, next) {
  if (url.endsWith(".json")) return next(url, { ...context, importAttributes: { type: "json" } });
  return next(url, context);
}`));
const { noteMatch, searchSounds } = await import("../src/results/search.js");
const { MODEL } = await import("../src/model/config.js");
const names = (q) => searchSounds(q).map((r) => MODEL.labels[r.c]);

const queries = process.argv.slice(2);
if (queries.length) {
  for (const q of queries) {
    const r = searchSounds(q);
    console.log(`"${q}" (${r.length}): ` + r.map((x) => MODEL.labels[x.c] + (x.direct ? "" : ` <${x.via}>`)).join(" | "));
  }
} else {
  const dog = names("dog");
  for (const s of ["Dog", "Bark", "Howl", "Growling", "Pant (dog)"]) assert.ok(dog.includes(s), `dog -> ${s}`);
  assert.equal(dog[0], "Dog"); // exact name first
  assert.ok(!names("car").includes("Carbon monoxide detector, CO detector")); // whole words only
  assert.ok(names("car").includes("Vehicle horn, car horn, honking, toot"));
  assert.ok(names("dogs").includes("Dog")); // plural query
  assert.ok(names("chew").includes("Chewing, mastication")); // 4-letter prefix
  assert.ok(names("do").length > 0); // nothing whole-word: short prefix as a fallback
  assert.deepEqual(names(""), []);
  assert.deepEqual(names("xyzzy"), []);
  assert.ok(names("door knock").includes("Knock")); // words can match a group above the sound
  assert.ok(names("aeroplane").includes("Fixed-wing aircraft, airplane")); // the everyday name shown in the app
  assert.ok(names("tyres").includes("Tire squeal, skidding"));
  assert.equal(names("woman speaking")[0], "Female speech, woman speaking");
  assert.ok(names("dtmf").includes("Telephone dialing, DTMF")); // original names still work
  // typos: left-out letters, a wrong/extra/swapped letter, split words
  assert.equal(searchSounds("anmal").corrected, "animal");
  assert.ok(names("anmal").includes("Dog"));
  assert.equal(searchSounds("dgo").corrected, "dog");
  assert.equal(names("dgo")[0], "Dog");
  assert.equal(searchSounds("dor knok").corrected, "door knock");
  assert.ok(names("dor knok").includes("Knock"));
  assert.equal(searchSounds("sirne").corrected, "siren");
  assert.equal(searchSounds("foot steps").corrected, "footsteps");
  assert.equal(searchSounds("dog").corrected, undefined); // right spelling: no correction
  assert.deepEqual(names("xy"), []); // too short to guess
  // bookmark notes: exact words (2), typos like sound names (1), no match (0)
  assert.equal(noteMatch("Riya laughing at the cake", "CAKE riya"), 2);
  assert.equal(noteMatch("Riya laughing at the cake", "ckae"), 1);
  assert.equal(noteMatch("neighbour's dog again", "neigbor"), 1);
  assert.equal(noteMatch("Happy birthday song", "brthday"), 1);
  assert.equal(noteMatch("Happy birthday song", "xyz"), 0);
  assert.equal(noteMatch("", "cake"), 0);
  console.log("all search checks passed");
}
