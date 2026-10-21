import { forwardRef, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Layers, Play, Search as SearchIcon, X } from "lucide-react";
import { noteMatch, searchSounds } from "../results/search.js";
import { formatAmount, formatTime } from "../results/format.js";
import { colorOf } from "../results/categories.js";

const SHOWN = 12; // matches listed before "Show all"
const NOTES_SHOWN = 3; // bookmarks whose note matches, listed before "Show all"

/** Bookmarks whose note matches the query, typos allowed like sound names; notes with the exact words first. */
function notesMatching(bookmarks, q) {
  return bookmarks
    .map((b) => ({ b, m: noteMatch(b.note, q) }))
    .filter((x) => x.m > 0)
    .sort((x, y) => y.m - x.m)
    .map((x) => x.b);
}

/**
 * Find a sound by name. Related sounds come along through the AudioSet ontology ("dog" also finds
 * Bark, Howl, Growling). Sounds heard in this file come first; each can go on the timeline, or all
 * matches together as one row. Bookmarks whose note matches are listed above the sounds; a click plays one.
 */
const Search = forwardRef(function Search({
  labels, heardBy, live, isOn, onToggle, groupOn, onGroup, bookmarks = [], canPlay, onPlayBookmark,
}, inputRef) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [notesAll, setNotesAll] = useState(false);
  const [open, setOpen] = useState(true); // results popover; closes on a click outside, reopens on focus
  const boxRef = useRef(null);
  const q = useDeferredValue(query.trim());

  useEffect(() => {
    const away = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);

  const notes = useMemo(() => notesMatching(bookmarks, q), [bookmarks, q]);
  const inNote = notes.some((b) => noteMatch(b.note, q) === 2);
  const [hits, corrected] = useMemo(() => {
    const found = searchSounds(q);
    // A typo guess isn't wanted when the words are in a note as typed ("mama" shouldn't turn into a sound name).
    if (found.corrected && inNote) return [[], null];
    // heard in this file first (keeping the search order), then the rest
    return [[...found.filter((h) => heardBy.has(h.c)), ...found.filter((h) => !heardBy.has(h.c))], found.corrected ?? null];
  }, [q, heardBy, inNote]);
  const heardCount = hits.filter((h) => heardBy.has(h.c)).length;
  const listed = showAll ? hits : hits.slice(0, SHOWN);
  const groupKey = (corrected ?? q).toLowerCase();

  return (
    <div className="search" ref={boxRef}>
      <div className="search__box">
        <SearchIcon size={18} className="search__icon" aria-hidden="true" />
        <label htmlFor="search" className="visually-hidden">Find a sound</label>
        <input
          id="search"
          ref={inputRef}
          type="search"
          className="search__input"
          placeholder={bookmarks.some((b) => b.note) ? "Find a sound or a note — dog, rain, siren…" : "Find a sound — dog, rain, applause, siren…"}
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { setQuery(e.target.value); setShowAll(false); setNotesAll(false); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); } }}
        />
        {query ? (
          <button type="button" className="icon-btn icon-btn--sm" onClick={() => setQuery("")} aria-label="Clear search"><X size={16} /></button>
        ) : (
          <kbd className="search__kbd" aria-hidden="true">/</kbd>
        )}
      </div>
      {q && open && (
        <div className="search__results" aria-live="polite">
          {notes.length > 0 && (
            <div className="search__notes">
              <span className="small muted">Your bookmarks · {notes.length} {notes.length === 1 ? "note matches" : "notes match"}</span>
              <ul className="note-hits">
                {(notesAll ? notes : notes.slice(0, NOTES_SHOWN)).map((b) => (
                  <li key={b.id}>
                    <button type="button" className="note-hit" disabled={!canPlay} title={`Play: ${b.note}`}
                      onClick={() => { onPlayBookmark(b); setOpen(false); }}>
                      <Play size={11} className="moment__play" fill="currentColor" strokeWidth={0} aria-hidden="true" />
                      <span className="note-hit__time">{formatTime(b.start)}</span>
                      <span className="note-hit__label">{b.label || "Your bookmark"}</span>
                      <span className="note-hit__note">{b.note}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {notes.length > NOTES_SHOWN && (
                <button type="button" className="link-btn" onClick={() => setNotesAll((v) => !v)}>
                  {notesAll ? "Show fewer" : `Show all ${notes.length}`}
                </button>
              )}
            </div>
          )}
          {hits.length === 0 ? (
            notes.length > 0
              ? <p className="search__empty small">No sound called “{q}”.</p>
              : <p className="search__empty">No sound called “{q}”. Try a more general word, like animal, vehicle, water or music.</p>
          ) : (
            <>
              {corrected && (
                <p className="search__fix">
                  Showing results for{" "}
                  <button type="button" className="link-btn" onClick={() => { setQuery(corrected); inputRef.current?.focus(); }}>
                    “{corrected}”
                  </button>
                  <span className="muted"> · no sound called “{q}”</span>
                </p>
              )}
              <div className="search__head">
                <span className="small muted">
                  {hits.length} matching {hits.length === 1 ? "sound" : "sounds"} · {heardCount} heard {live ? "so far" : "in this recording"}
                </span>
                {hits.length > 1 && (
                  <button type="button" className={`button ${groupOn(groupKey) ? "" : "button--primary"}`} aria-pressed={groupOn(groupKey)}
                    onClick={() => onGroup(groupKey, hits.map((h) => h.c))}>
                    <Layers size={15} /> {groupOn(groupKey) ? "Remove the combined line" : "Show all on one line"}
                  </button>
                )}
              </div>
              <ul className="sounds__list search__list">
                {listed.map((h) => {
                  const heard = heardBy.get(h.c);
                  return (
                    <li key={h.c} className={heard ? "" : "search__unheard"}>
                      <label className="hit" style={{ "--row-color": colorOf(h.c) }}>
                        <input type="checkbox" className="hit__check" checked={isOn(h.c)} onChange={() => onToggle(h.c)} />
                        <span className="dot" aria-hidden="true" />
                        <span className="sounds__name">
                          {labels[h.c]}
                          {h.via && <span className="muted search__via"> · {h.via}</span>}
                        </span>
                        <span className="muted sounds__stat">{heard ? formatAmount(heard.seconds) : "not heard"}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {hits.length > SHOWN && (
                <button type="button" className="button button--ghost" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer" : `Show all ${hits.length}`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});

export default Search;
