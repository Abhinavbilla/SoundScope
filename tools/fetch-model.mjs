// Make sure public/models has the app's model before a site build. The model isn't in git (it's 19 MB);
// on a build server (Render, Cloudflare) this downloads it from the public Hugging Face copy, then checks
// its size and SHA-256 against src/model/config.js. Does nothing if a good copy is already there.
// Usage: node tools/fetch-model.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";

const NAME = "efficientsed_fmn10_tf256.onnx.gz";
const SOURCE = `https://huggingface.co/Abhinavbilla/efficientsed-fmn10-tf256-onnx/resolve/main/${NAME}`;
const out = new URL(`../public/models/${NAME}`, import.meta.url);

const cfg = fs.readFileSync(new URL("../src/model/config.js", import.meta.url), "utf8");
const size = Number(/^\s*sizeBytes: ([\d_]+)/m.exec(cfg)[1].replace(/_/g, ""));
const sha256 = /^\s*sha256: "([0-9a-f]+)"/m.exec(cfg)[1];
const good = (buf) => buf.length === size && crypto.createHash("sha256").update(zlib.gunzipSync(buf)).digest("hex") === sha256;

if (fs.existsSync(out) && good(fs.readFileSync(out))) {
  console.log(`model: public/models/${NAME} is already there and matches`);
} else {
  console.log(`model: downloading ${SOURCE}`);
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!good(buf)) throw new Error(`model download doesn't match config.js (got ${buf.length} bytes)`);
  fs.mkdirSync(new URL("../public/models/", import.meta.url), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log(`model: saved public/models/${NAME} (${buf.length} bytes, hash ok)`);
}
