// Serve dist-site/ the way Cloudflare Pages will: headers from its _headers file, and index.html for
// unknown paths (Pages does that when there's no 404.html). For testing the public build before upload.
// Usage: node tools/serve-site.mjs [port=4174] [dir=dist-site]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const port = Number(process.argv[2]) || 4174;
const root = path.resolve(process.argv[3] || "dist-site");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8", ".gz": "application/gzip",
};

// _headers: a line starting at column 0 is a path pattern (* = anything), indented lines are "Name: value".
const rules = [];
for (const line of fs.readFileSync(path.join(root, "_headers"), "utf8").split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  if (!/^\s/.test(line)) rules.push({ re: new RegExp(`^${line.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`), headers: [] });
  else rules.at(-1).headers.push(line.trim().split(/:\s*(.*)/s).slice(0, 2));
}

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(root, url === "/" ? "index.html" : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory() || path.basename(file) === "_headers") {
    file = path.join(root, "index.html");
  }
  for (const r of rules) if (r.re.test(url)) for (const [k, v] of r.headers) res.setHeader(k, v);
  res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
  res.setHeader("Content-Length", fs.statSync(file).size);
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}/`));
