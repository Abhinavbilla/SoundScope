import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FolderOpen, Laptop, Lock, Moon, Sun, Upload, X } from "lucide-react";
import { openAudioFile } from "./audio/openFile.js";
import { DecodeError } from "./audio/decode.js";
import { downsamplePeaks } from "./audio/peaks.js";
import { MODEL } from "./model/config.js";
import { formatDuration, formatEta } from "./results/format.js";
import { plainName } from "./results/names.js";
import Results from "./components/Results.jsx";

const CLASSES = MODEL.labels.length;
const NAMES = MODEL.labels.map(plainName); // everyday names shown in the app
const ACCEPT = "audio/*,video/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.mp4,.m4v,.mov,.webm,.mkv,.ts";

/** Collects 1-second overview rows as chunks finish, for live results. */
function liveOverview() {
  let buf = new Uint8Array(0);
  let filled = 0;
  return {
    push(rows) {
      if (filled + rows.length > buf.length) {
        const grown = new Uint8Array(Math.max(filled + rows.length, buf.length * 2, 600 * CLASSES));
        grown.set(buf.subarray(0, filled));
        buf = grown;
      }
      buf.set(rows, filled);
      filled += rows.length;
    },
    view: () => buf.subarray(0, filled),
  };
}

const debug = () => import.meta.env.DEV || window.__soundscopeDebug;

