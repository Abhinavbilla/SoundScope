import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { AudioLines, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { formatDuration, formatTime } from "../results/format.js";

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const SKIP = 5; // seconds for the back/forward buttons and arrow keys
const RATES = [1, 1.5, 2];

/**
 * The file's waveform (drawn from precomputed peaks; the file is never decoded again here), the
 * moments of the selected sound marked on it, timeline lanes (children) on the same time axis, a time
 * ruler and play controls. Playback streams from the file: for audio through WaveSurfer's own media
 * element, for a video through the parent's <video> (`videoRef`), which WaveSurfer drives.
 * Pressing anywhere on the waveform or a lane moves the playhead there (drag to scrub) and plays from
 * that point when released.
 * `onReady(player)` gets { playFrom(t, until?), toggle(), skip(s), on(event, fn) -> unsubscribe, time(), playing() }
 * (playFrom with `until` pauses there, unless the user moves the playhead first)
 * (null on unmount). `onCantPlay()` is called if the browser can't play the file at all.
 */
export default function Player({ file, peaks, duration, videoRef = null, markers = [], markerColor, onReady, onCantPlay, children }) {
  const video = !!videoRef;
  const containerRef = useRef(null);
  const markersRef = useRef(null);
  const areaRef = useRef(null);
  const playheadRef = useRef(null);
  const hoverRef = useRef(null);
  const wsRef = useRef(null);
  const scrub = useRef(null); // { id, t } while the pointer is down on the track
  const [player, setPlayer] = useState(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const common = {
      container: containerRef.current,
      height: 72,
      waveColor: cssVar("--wave"),
      progressColor: cssVar("--wave-progress"),
      cursorWidth: 0, // our own playhead runs through the lanes too
      interact: false, // seeking is handled for the whole track below
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      peaks: [peaks],
      duration,
    };
    let ws;
    if (video) {
      videoRef.current.src = url;
      ws = WaveSurfer.create({ ...common, media: videoRef.current });
    } else {
      ws = WaveSurfer.create({ ...common, url });
    }
    wsRef.current = ws;
    const clamp = (t) => Math.max(0, Math.min(duration, t));
    let stopAt = null; // end of the moment being played, if any
    const p = {
      playFrom(t, until = null) {
        stopAt = until;
        ws.setTime(clamp(t));
        ws.play();
      },
      seek: (t) => { stopAt = null; ws.setTime(clamp(t)); },
      toggle: () => ws.playPause(),
      skip: (s) => { stopAt = null; ws.setTime(clamp(ws.getCurrentTime() + s)); },
      setRate: (r) => ws.setPlaybackRate(r, true),
      on: (event, fn) => ws.on(event, fn), // e.g. "timeupdate", "play", "pause"
      time: () => ws.getCurrentTime(),
      playing: () => ws.isPlaying(),
    };
    const moveHead = (t) => { if (playheadRef.current) playheadRef.current.style.left = `${(t / duration) * 100}%`; };
    const offTime = ws.on("timeupdate", (t) => {
      moveHead(t);
      if (stopAt !== null && t >= stopAt) {
        stopAt = null;
        ws.pause();
      }
    });
    const offSeek = ws.on("seeking", moveHead);
    // The analysis may have read a format the browser's player can't (e.g. Dolby Digital).
    const element = ws.getMediaElement();
    const failed = () => { if (element?.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) onCantPlay?.(); };
    element?.addEventListener("error", failed);
    setPlayer(p);
    onReady?.(p);
    const media = videoRef?.current;
    return () => {
      element?.removeEventListener("error", failed);
      offTime();
      offSeek();
      onReady?.(null);
      setPlayer(null);
      ws.destroy();
      wsRef.current = null;
      if (media) media.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [file, peaks, duration, video]); // onReady is a state setter, videoRef a stable ref

  // Moments of the selected sound, marked on the waveform.
  useEffect(() => {
    const canvas = markersRef.current;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      if (!markerColor) return;
      ctx.fillStyle = cssVar(markerColor.replace(/^var\((.*)\)$/, "$1")) || markerColor;
      for (const m of markers) {
        const x0 = (m.start / duration) * w;
        const x1 = Math.max(x0 + 2, (m.end / duration) * w);
        ctx.globalAlpha = 0.14;
        ctx.fillRect(x0, 0, x1 - x0, h);
        ctx.globalAlpha = 1;
        ctx.fillRect(x0, h - 2, x1 - x0, 2);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [markers, markerColor, duration]);

  /** Time under the pointer, or null when it's outside the timeline area (e.g. on a lane's name). */
  function timeAt(e, clampInside = false) {
    const rect = areaRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (!clampInside && (x < 0 || x > rect.width)) return null;
    return (Math.max(0, Math.min(rect.width, x)) / rect.width) * duration;
  }

  function hover(e) {
    const el = hoverRef.current;
    const t = timeAt(e);
    if (t === null) { el.style.opacity = "0"; return; }
    el.style.opacity = "1";
    el.style.left = `${(t / duration) * 100}%`;
    el.firstChild.textContent = formatTime(t);
  }

  function down(e) {
    if (!player || e.button !== 0 || e.target.closest("button")) return;
    const t = timeAt(e);
    if (t === null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    scrub.current = { id: e.pointerId, t };
    player.seek(t);
  }

  function move(e) {
    hover(e);
    if (scrub.current?.id !== e.pointerId) return;
    const t = timeAt(e, true);
    scrub.current.t = t;
    player.seek(t);
  }

  function up(e) {
    if (scrub.current?.id !== e.pointerId) return;
    const { t } = scrub.current;
    scrub.current = null;
    player.playFrom(t);
  }

  return (
    <div className="player">
      <div
        className={`track ${player ? "track--seekable" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => { scrub.current = null; }}
        onPointerLeave={() => { hoverRef.current.style.opacity = "0"; }}
      >
        <div className="track__gutter track__gutter--wave">
          <AudioLines size={14} aria-hidden="true" /> Sound
        </div>
        <div className="track__wave">
          <div className="waveform" ref={containerRef} />
          <canvas className="markers" ref={markersRef} aria-hidden="true" />
        </div>
        {children}
        <div className="track__gutter" />
        <Ruler duration={duration} />
        <div className="track__area" ref={areaRef} aria-hidden="true">
          <div className="playhead" ref={playheadRef} />
          <div className="hoverline" ref={hoverRef}><span /></div>
        </div>
      </div>
      {player && <Transport player={player} duration={duration} />}
    </div>
  );
}

/** Time labels under the track, about every 1/8 of the width, at round steps. */
export function Ruler({ duration }) {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800];
  const step = steps.find((s) => duration / s <= 8) ?? 21600;
  const ticks = [];
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(t);
  return (
    <div className="ruler" aria-hidden="true">
      {ticks.map((t) => (
        <span key={t} className="ruler__tick" style={{ left: `${(t / duration) * 100}%` }}>
          {formatDuration(t)}
        </span>
      ))}
    </div>
  );
}

function Transport({ player, duration }) {
  const [playing, setPlaying] = useState(player.playing());
  const [time, setTime] = useState(player.time());
  const [rate, setRate] = useState(1);
  useEffect(() => {
    let raf = 0;
    const show = (t) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTime(t));
    };
    const offs = [
      player.on("play", () => setPlaying(true)),
      player.on("pause", () => setPlaying(false)),
      player.on("finish", () => setPlaying(false)),
      player.on("timeupdate", show),
      player.on("seeking", show),
    ];
    return () => { offs.forEach((off) => off()); cancelAnimationFrame(raf); };
  }, [player]);

  function nextRate() {
    const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    player.setRate(r);
    setRate(r);
  }

  return (
    <div className="transport">
      <div className="transport__buttons">
        <button type="button" className="icon-btn" onClick={() => player.skip(-SKIP)} aria-label={`Back ${SKIP} seconds`} title={`Back ${SKIP} s (←)`}>
          <RotateCcw size={17} />
        </button>
        <button type="button" className="play-btn" onClick={() => player.toggle()} aria-label={playing ? "Pause" : "Play"} title="Play / pause (Space)">
          {playing ? <Pause size={18} fill="currentColor" strokeWidth={0} /> : <Play size={18} fill="currentColor" strokeWidth={0} />}
        </button>
        <button type="button" className="icon-btn" onClick={() => player.skip(SKIP)} aria-label={`Forward ${SKIP} seconds`} title={`Forward ${SKIP} s (→)`}>
          <RotateCw size={17} />
        </button>
      </div>
      <span className="transport__time">
        {formatTime(time)}<span className="transport__total"> / {formatDuration(duration)}</span>
      </span>
      <button type="button" className="rate-btn" onClick={nextRate} aria-label={`Playback speed ${rate}x`} title="Playback speed">
        {rate}×
      </button>
      <span className="transport__hint">Click anywhere on the timeline to play from there</span>
      <span className="transport__keys" aria-hidden="true">
        <kbd>Space</kbd> play <kbd>←</kbd><kbd>→</kbd> 5 s <kbd>/</kbd> search
      </span>
    </div>
  );
}
