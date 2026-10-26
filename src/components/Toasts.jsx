import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

/*
 * Small pop-up messages in the corner: errors, "clips saved", "bookmark deleted · Undo".
 * Call toast({...}) from anywhere; <Toaster /> (once, in App) shows them.
 *
 *   toast({ id?, tone, title, text?, action?: { label, onClick }, duration? }) -> id
 *     tone: "error" (stays until closed) | "success" | "info" | "progress" (stays, shows a spinner)
 *     id: pass the same id to update a toast in place (e.g. progress -> done)
 *     duration: ms before it closes by itself; defaults to 5 s, or never for errors and progress
 *   dismiss(id)
 */

let toasts = [];
let nextId = 1;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function toast(t) {
  const id = t.id ?? `t${nextId++}`;
  const sticky = t.tone === "error" || t.tone === "progress";
  const next = { duration: sticky ? null : 5000, ...t, id, version: (toasts.find((x) => x.id === id)?.version ?? 0) + 1 };
  toasts = toasts.some((x) => x.id === id) ? toasts.map((x) => (x.id === id ? next : x)) : [...toasts, next].slice(-4);
  emit();
  return id;
}

export function dismiss(id) {
  if (!toasts.some((x) => x.id === id)) return;
  toasts = toasts.filter((x) => x.id !== id);
  emit();
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const snapshot = () => toasts;

const ICONS = { error: AlertTriangle, success: CheckCircle2, info: Info };

export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => <Toast key={t.id} t={t} />)}
    </div>
  );
}

function Toast({ t }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(t.duration);
  // reset the countdown when the toast is updated (same id, new content)
  useEffect(() => { left.current = t.duration; }, [t.version, t.duration]);
  useEffect(() => {
    if (!left.current || paused) return;
    const start = Date.now();
    const timer = setTimeout(() => dismiss(t.id), left.current);
    return () => { clearTimeout(timer); left.current -= Date.now() - start; };
  }, [paused, t.id, t.version]);

  const Icon = ICONS[t.tone];
  return (
    <div
      className={`toast toast--${t.tone}`}
      role={t.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast__icon" aria-hidden="true">
        {Icon ? <Icon size={16} /> : <span className="spinner spinner--sm" />}
      </span>
      <div className="toast__body">
        <p className="toast__title">{t.title}</p>
        {t.text && <p className="toast__text">{t.text}</p>}
        {t.action && (
          <button type="button" className="toast__action" onClick={() => { t.action.onClick(); dismiss(t.id); }}>
            {t.action.label}
          </button>
        )}
      </div>
      {t.tone !== "progress" && (
        <button type="button" className="toast__close" onClick={() => dismiss(t.id)} aria-label="Close">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
