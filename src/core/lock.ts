// Remote lock — a kill switch you can flip from anywhere.
//
// The flag lives in the repo as assets/lock.json ({ locked, message }). The
// app polls it and drops a fullscreen shield when locked; unlocking resumes
// automatically on a later poll.
//
// Read path: the GitHub Contents API first — a flip takes effect within one
// poll (~1 min), no waiting for a Pages rebuild. Conditional requests (ETag)
// keep the unauthenticated rate limit comfortable; a 304 means "unchanged".
// If the API is rate-limited or down, fall back to the same-origin copy that
// Pages serves (./lock.json — it lags a flip by one deploy, but always works,
// including `npm run dev`). Errors keep the LAST KNOWN state: an outage must
// never brick the app, and a locked app must not unlock just because the
// network dropped.
//
// Flip it: one click in the Publish panel (commits via the stored PAT), or
// edit assets/lock.json on github.com / the GitHub mobile app.

import { loadConfig, loadToken } from "../editor/publish";

export interface LockFlag {
  locked: boolean;
  message: string;
}

const LOCK_PATH = "assets/lock.json";
const POLL_MS = 60_000;
const REFOCUS_MIN_GAP_MS = 15_000; // re-check on tab focus, but not more often than this
const API_BACKOFF_MS = 10 * 60_000; // after a rate-limit/auth error, rest the API path

function parseFlag(raw: unknown): LockFlag {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    locked: r.locked === true,
    message: typeof r.message === "string" ? r.message : "",
  };
}

export class LockWatcher {
  /** Current known state (starts unlocked until the first successful read). */
  flag: LockFlag = { locked: false, message: "" };

  private etag: string | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastCheck = 0;
  private apiRestUntil = 0;
  private overlay: HTMLDivElement | null = null;
  private overlayMsg: HTMLDivElement | null = null;
  private onVis = () => {
    if (document.visibilityState === "visible" && Date.now() - this.lastCheck > REFOCUS_MIN_GAP_MS) {
      void this.check();
    }
  };

  constructor(private onChange: (flag: LockFlag) => void) {}

  start() {
    void this.check();
    this.timer = setInterval(() => void this.check(), POLL_MS);
    document.addEventListener("visibilitychange", this.onVis);
  }

  stop() {
    clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.onVis);
  }

  private async check() {
    this.lastCheck = Date.now();
    const viaApi = Date.now() >= this.apiRestUntil ? await this.checkApi() : null;
    if (viaApi === "unchanged") return;
    if (viaApi) {
      this.apply(viaApi);
      return;
    }
    // API unavailable → the copy this site itself serves (lags by one deploy).
    try {
      const r = await fetch(`./lock.json?ts=${Date.now()}`, { cache: "no-store" });
      if (r.ok) this.apply(parseFlag(await r.json()));
      // non-OK / network error: keep the last known state
    } catch {
      /* offline — keep the last known state */
    }
  }

  /** null = unavailable (use fallback), "unchanged" = 304, or the fresh flag. */
  private async checkApi(): Promise<LockFlag | "unchanged" | null> {
    const cfg = loadConfig();
    if (!cfg.owner || !cfg.repo) return null;
    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${LOCK_PATH}?ref=${encodeURIComponent(cfg.branch)}`;
    const headers: Record<string, string> = { Accept: "application/vnd.github.raw+json" };
    const token = loadToken();
    if (token) headers.Authorization = `Bearer ${token}`; // owner's machine: 5000 req/h instead of 60
    if (this.etag) headers["If-None-Match"] = this.etag;
    try {
      const r = await fetch(url, { headers });
      if (r.status === 304) return "unchanged";
      if (r.ok) {
        this.etag = r.headers.get("ETag");
        return parseFlag(await r.json());
      }
      if (r.status === 403 || r.status === 429 || r.status === 401) {
        this.apiRestUntil = Date.now() + API_BACKOFF_MS;
      }
      return null;
    } catch {
      return null;
    }
  }

  private apply(next: LockFlag) {
    const changed = next.locked !== this.flag.locked || next.message !== this.flag.message;
    this.flag = next;
    if (!changed) return;
    if (next.locked) this.showOverlay(next.message);
    else this.hideOverlay();
    this.onChange(next);
  }

  private showOverlay(message: string) {
    if (!this.overlay) {
      const o = document.createElement("div");
      Object.assign(o.style, {
        position: "fixed",
        inset: "0",
        zIndex: "9999",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "14px",
        background: "rgba(10, 12, 20, 0.82)",
        backdropFilter: "blur(14px)",
        color: "#cdd6f4",
        font: "500 15px/1.5 system-ui, sans-serif",
        textAlign: "center",
        padding: "24px",
        cursor: "default",
      } satisfies Partial<CSSStyleDeclaration>);
      const icon = document.createElement("div");
      icon.textContent = "🔒";
      icon.style.fontSize = "56px";
      const title = document.createElement("div");
      title.textContent = "MB5 is locked";
      title.style.cssText = "font:800 22px system-ui;color:#f9e2af";
      this.overlayMsg = document.createElement("div");
      this.overlayMsg.style.cssText = "max-width:420px;color:#a6adc8";
      const sub = document.createElement("div");
      sub.textContent = "It unlocks automatically when the switch is flipped back (checked about once a minute).";
      sub.style.cssText = "font-size:12px;color:#6c7391;max-width:420px";
      o.append(icon, title, this.overlayMsg, sub);
      // swallow interactions aimed at the app underneath
      for (const ev of ["pointerdown", "click", "wheel", "contextmenu"] as const) {
        o.addEventListener(ev, (e) => e.stopPropagation());
      }
      this.overlay = o;
    }
    if (this.overlayMsg) this.overlayMsg.textContent = message || "The owner has paused this app for now.";
    if (!this.overlay.isConnected) document.body.appendChild(this.overlay);
  }

  private hideOverlay() {
    this.overlay?.remove();
  }
}

/** Flip the remote lock by committing assets/lock.json (needs the publish PAT). */
export async function setRemoteLock(
  locked: boolean,
  message: string,
): Promise<{ ok: boolean; detail: string }> {
  const token = loadToken();
  if (!token) return { ok: false, detail: "No GitHub token saved — add it above first." };
  const cfg = loadConfig();
  const api = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${LOCK_PATH}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  let sha: string | undefined;
  try {
    const g = await fetch(`${api}?ref=${encodeURIComponent(cfg.branch)}`, { headers });
    if (g.ok) sha = ((await g.json()) as { sha?: string }).sha;
  } catch {
    /* file may not exist yet — create it */
  }
  const json = JSON.stringify({ locked, message }, null, 2) + "\n";
  const body = {
    message: locked ? "Lock app via editor" : "Unlock app via editor",
    content: btoa(unescape(encodeURIComponent(json))),
    branch: cfg.branch,
    ...(sha ? { sha } : {}),
  };
  try {
    const r = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
    if (r.ok) {
      return {
        ok: true,
        detail: locked
          ? "Locked — open clients lock within about a minute."
          : "Unlocked — open clients resume within about a minute.",
      };
    }
    const err = (await r.json().catch(() => ({}))) as { message?: string };
    return { ok: false, detail: `HTTP ${r.status}: ${err.message || r.statusText}` };
  } catch (e) {
    return { ok: false, detail: `Network error: ${String(e)}` };
  }
}
