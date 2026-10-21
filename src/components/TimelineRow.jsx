import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { formatTime } from "../results/format.js";
import { strength } from "../results/intervals.js";

function cssColor(color) {
  const m = /^var\((.*)\)$/.exec(color);
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() : color;
}

const HIT_PX = 6; // a pointer this close to a short interval still counts as on it

/**
 * One sound's intervals across the whole file, drawn on a canvas (a 10 h file can have thousands),
 * in the sound's category colour. Stronger detections are drawn more solid. The name sits in the
 * track's left column and the lane in the time column (the row itself is `display: contents`).
 * Pressing the lane selects the sound; the player handles seeking for the whole track.
 */
export default function TimelineRow({ label, color, intervals, duration, threshold, theme, active, onSelect, onRemove }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = cssColor(color);
      const lo = Math.log(threshold);
      for (const iv of intervals) {
        const x0 = (iv.start / duration) * w;
        const x1 = Math.max(x0 + 2, (iv.end / duration) * w); // keep short ones visible
        // opacity from how far above the threshold the score gets (log scale), 0.45..1
        ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, Math.max(0, (Math.log(iv.confidence) - lo) / -lo));
        const y = 5, hh = h - 10, r = Math.min(2, (x1 - x0) / 2);
        ctx.beginPath();
        ctx.roundRect(x0, y, x1 - x0, hh, r);
        ctx.fill();
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [intervals, duration, threshold, color, theme]);

  function hit(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * duration;
    const pad = (HIT_PX / rect.width) * duration;
    let best = null, bestDist = Infinity;
    for (const iv of intervals) {
      if (iv.start - pad > t) break; // sorted by start
      const dist = t < iv.start ? iv.start - t : t > iv.end ? t - iv.end : 0;
      if (dist <= pad && dist < bestDist) { best = iv; bestDist = dist; }
    }
    return best;
  }

  return (
    <div className={`trow ${active ? "trow--active" : ""}`} style={{ "--row-color": color }}>
      <div className="trow__head">
        <button type="button" className="trow__label" onClick={onSelect} aria-pressed={active} title={label}>
          <span className="dot" aria-hidden="true" />
          <span className="trow__name">{label}</span>
          <span className="visually-hidden"> · </span>
          <span className="trow__count">{intervals.length}</span>
        </button>
        <button type="button" className="trow__remove" onClick={onRemove} aria-label={`Remove ${label} from the timeline`} title="Remove from timeline">
          <X size={13} />
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="trow__bar"
        onMouseMove={(e) => {
          const iv = hit(e);
          e.currentTarget.title = iv ? `${label}: ${formatTime(iv.start)} – ${formatTime(iv.end)} · ${strength(iv.confidence, threshold).word}` : "";
        }}
        onPointerDown={onSelect}
        aria-hidden="true"
      />
    </div>
  );
}
