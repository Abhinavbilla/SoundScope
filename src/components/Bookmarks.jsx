import { useState } from "react";
import { BookmarkPlus, FileSpreadsheet, Music2, Play, Scissors, Trash2 } from "lucide-react";
import { formatTime } from "../results/format.js";
import { bookmarksCsv, ClipError, clipSaver, csvName, download, makeClips } from "../export/exportFiles.js";
import { toast } from "./Toasts.jsx";

/**
 * Saved moments for this file: play, add a note, remove, and export (CSV, or WAV clips with 1 s of
 * padding, one file per clip).
 */
export default function Bookmarks({ file, duration, bookmarks, persist, canPlay, onPlay, onNote, onRemove, onRestore, onAddHere }) {
  const [busy, setBusy] = useState(false);

  async function clips(list) {
    setBusy(true);
    const id = "clips"; // one toast: progress, then saved or the problem
    try {
      const save = await clipSaver(list.length);
      if (!save) return; // folder picker cancelled
      const making = (n) => toast({ id, tone: "progress", title: list.length === 1 ? "Making the clip…" : `Making clips… ${n} of ${list.length}` });
      making(0);
      await makeClips(file, list, duration, save, making);
      toast({ id, tone: "success", title: list.length === 1 ? "Clip saved" : `${list.length} clips saved` });
    } catch (e) {
      toast({
        id, tone: "error", title: list.length === 1 ? "Clip not saved" : "Clips not saved",
        text: e instanceof ClipError ? e.message : "Something went wrong while cutting the sound. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  function remove(b) {
    onRemove(b);
    toast({
      id: `deleted-${b.id}`, tone: "info", title: `Bookmark at ${formatTime(b.start)} deleted`,
      action: { label: "Undo", onClick: () => onRestore(b) },
    });
  }

  return (
    <div className="bookmarks">
      <div className="bookmarks__actions">
        <button type="button" className="button" onClick={onAddHere} disabled={!canPlay}>
          <BookmarkPlus size={15} /> Bookmark this point
        </button>
        <span className="bookmarks__spacer" />
        <button type="button" className="button" disabled={!bookmarks.length}
          onClick={() => download(csvName(file.name), bookmarksCsv(bookmarks), "text/csv;charset=utf-8")}>
          <FileSpreadsheet size={15} /> Download list
        </button>
        <button type="button" className="button button--primary" disabled={!bookmarks.length || busy} onClick={() => clips(bookmarks)}>
          <Music2 size={15} /> Download all clips
        </button>
      </div>
      {!persist && <p className="small muted">Bookmarks can't be saved in this browser window, so they'll be lost when it closes.</p>}
      {bookmarks.length === 0 ? (
        <div className="empty">
          <div className="empty__icon"><BookmarkPlus size={22} /></div>
          <p className="empty__title">No bookmarks yet</p>
          <p className="small muted">Click ☆ next to a moment to keep it here with a note. You can download them as a list (opens in Excel) or as sound clips.</p>
        </div>
      ) : (
        <ol className="bookmarks__list">
          {bookmarks.map((b) => (
            <li key={b.id} className="bookmark">
              <button type="button" className="moment bookmark__time" disabled={!canPlay} onClick={() => onPlay(b.start, b.end)}>
                <span><Play size={12} className="moment__play" fill="currentColor" aria-hidden="true" />{formatTime(b.start)} – {formatTime(b.end)}</span>
                <span className="muted">{b.label || "Your bookmark"}</span>
              </button>
              <input
                className="bookmark__note"
                type="text"
                placeholder="Add a note"
                aria-label={`Note for ${b.label || "bookmark"} at ${formatTime(b.start)}`}
                defaultValue={b.note}
                onBlur={(e) => { if (e.target.value !== b.note) onNote(b, e.target.value); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              />
              <button type="button" className="button button--sm" disabled={busy} onClick={() => clips([b])} title="Download this moment as a sound file">
                <Scissors size={14} /> Clip
              </button>
              <button type="button" className="bookmark__remove" aria-label={`Delete bookmark at ${formatTime(b.start)}`} title="Delete bookmark"
                onClick={() => remove(b)}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
