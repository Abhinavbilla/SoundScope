import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Bookmark, Check, Clapperboard, ListMusic, Lock, Play, Star, VolumeX } from "lucide-react";
import { readClass } from "../store/scoreStore.js";
import { bookmarksPersist, deleteBookmark, fileKey, listBookmarks, saveBookmark } from "../store/bookmarks.js";
import { encodeScore } from "../model/config.js";
import {
  column, columnMax, findIntervals, maxOf, positionOf, soundsHeard, THRESHOLD, thresholdAt,
} from "../results/intervals.js";
import { formatAmount, formatDuration, formatTime } from "../results/format.js";
import { CATEGORIES, categoryOf, colorOf, isGeneric } from "../results/categories.js";
import Bookmarks from "./Bookmarks.jsx";
import Player, { Ruler } from "./Player.jsx";
import Search from "./Search.jsx";
import Strength from "./Strength.jsx";
import TimelineRow from "./TimelineRow.jsx";
import { toast } from "./Toasts.jsx";

const DEFAULT_ROWS = 3; // sounds shown on the timeline before the user picks any
const BACKGROUND_SHARE = 0.8; // sounds heard in more of the file than this aren't picked by default
const LIST_STEP = 24; // sounds listed before "Show all"
const MOMENTS_STEP = 100; // moments listed before "Show more"
const MANUAL_LENGTH = 1; // seconds covered by a bookmark set at the playback position
const MIN_PLAY = 1; // seconds: a moment shorter than this plays for this long
const GROUP_COLOR = "var(--accent)";

/** A timeline row: one sound, or several sounds combined (a search, e.g. "dog" = Dog, Bark, Howl...). */
const soundRow = (c, labels) => ({ key: `s${c}`, label: labels[c], classes: [c], color: colorOf(c) });
const groupRow = (query, classes) => ({ key: `q:${query}`, label: `“${query}”`, classes, group: true, color: GROUP_COLOR });

/**
 * Whether the browser's own player can play this sound format. SoundScope decodes Dolby Digital itself
 * for the analysis, but playback uses the browser's <audio>/<video>, which on most browsers can't.
 */
const DOLBY_TYPES = { ac3: 'audio/mp4; codecs="ac-3"', eac3: 'audio/mp4; codecs="ec-3"' };
function browserPlays(codec) {
  const type = DOLBY_TYPES[codec];
  if (!type) return true;
  return !!globalThis.MediaSource?.isTypeSupported?.(type) || document.createElement("audio").canPlayType(type) !== "";
}

/**
 * The workspace for one file: search, sensitivity, the player with timeline lanes, the selected
 * sound's moments, bookmarks and the sounds in the recording.
 * While the analysis runs (`live`), everything uses the growing 1-second overview and there's no
 * player yet. Afterwards, rows on the timeline use full 40 ms detail read from storage (when saved).
 */
