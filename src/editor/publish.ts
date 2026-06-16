// Publish to GitHub — commit the current level to the repo from the browser.
//
// Uses the GitHub Contents API with a fine-grained Personal Access Token
// (contents: read/write on this repo). The token + config live in localStorage,
// so this is for a trusted personal machine only. Pairs with the no-secrets
// "commit via Claude" loop documented in README.

import type { ContinentData } from "../world/schema";

export interface PublishConfig {
  owner: string;
  repo: string;
  branch: string;
  dir: string;
}

const CFG_KEY = "mb5.publish";
const TOK_KEY = "mb5.ghtoken";

export const DEFAULT_CFG: PublishConfig = {
  owner: "jbvyvf67cb-ai",
  repo: "mb5-development",
  branch: "claude/3d-globe-game-design-4aur60",
  dir: "assets/continents",
};

export function loadConfig(): PublishConfig {
  try {
    return { ...DEFAULT_CFG, ...(JSON.parse(localStorage.getItem(CFG_KEY) || "{}") as Partial<PublishConfig>) };
  } catch {
    return { ...DEFAULT_CFG };
  }
}

export function saveConfig(c: PublishConfig) {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export function loadToken(): string {
  try {
    return localStorage.getItem(TOK_KEY) || "";
  } catch {
    return "";
  }
}

export function saveToken(t: string) {
  try {
    if (t) localStorage.setItem(TOK_KEY, t);
    else localStorage.removeItem(TOK_KEY);
  } catch {
    /* ignore */
  }
}

/** UTF-8-safe base64 for the file content the Contents API expects. */
function toBase64(s: string): string {
  return btoa(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
}

export interface PublishResult {
  ok: boolean;
  message: string;
  url?: string;
}

/** Create or update assets/continents/<id>.json on the configured branch. */
export async function publishLevel(
  data: ContinentData,
  cfg: PublishConfig,
  token: string,
): Promise<PublishResult> {
  if (!token) return { ok: false, message: "No token set" };
  const id = data.meta.id || "continent";
  const path = `${cfg.dir.replace(/\/+$/, "")}/${id}.json`;
  const api = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  // Look up the existing file's SHA (required to update an existing file).
  let sha: string | undefined;
  try {
    const g = await fetch(`${api}?ref=${encodeURIComponent(cfg.branch)}`, { headers });
    if (g.ok) sha = (await g.json()).sha;
  } catch {
    /* new file or transient — proceed without sha */
  }

  const body = {
    message: `Publish map ${id} via editor`,
    content: toBase64(JSON.stringify(data, null, 2)),
    branch: cfg.branch,
    ...(sha ? { sha } : {}),
  };

  try {
    const r = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
    if (r.ok) {
      const j = await r.json();
      return { ok: true, message: `Published ${path}`, url: j.content?.html_url };
    }
    const err = await r.json().catch(() => ({ message: r.statusText }));
    return { ok: false, message: `HTTP ${r.status}: ${err.message || r.statusText}` };
  } catch (e) {
    return { ok: false, message: `Network error: ${String(e)}` };
  }
}