/** Theme choice (system / light / dark), remembered in this browser; returns the choice and what's showing. */
function useTheme() {
  const [choice, setChoice] = useState(() => {
    try { return localStorage.getItem("soundscope-theme") || "system"; } catch { return "system"; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    if (choice === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = choice;
    try { localStorage.setItem("soundscope-theme", choice); } catch { /* private mode */ }
  }, [choice]);
  const shown = choice === "system" ? (systemDark ? "dark" : "light") : choice;
  return [choice, setChoice, shown];
}

export default function App() {
  const [state, setState] = useState({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const [player, setPlayer] = useState(null);
  const [themeChoice, setThemeChoice, theme] = useTheme();
  if (debug()) {
    window.__soundscopePlayer = player;
    // test only: time clip export on any file without analysing it first
    window.__soundscopeClipTest = async (file, clips, duration) => {
      const { makeClips } = await import("./export/exportFiles.js");
      const sizes = [];
      const t = performance.now();
      await makeClips(file, clips, duration, async (name, bytes) => { sizes.push([name, bytes.length]); });
      return { ms: performance.now() - t, sizes };
    };
  }
  const job = useRef(null);

  // Drop a file anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const enter = (e) => { if (hasFiles(e)) { depth++; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (e) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      open(e.dataTransfer.files[0]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  async function open(file) {
    if (!file) return;
    job.current?.cancel();
    if (debug()) window.__soundscopeFile = file;
    const t0 = performance.now();
    setState({ status: "working", file, seconds: 0, duration: null, model: null, overview: null, t0, listenT0: null });
    const update = (patch) => setState((s) => (s.file === file && s.status === "working" ? { ...s, ...patch } : s));
    const live = liveOverview();
    let lastShown = 0;
    const current = openAudioFile(file, {
      collect: !!window.__soundscopeCollect,
      analyse: !window.__soundscopeDecodeOnly, // test only
      onInfo: (info) => update({ duration: info.duration }),
      onProgress: (seconds) => {
        // live results: at most about once a second, so long files don't re-render constantly
        const now = performance.now();
        if (now - lastShown > 1000) {
          lastShown = now;
          update({ seconds, overview: live.view() });
        } else update({ seconds });
      },
      onOverview: (rows) => live.push(rows),
      onModel: (model) => update(model.stage === "ready" ? { model, listenT0: performance.now() } : { model }),
    });
    job.current = current;
    try {
      const audio = await current.promise;
      if (job.current !== current) return;
      const peaks = downsamplePeaks(audio.peaks);
      setState({ status: "ready", file, audio, peaks });
      if (debug()) {
        window.__soundscopeSamples = audio.samples;
        window.__soundscopeScores = audio.scores; // only when __soundscopeCollect (rebuilt from storage)
        window.__soundscopeResult = audio;
        // test only: time reading one sound's full-resolution timeline from storage
        window.__soundscopeReadClass = async (c) => {
          const { readClass } = await import("./store/scoreStore.js");
          const t = performance.now();
          const tl = await readClass(audio.store.key, audio.store.meta, c);
          return { rows: tl.length, ms: performance.now() - t };
        };
        window.__soundscopeLast = {
          ok: true, path: audio.path, duration: audio.duration, channels: audio.channels, hasVideo: audio.hasVideo,
          rows: audio.store.meta?.rows ?? null, stored: audio.store.stored, storeReason: audio.store.reason,
          timings: audio.timings, wallMs: performance.now() - t0,
        };
      }
    } catch (e) {
      if (job.current !== current) return;
      if (e?.name === "AbortError") {
        setState({ status: "idle" });
        return;
      }
      const message = e instanceof DecodeError ? e.message : "Something went wrong while opening this file. Please try again.";
      setState({ status: "error", file, message });
      if (debug()) window.__soundscopeLast = { ok: false, kind: e?.kind, message, detail: String(e?.cause ?? e) };
    } finally {
      if (job.current === current) job.current = null;
    }
  }

  function cancel() {
    job.current?.cancel();
  }

  const busy = state.status === "working";
  const idle = state.status === "idle";
  const showResults = (busy && state.overview?.length > 0 && state.duration) || (state.status === "ready" && state.audio.classMax);

  return (
    <div className="shell">
      <input id="file-input" className="visually-hidden" type="file" accept={ACCEPT}
        onChange={(e) => { open(e.target.files[0]); e.target.value = ""; }} />

      <header className="topbar">
        <div className="brand">
          <Logo />
          <span className="brand__name">SoundScope</span>
        </div>
        <div className="topbar__right">
          <span className="topbar__private" title="Your file is checked inside this browser. It is never uploaded.">
            <Lock size={13} /> Private: stays on your device
          </span>
          <ThemeSwitch choice={themeChoice} onChange={setThemeChoice} />
          {!idle && (
            <label htmlFor="file-input" className="button button--primary" role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.getElementById("file-input").click(); } }}>
              <FolderOpen size={15} /> <span className="hide-sm">Open file</span>
            </label>
          )}
        </div>
      </header>

      <main className="app">
        {(idle || state.status === "error") && <Landing />}

        {busy && <Progress state={state} onCancel={cancel} />}

        {state.status === "error" && (
          <section className="card error" role="alert" style={{ order: -1 }}>
            <div className="error__icon"><AlertTriangle size={22} /></div>
            <div className="error__text">
              <h2 className="h2">Couldn't open {state.file.name}</h2>
              <p>{state.message}</p>
            </div>
            <label htmlFor="file-input" className="button" role="button" tabIndex={0}>Choose another file</label>
          </section>
        )}

        {/* Same component (same key) during and after the analysis, so slider and picks carry over. */}
        {showResults && (
          <Results
            key={`${state.file.name}|${state.file.size}|${state.file.lastModified}`}
            file={state.file}
            labels={NAMES}
            duration={busy ? state.duration : state.audio.duration}
            overview={busy ? state.overview : state.audio.overview}
            live={busy}
            store={busy ? null : state.audio.store}
            peaks={busy ? null : state.peaks}
            hasVideo={busy ? false : state.audio.hasVideo}
            theme={theme}
            player={busy ? null : player}
            onPlayer={setPlayer}
          />
        )}
      </main>

      <footer className="footer">
        <span>SoundScope works on your device. Your recordings are never uploaded.</span>
        <details className="footer__credits">
          <summary>Credits</summary>
          <p>
            Sound recognition: EfficientSED (fmn10 + transformer) by Morocutti, Schmid, Greif, Foscarin and Widmer,
            built on PretrainedSED (MIT). Sound categories: AudioSet ontology by Google (CC BY-SA 4.0). File reading: Mediabunny (MPL-2.0).
            Waveform: wavesurfer.js. Icons: Lucide. Font: Inter.{" "}
            <a href="/THIRD-PARTY-NOTICES.txt" target="_blank" rel="noopener">Full licences</a>
          </p>
        </details>
      </footer>

      {dragging && (
        <div className="dropzone-overlay" aria-hidden="true">
          <div className="dropzone-overlay__inner">
            <Upload size={34} />
            <p>Drop to open</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="var(--text)" />
      <g stroke="var(--bg)" strokeWidth="2" strokeLinecap="round">
        <path d="M6 10.5v3M9.5 7.5v9M13 9.5v5" />
      </g>
      <path d="M16.5 6.5v11" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ThemeSwitch({ choice, onChange }) {
  const options = [
    ["system", Laptop, "Match system"],
    ["light", Sun, "Light"],
    ["dark", Moon, "Dark"],
  ];
  return (
    <div className="segmented" role="radiogroup" aria-label="Theme">
      {options.map(([key, Icon, label]) => (
        <button key={key} type="button" role="radio" aria-checked={choice === key} className="segmented__item"
          onClick={() => onChange(key)} title={label} aria-label={label}>
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

const openPicker = (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.getElementById("file-input").click(); }
};

function Landing() {
  return (
    <>
      <section className="landing">
        <div className="landing__intro">
          <h1 className="landing__title">Find any sound in a long recording.</h1>
          <p className="landing__lead">
            Open an audio or video file. SoundScope marks where speech, dogs, sirens, applause and hundreds of other
            sounds happen, so you can go straight to them instead of listening to the whole thing.
          </p>
          <label htmlFor="file-input" className="dropzone" role="button" tabIndex={0} onKeyDown={openPicker}>
            <span className="dropzone__icon"><Upload size={18} /></span>
            <span className="dropzone__text">
              <span className="dropzone__title">Open a file</span>
              <span className="dropzone__sub">or drop it anywhere on this page</span>
            </span>
            <span className="dropzone__formats">MP3, WAV, M4A, FLAC, OGG, MP4, MOV, WebM, MKV</span>
          </label>
          <p className="landing__privacy">
            <Lock size={13} /> Your file stays on this computer. Nothing is uploaded.
          </p>
        </div>
        <Preview />
      </section>
      <ol className="steps">
        <li className="step">
          <span className="step__n">1</span>
          <div><h3 className="step__title">Open a file</h3><p className="step__text">Audio or video. SoundScope listens to it once and keeps the results on this device.</p></div>
        </li>
        <li className="step">
          <span className="step__n">2</span>
          <div><h3 className="step__title">Search for a sound</h3><p className="step__text">Type “dog” to find barks, howls and growls. Each sound gets its own lane on the timeline.</p></div>
        </li>
        <li className="step">
          <span className="step__n">3</span>
          <div><h3 className="step__title">Listen and keep</h3><p className="step__text">Click a moment to hear it, bookmark it with a note, and download clips or a list.</p></div>
        </li>
      </ol>
    </>
  );
}

// Static picture of the timeline for the landing page (a made-up example, not real results).
const PREVIEW_BARS = Array.from({ length: 96 }, (_, i) => 16 + Math.round(72 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11))));
const PREVIEW_LANES = [
  { name: "Speech", color: "var(--cat-human)", spans: [[2, 18], [22, 41], [47, 63], [70, 92]] },
  { name: "Dog", color: "var(--cat-animal)", spans: [[19, 22], [43, 45], [64, 67]] },
  { name: "Doorbell", color: "var(--cat-things)", spans: [[44.5, 46]] },
];

function Preview() {
  return (
    <figure className="preview" aria-hidden="true">
      <div className="preview__head">
        <span className="preview__name">kitchen-recording.m4a</span>
        <span className="preview__meta">1:12:40</span>
      </div>
      <div className="preview__track">
        <span className="preview__label">Audio</span>
        <div className="preview__wave">
          {PREVIEW_BARS.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
        </div>
        {PREVIEW_LANES.map((l) => (
          <div key={l.name} className="preview__row" style={{ "--row-color": l.color }}>
            <span className="preview__label"><span className="dot" />{l.name}</span>
            <div className="preview__lane">
              {l.spans.map(([a, b]) => <i key={a} style={{ left: `${a}%`, width: `${b - a}%` }} />)}
            </div>
          </div>
        ))}
        <span className="preview__label" />
        <div className="preview__ruler"><span>0:00</span><span>36:20</span><span>1:12:40</span></div>
        <div className="preview__playhead" />
      </div>
    </figure>
  );
}

function Progress({ state, onCancel }) {
  const pct = state.duration ? Math.min(100, (state.seconds / state.duration) * 100) : 0;
  const downloading = state.model?.stage === "downloading";
  const dlPct = downloading && state.model.total ? Math.round((state.model.loaded / state.model.total) * 100) : 0;
  let eta = "";
  if (state.listenT0 && state.seconds > 0 && state.duration) {
    const elapsed = (performance.now() - state.listenT0) / 1000;
    if (elapsed > 2) eta = formatEta((elapsed / state.seconds) * (state.duration - state.seconds));
  }
  const shown = downloading ? dlPct : pct;
  return (
    <section className="card progress" aria-live="polite">
      <div className="progress__top">
        <span className="spinner" aria-hidden="true" />
        <div className="progress__text">
          <h2 className="progress__title">{downloading || !state.model ? "Getting ready" : "Listening to your file"}</h2>
          <p className="progress__file" title={state.file.name}>{state.file.name}</p>
        </div>
        <button type="button" className="button button--ghost" onClick={onCancel}><X size={14} />Cancel</button>
      </div>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown)}>
        <div className="bar__fill" style={{ width: `${shown}%` }} />
      </div>
      <div className="progress__meta">
        <p className="small muted">
          {downloading
            ? `Setting up, first time only (about 19 MB) · ${dlPct}%`
            : !state.model
              ? "Setting up…"
              : `Listened to ${formatDuration(state.seconds)}${state.duration ? ` of ${formatDuration(state.duration)}` : ""}`}
        </p>
        <p className="small muted progress__eta">{eta}</p>
      </div>
    </section>
  );
}