export default function Results({ file, labels, duration, overview, live, store, peaks, hasVideo, codec, theme, player, onPlayer }) {
  const classes = labels.length;
  const [threshold, setThreshold] = useState(THRESHOLD.start);
  const [selected, setSelected] = useState(null); // array of rows, null = not chosen yet
  const [active, setActive] = useState(null); // key of the row whose moments are listed
  const [showAll, setShowAll] = useState(false);
  const [showBackground, setShowBackground] = useState(false);
  const [filter, setFilter] = useState("all"); // category filter for "Sounds in this recording"
  const [tab, setTab] = useState("moments");
  const [more, setMore] = useState({ key: null, n: MOMENTS_STEP }); // moments shown, per row
  const [detail, setDetail] = useState(() => new Map()); // row key -> full-detail timeline
  const [marks, setMarks] = useState({ key: null, list: [], persist: true }); // this file's bookmarks
  const [playFailed, setPlayFailed] = useState(false); // the browser's player rejected the file
  const searchRef = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => {
    let stale = false;
    (async () => {
      const key = await fileKey(file);
      const [list, persist] = await Promise.all([listBookmarks(key), bookmarksPersist()]);
      if (!stale) setMarks({ key, list, persist });
    })().catch(() => {});
    return () => { stale = true; };
  }, [file]);

  // Keyboard: Space play/pause, arrows skip, "/" or Ctrl+K search.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable;
      if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing || !player) return;
      if (e.key === " " && tag !== "BUTTON") { e.preventDefault(); player.toggle(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); player.skip(-5); }
      else if (e.key === "ArrowRight") { e.preventDefault(); player.skip(5); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [player]);

  const heard = useMemo(() => soundsHeard(overview, classes, threshold), [overview, classes, threshold]);
  const heardBy = useMemo(() => new Map(heard.map((h) => [h.c, h])), [heard]);
  const meaningful = useMemo(() => heard.filter((h) => !isGeneric(h.c)), [heard]);

  // Until the user picks sounds, show the most heard ones that come and go (a sound that runs
  // through the whole file, like background noise, makes a dull row).
  const rows = selected ?? defaultRows(meaningful, overview.length / classes).map((c) => soundRow(c, labels));
  const rowKeys = rows.map((r) => r.key).join("|");
  const activeRow = rows.find((r) => r.key === active) ?? rows[0] ?? null;

  // Full detail for rows on the timeline, once the analysis is done and the scores are saved.
  // A combined row reads its sounds one by one and keeps only their maximum.
  useEffect(() => {
    if (live || !store?.stored) return;
    let stale = false;
    const floor = encodeScore(THRESHOLD.min);
    (async () => {
      for (const row of rows) {
        if (detail.has(row.key)) continue;
        try {
          let tl = null;
          for (const c of row.classes) {
            if (row.classes.length > 1 && columnMax(overview, classes, c) < floor) continue; // never heard
            const one = await readClass(store.key, store.meta, c);
            if (stale) return;
            tl = tl ? maxOf([tl, one]) : one;
          }
          tl ??= new Uint8Array(store.meta.rows);
          setDetail((d) => new Map(d).set(row.key, tl));
        } catch {
          // keep the 1-second detail
        }
      }
    })();
    return () => { stale = true; };
  }, [live, store, rowKeys]); // rows is rebuilt each render; its keys are what matter

  const intervalsByRow = useMemo(() => {
    const out = new Map();
    for (const row of rows) {
      const full = detail.get(row.key);
      const tl = full ?? maxOf(row.classes.map((c) => column(overview, classes, c)));
      const step = full ? store.meta.stepSeconds : 1;
      out.set(row.key, findIntervals(tl, step, threshold, { duration }));
    }
    return out;
  }, [rowKeys, detail, overview, threshold, duration]);

  const onTimeline = (key) => rows.some((r) => r.key === key);

  function toggle(row) {
    if (onTimeline(row.key)) setSelected(rows.filter((r) => r.key !== row.key));
    else {
      setSelected([...rows, row]);
      setActive(row.key);
    }
  }

  /** Play a moment from its start to its end (at least MIN_PLAY seconds, so very short sounds can be heard). */
  function play(start, end) {
    player?.playFrom(start, Math.max(end, start + MIN_PLAY));
  }

  async function updateMarks(change) {
    try {
      await change();
    } catch {
      toast({
        id: "bookmark-not-saved", tone: "error", title: "Bookmark not saved",
        text: "Your device may be out of space. Free up some space and try again.",
      });
    }
    const list = await listBookmarks(marks.key).catch(() => marks.list);
    setMarks((m) => ({ ...m, list }));
  }
  const sameMoment = (b, m, label) => Math.abs(b.start - m.start) < 0.01 && Math.abs(b.end - m.end) < 0.01 && b.label === label;
  function toggleMark(m, label) {
    const existing = marks.list.find((b) => sameMoment(b, m, label));
    updateMarks(() => (existing ? deleteBookmark(existing.id) : saveBookmark({
      id: crypto.randomUUID(), file: marks.key, start: m.start, end: m.end, label, confidence: m.confidence,
      note: "", createdAt: Date.now(),
    })));
  }
  function markHere() {
    const t = player?.time() ?? 0;
    updateMarks(() => saveBookmark({
      id: crypto.randomUUID(), file: marks.key, start: t, end: Math.min(duration, t + MANUAL_LENGTH), label: "",
      confidence: null, note: "", createdAt: Date.now(),
    }));
  }

  /** In a combined row, the sound that was strongest at a moment's peak (from the 1 s overview). */
  function strongest(row, peak) {
    const r = Math.min(Math.floor(peak), overview.length / classes - 1) * classes;
    let best = row.classes[0];
    for (const c of row.classes) if (overview[r + c] > overview[r + best]) best = c;
    return labels[best];
  }

  const sensitivity = 1 - positionOf(threshold); // right = more sensitive = lower threshold
  const pool = showBackground ? heard : meaningful;
  const counts = useMemo(() => {
    const n = {};
    for (const h of pool) n[categoryOf(h.c)] = (n[categoryOf(h.c)] ?? 0) + 1;
    return n;
  }, [pool]);
  const filtered = filter === "all" ? pool : pool.filter((h) => categoryOf(h.c) === filter);
  const listed = showAll ? filtered : filtered.slice(0, LIST_STEP);
  const hiddenCount = heard.length - meaningful.length;
  const moments = activeRow ? intervalsByRow.get(activeRow.key) ?? [] : [];
  const momentsShown = more.key === activeRow?.key ? more.n : MOMENTS_STEP;

  const lanes = (
    <>
      {rows.map((row) => (
        <TimelineRow
          key={row.key}
          label={row.group ? `${row.label} (${row.classes.length} kinds)` : row.label}
          color={row.color}
          intervals={intervalsByRow.get(row.key)}
          duration={duration}
          threshold={threshold}
          theme={theme}
          active={row.key === activeRow?.key}
          onSelect={() => setActive(row.key)}
          onRemove={() => toggle(row)}
        />
      ))}
      {rows.length === 0 && (
        <p className="timeline__empty">{live ? "Sounds will appear here as they're found." : "Search for a sound, or tick one in the list below, to put it on the timeline."}</p>
      )}
    </>
  );

  const stage = hasVideo && !live; // video: picture next to the moments, timeline under both
  const silent = !live && (playFailed || !browserPlays(codec));

  const momentsPanel = (
    <section className="card panel moments-panel">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === "moments" || live} onClick={() => setTab("moments")}>
          <ListMusic size={15} /> Moments
        </button>
        {!live && (
          <button type="button" role="tab" className="tab" aria-selected={tab === "bookmarks"} onClick={() => setTab("bookmarks")}>
            <Bookmark size={15} /> Bookmarks {marks.list.length > 0 && <span className="tab__count">{marks.list.length}</span>}
          </button>
        )}
      </div>

      {(tab === "moments" || live) && (
        activeRow ? (
          <div className="moments">
            <div className="moments__title" style={{ "--row-color": activeRow.color }}>
              <span className="dot" aria-hidden="true" />
              <span className="moments__name">{activeRow.label}</span>
              <span className="muted">{moments.length} {moments.length === 1 ? "time" : "times"}</span>
            </div>
            {moments.length === 0 && <p className="small muted">Not found at this setting. Move the “Show” slider to the right to include fainter sounds.</p>}
            {!live && !player && moments.length > 0 && <p className="small muted">Loading the player…</p>}
            <ol className="moments__list">
              {moments.slice(0, momentsShown).map((m) => {
                const label = activeRow.group ? strongest(activeRow, m.peak) : activeRow.label;
                const marked = marks.list.some((b) => sameMoment(b, m, label));
                return (
                  <li key={m.start} className="moments__item">
                    <button type="button" className="moment" disabled={live || !player} onClick={() => play(m.start, m.end)}>
                      <span>
                        <Play size={11} className="moment__play" fill="currentColor" strokeWidth={0} aria-hidden="true" />
                        {formatTime(m.start)} – {formatTime(m.end)}
                        {activeRow.group && <span className="moment__sound">{label}</span>}
                      </span>
                      <span className="moment__len">{formatAmount(Math.max(1, m.end - m.start))}</span>
                      <Strength confidence={m.confidence} threshold={threshold} />
                    </button>
                    <button type="button" className={`star ${marked ? "star--on" : ""}`} disabled={live || !marks.key}
                      aria-pressed={marked} aria-label={`Bookmark ${label} at ${formatTime(m.start)}`}
                      title={marked ? "Remove bookmark" : "Bookmark"} onClick={() => toggleMark(m, label)}>
                      <Star size={14} fill={marked ? "currentColor" : "none"} />
                    </button>
                  </li>
                );
              })}
            </ol>
            {moments.length > momentsShown && (
              <button type="button" className="button button--ghost" onClick={() => setMore({ key: activeRow.key, n: momentsShown + MOMENTS_STEP * 5 })}>
                Show more ({moments.length - momentsShown} left)
              </button>
            )}
            {live && moments.length > 0 && <p className="small muted">You can play these once SoundScope has finished listening.</p>}
          </div>
        ) : (
          <div className="empty">
            <p className="empty__title">No sound picked</p>
            <p className="small muted">Search for a sound or tick one in the list. Every time it happens is listed here; click one to hear it.</p>
          </div>
        )
      )}

      {tab === "bookmarks" && !live && (
        <Bookmarks
          file={file}
          duration={duration}
          bookmarks={marks.list}
          persist={marks.persist}
          canPlay={!!player}
          onPlay={play}
          onNote={(b, note) => updateMarks(() => saveBookmark({ ...b, note }))}
          onRemove={(b) => updateMarks(() => deleteBookmark(b.id))}
          onRestore={(b) => updateMarks(() => saveBookmark(b))}
          onAddHere={markHere}
        />
      )}
    </section>
  );

  return (
    <div className="workspace">
      {!live && (
        <header className="file-head">
          <div className="file-head__icon" aria-hidden="true">{hasVideo ? <Clapperboard size={18} /> : <AudioLines size={18} />}</div>
          <div className="file-head__text">
            <h1 className="file-head__name" title={file.name}>{file.name}</h1>
            <p className="file-head__meta">
              <span data-testid="duration">{formatDuration(duration)}</span>
              <span aria-hidden="true">·</span>
              <span>{hasVideo ? "Video" : "Audio"}</span>
              <span aria-hidden="true">·</span>
              <span>{meaningful.length} {meaningful.length === 1 ? "sound" : "sounds"} found</span>
            </p>
          </div>
          <span className="file-head__private" title="Checked on this device. Nothing was uploaded.">
            <Lock size={13} /> {store?.stored ? "Results saved on this device only" : "Results are lost when you close this tab"}
          </span>
        </header>
      )}

      <div className="toolbar">
        <Search
          ref={searchRef}
          labels={labels}
          heardBy={heardBy}
          live={live}
          isOn={(c) => onTimeline(`s${c}`)}
          onToggle={(c) => toggle(soundRow(c, labels))}
          groupOn={(q) => onTimeline(`q:${q}`)}
          onGroup={(q, cs) => toggle(groupRow(q, cs))}
          bookmarks={live ? [] : marks.list}
          canPlay={!!player}
          onPlayBookmark={(b) => play(b.start, b.end)}
        />
        <div className="sens">
          <label htmlFor="sensitivity" className="sens__label" title="Move right to also show fainter or less certain sounds">Show</label>
          <span className="sens__end">Clear only</span>
          <input
            id="sensitivity"
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={sensitivity}
            data-threshold={threshold}
            onChange={(e) => setThreshold(thresholdAt(1 - Number(e.target.value)))}
            aria-valuetext={sensitivity < 0.33 ? "Only clear sounds" : sensitivity < 0.66 ? "Balanced" : "Also faint sounds"}
            style={{ "--fill": `${sensitivity * 100}%` }}
          />
          <span className="sens__end">Also faint</span>
        </div>
      </div>

      {silent && (
        <p className="play-note" role="status">
          <VolumeX size={16} aria-hidden="true" />
          <span>
            {browserPlays(codec)
              ? "This browser can't play this file, so the timeline won't play it."
              : `This browser can't play Dolby Digital sound, so ${hasVideo ? "the video plays without sound" : "the timeline won't play it"}.`}
            {" "}The sounds found are complete. To listen to a moment, bookmark it and download the clip.
          </span>
        </p>
      )}

      {stage && (
        <div className="stage">
          <div className="stage__video">
            <video className="video" ref={videoRef} playsInline preload="metadata" onClick={() => player?.toggle()} />
          </div>
          {momentsPanel}
        </div>
      )}

      {live ? (
        <section className="card timeline-card">
          <div className="card__head">
            <h2 className="h2">Found so far</h2>
            <span className="small muted">Updates as SoundScope listens</span>
          </div>
          <div className="track track--live">
            {lanes}
            <div className="track__gutter" />
            <Ruler duration={duration} />
          </div>
        </section>
      ) : (
        <section className="card timeline-card">
          <Player
            file={file}
            peaks={peaks}
            duration={duration}
            videoRef={hasVideo ? videoRef : null}
            theme={theme}
            markers={moments}
            markerColor={activeRow?.color}
            onReady={onPlayer}
            onCantPlay={() => setPlayFailed(true)}
          >
            {lanes}
          </Player>
        </section>
      )}

      <div className={`panels ${stage ? "panels--single" : ""}`}>
        {!stage && momentsPanel}

        <section className="card panel sounds">
          <div className="sounds__head">
            <h2 className="h2">Sounds in this recording <span className="muted">{pool.length}</span></h2>
            <p className="small muted">Tick a sound to show it on the timeline.</p>
          </div>
          <div className="filters" role="group" aria-label="Filter by kind of sound">
            <button type="button" className="filter" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
            {Object.entries(CATEGORIES).filter(([k]) => counts[k]).map(([k, cat]) => (
              <button key={k} type="button" className="filter" aria-pressed={filter === k} onClick={() => setFilter(k)}
                style={{ "--row-color": cat.color }}>
                <span className="dot" aria-hidden="true" /> {cat.name} <span className="filter__n">{counts[k]}</span>
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="small muted">{live ? "Nothing yet." : "No sounds at this setting. Move the “Show” slider to the right."}</p>
          )}
          <ul className="sounds__list">
            {listed.map((h) => (
              <li key={h.c}>
                <label className="sound-chip" style={{ "--row-color": colorOf(h.c) }}>
                  <input type="checkbox" className="sound-chip__check" checked={onTimeline(`s${h.c}`)} onChange={() => toggle(soundRow(h.c, labels))} />
                  <span className="checkbox" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
                  <span className="dot" aria-hidden="true" />
                  <span className="sounds__name">{labels[h.c]}</span>
                  <span className="sounds__stat">{formatAmount(Math.min(h.seconds, duration))}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="sounds__foot">
            {filtered.length > LIST_STEP && (
              <button type="button" className="button button--ghost" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${filtered.length}`}
              </button>
            )}
            {hiddenCount > 0 && (
              <button type="button" className="link-btn" onClick={() => setShowBackground((v) => !v)}>
                {showBackground ? "Hide background noises" : `Also show ${hiddenCount} background ${hiddenCount === 1 ? "noise" : "noises"} (hum, room sound…)`}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function defaultRows(heard, seconds) {
  const comeAndGo = heard.filter((h) => h.seconds < BACKGROUND_SHARE * seconds);
  const rest = heard.filter((h) => h.seconds >= BACKGROUND_SHARE * seconds);
  return [...comeAndGo, ...rest].slice(0, DEFAULT_ROWS).map((h) => h.c);
}
