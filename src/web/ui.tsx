import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { MeResponse } from "../shared/types";
import { api } from "./api";

export interface MeCtx {
  me: MeResponse;
  refresh: () => Promise<void>;
  setMe: (m: MeResponse) => void;
}

export const MeContext = createContext<MeCtx | null>(null);

export function useMe(): MeCtx {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("MeContext mancante");
  return ctx;
}

export function memberName(me: MeResponse, id: string): string {
  return me.members.find((m) => m.id === id)?.name || me.members.find((m) => m.id === id)?.email.split("@")[0] || "?";
}

/** Carica dati da una API con stato di caricamento/errore. */
export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const request = useRef(0);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const reload = useCallback(async () => {
    if (!path) return;
    const version = ++request.current;
    setLoading(true);
    try {
      const result = await api<T>("GET", path);
      if (version !== request.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (version === request.current) setError((e as Error).message);
    } finally {
      if (version === request.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    void reload();
    return () => { request.current++; };
  }, [reload]);
  return { data, setData, error, loading, reload };
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {error}
    </p>
  );
}

export function Loading({ label = "Caricamento…" }: { label?: string }) {
  return (
    <p className="muted row" aria-live="polite">
      <span className="spinner" aria-hidden /> {label}
    </p>
  );
}

export function Sheet({ onClose, children, title }: { onClose: () => void; children: ReactNode; title: string }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key !== "Tab") return;
      const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])];
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); previous?.focus(); };
  }, []);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div ref={dialog} tabIndex={-1} className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Chiudi">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const ICONS: Record<string, ReactNode> = {
  week: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2.5l2.2 10.5h10.6L20.5 7H6.4" />
      <circle cx="9.5" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5h10.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z" />
      <path d="M5 17a3 3 0 0 1 3-3h10.5" />
    </>
  ),
  pantry: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M4 10h16M4 15.5h16M9 6.5h6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
    </>
  ),
};

export function Icon({ name }: { name: keyof typeof ICONS | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

const DAY_NAMES = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
export const DAY_SHORT = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

export function weekdayOf(date: string): number {
  return new Date(date + "T12:00:00Z").getUTCDay();
}

export function formatDay(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
