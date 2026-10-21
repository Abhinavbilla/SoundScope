# Deploying

**The site is on Render: https://soundscope-cglz.onrender.com.** It's a static site made from `render.yaml` (Blueprint), and Render rebuilds it on every push to `main`. To update, push to GitHub. To roll back, use Render → soundscope → Events → pick an earlier deploy → "Rollback". After a deploy, run `node tools/check-site.mjs https://soundscope-cglz.onrender.com <audio> <video>`.

Cloudflare Pages was tried first and dropped on 2026-10-21. Its preview deployment and the leftover `workers.dev` worker were deleted; the empty Pages project `soundscope` is still in the account. The Cloudflare notes below are kept for reference.

The site is static: the visitor's browser does all the work. Cloudflare only serves files.

## What gets published (`npm run build:site` → `dist-site/`, about 34 MB)

- The app (about 15 MB, mostly ONNX Runtime's 14 MB WebAssembly file).
- The model, `models/efficientsed_fmn10_tf256.onnx.gz` (19.2 MB), served from the site itself. Nothing loads from Hugging Face or any other site. The build stops if this file's size or SHA-256 doesn't match `src/model/config.js`.
- `_headers` (from `site/_headers`): cross-origin isolation (for multi-threaded analysis), a strict Content-Security-Policy, and long caching for `/assets/*` and `/models/*`.
- `THIRD-PARTY-NOTICES.txt`: licences, linked from the footer credits.

Left out on purpose: `device-test.html`, the bench worker, `public/device-samples/`, and every other file in `public/models/` (old and test models, some with licences that don't allow publishing).

`/models/*` is cached for a year. A new model must get a new file name, or returning visitors keep the old one. The sha256 check would then fail and they'd see an error.

## Check before uploading

```
npm run build:site
node tools/serve-site.mjs 4174              # serves dist-site with the _headers rules, like Pages
node tools/check-site.mjs http://localhost:4174 <audio> <video>
SS_BASE=http://localhost:4174 node tools/check-ui-controls.mjs <audio>   # and the other check-*.mjs
```

`check-site.mjs` checks:
- cross-origin isolation;
- no Content-Security-Policy blocks or failed requests;
- the model comes from the site and is cached after the first visit;
- an audio file and a video analyse;
- no request goes to another site;
- the test files aren't published.

## Addresses

- Pages project `soundscope` (classic Pages; the name `soundscope.pages.dev` was taken).
- Real site: https://soundscope-e04.pages.dev (empty until the first upload to `main`).
- Preview: https://preview.soundscope-e04.pages.dev. Cloudflare marks preview addresses `noindex`.

Why classic Pages and not Workers: since 2026, `wrangler pages project create` hands new projects to Workers static assets, with a `*.workers.dev` address. This network blocks every `*.workers.dev` name (the connection times out, even on a Cloudflare IP that serves `*.pages.dev` fine), and some Indian ISPs do the same. So the project was made with `--force` once, which keeps it on classic Pages. Later commands don't need `--force`. A worker `soundscope-preview` (`*.workers.dev`) from the first try is still in the account and can be deleted.

## Upload

On this laptop `npm run` doesn't work (ComSpec), so call the tools directly:

```
node node_modules/wrangler/bin/wrangler.js login            # once, opens the browser (done)
node node_modules/vite/bin/vite.js build --mode site
node node_modules/wrangler/bin/wrangler.js pages deploy dist-site --project-name soundscope --branch preview --commit-dirty=true   # test address
node node_modules/wrangler/bin/wrangler.js pages deploy dist-site --project-name soundscope --branch main --commit-dirty=true      # the real site
```

Elsewhere, `npm run deploy:preview` and `npm run deploy` do the same.

## Live checks (preview, 2026-10-21)

`tools/check-site.mjs` passes in Edge, Chrome and Firefox:
- cross-origin isolated, Inter font loads;
- the model comes from the site and is cached after the first visit;
- audio and video analyse;
- no requests to other sites, no CSP blocks, no failed requests;
- test files not published.

Headers arrive as written in `_headers`. The model is served as `application/gzip` with no `Content-Encoding`.

First-visit model download (19.2 MB):
- **curl over HTTP/1.1:** 3.7–5.3 s once Cloudflare had the file cached near us. The very first requests after an upload were slow while it fetched the file.
- **Edge over HTTP/3:** 104 s on this network. With HTTP/3 turned off (`--disable-quic`, so HTTP/2), it's 3.5 s.

This network throttles HTTP/3 (UDP). `pages.dev` doesn't allow turning HTTP/3 off. With a custom domain on Cloudflare it's one switch (Speed → Optimization → Protocol). Worth doing if visitors report a slow first load.

## Render (chosen)

Code: https://github.com/Abhinavbilla/SoundScope (public). `render.yaml` describes the site:
- build: `npm ci && npm run build:site` (downloads the model from Hugging Face and checks its hash);
- publish: `dist-site/`;
- headers: the same as `site/_headers`;
- unknown paths go to `index.html`.

1. In Render: New → Blueprint, connect GitHub, pick `Abhinavbilla/SoundScope`, then Apply.
2. When it's live (`https://soundscope-xxxx.onrender.com`), run `node tools/check-site.mjs <that address> <audio> <video>`.
3. Compare the first-visit model download with Cloudflare.

A fresh clone was checked to build the same 34 MB `dist-site/` on its own.

Now live at https://soundscope-cglz.onrender.com, made from the Blueprint. All headers arrive as in `render.yaml`, and `check-site.mjs` passes in full: multi-threaded (a 10 min video in 8.4 s, the same as Cloudflare), model from the site and cached, no outside requests, no CSP blocks. Model over HTTP/2: 1.8 s.

The first try, https://soundscope-y3dl.onrender.com (now deleted), was created as a Static Site by hand, not as a Blueprint, so `render.yaml`'s headers weren't applied.
- No cross-origin isolation, so analysis is single-threaded: a 10 min video took 19 s, against 8.4 s on Cloudflare.
- The model gets `Cache-Control: max-age=0`. The app still keeps its own copy in the Cache API, so repeat visits don't download it again.
- Everything else in `check-site.mjs` passes. Missing files get a 404 instead of the app page.

Render's static sites are served through Cloudflare too (`Server: cloudflare`, Mumbai) and also offer HTTP/3.

Model download in Edge, fresh profile (`tools/measure-model-download.mjs`), on this network:

| Host | HTTP/3 (default) | HTTP/2 (`--disable-quic`) |
|---|---|---|
| Render | 79.3 s | 1.9 s |
| Cloudflare Pages | 104.5 s | 4.3 s |

So the slow first visit comes from this network throttling HTTP/3, not from either host. Over HTTP/2, Render was about 2 s faster here.

## Roll back

Every upload is kept. In the Cloudflare dashboard, go to Workers & Pages → soundscope → Deployments, then use "Rollback" on any earlier one. Or upload an older build again.
