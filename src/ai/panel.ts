// Assist panel — the shared "describe it" prompt box (map maker + character
// designer). Handles the browser-local API key, submission state, and a small
// result log; the host supplies what a prompt actually does.

import { btn, div, hint, txt } from "../editor/widgets";
import { loadApiKey, saveApiKey } from "./assist";

export interface AssistPanelOpts {
  title?: string;
  placeholder: string;
  /** Run the prompt; resolve to log lines to show (first line is the headline). */
  onPrompt: (prompt: string) => Promise<string[]>;
  /** Fixed bottom-right floating card (Build mode) vs inline block (designer). */
  floating?: boolean;
}

export function buildAssistPanel(opts: AssistPanelOpts): HTMLDivElement {
  const root = div(opts.floating ? "mb5 mb5-panel" : "");
  if (opts.floating) {
    Object.assign(root.style, {
      position: "fixed", right: "290px", bottom: "42px", width: "330px",
      padding: "10px", zIndex: "18",
    });
  } else {
    root.style.marginTop = "10px";
  }

  // header
  const head = div("", root);
  head.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:6px";
  txt("span", "✨", "", head);
  const title = txt("b", opts.title ?? "Assist", "", head);
  title.style.cssText = "font-size:12.5px";
  div("", head).style.flex = "1";
  const keyBtn = btn("key", () => toggleKey(), "ghost", head);
  keyBtn.style.cssText += "padding:2px 8px;font-size:11px";
  let collapse: HTMLButtonElement | null = null;
  const body = div("", root);
  if (opts.floating) {
    collapse = btn("—", () => {
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "block" : "none";
      collapse!.textContent = hidden ? "—" : "✨";
    }, "ghost", head);
    collapse.style.cssText += "padding:2px 8px";
  }

  // API key row (auto-hidden once a key is saved)
  const keyRow = div("", body);
  keyRow.style.cssText = "display:flex;gap:5px;margin-bottom:6px";
  const keyIn = document.createElement("input");
  keyIn.type = "password";
  keyIn.placeholder = "Anthropic API key (kept in this browser)";
  keyIn.className = "mb5-in";
  keyIn.value = loadApiKey();
  keyRow.appendChild(keyIn);
  btn("Save", () => {
    saveApiKey(keyIn.value.trim());
    status.textContent = keyIn.value.trim() ? "key saved (browser-local)" : "key cleared";
    keyRow.style.display = keyIn.value.trim() ? "none" : "flex";
  }, "", keyRow);
  const toggleKey = () => {
    keyRow.style.display = keyRow.style.display === "none" ? "flex" : "none";
  };
  keyRow.style.display = loadApiKey() ? "none" : "flex";

  // prompt box
  const ta = document.createElement("textarea");
  ta.className = "mb5-in";
  ta.rows = 2;
  ta.placeholder = opts.placeholder;
  ta.style.cssText += "resize:vertical;min-height:44px;font-family:inherit";
  body.appendChild(ta);

  const row = div("", body);
  row.style.cssText = "display:flex;gap:6px;align-items:center;margin-top:5px";
  const go = btn("Generate", () => submit(), "primary", row);
  const status = hint("", row);
  status.style.marginTop = "0";

  const log = div("", body);
  log.style.cssText = "max-height:130px;overflow-y:auto;margin-top:6px;font-size:11px;color:#8b92ab;line-height:1.5";

  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    e.stopPropagation(); // don't trigger editor shortcuts while typing
  });

  let busy = false;
  async function submit() {
    const prompt = ta.value.trim();
    if (!prompt || busy) return;
    if (!loadApiKey()) {
      keyRow.style.display = "flex";
      status.textContent = "add your Anthropic API key first";
      return;
    }
    busy = true;
    go.disabled = true;
    status.textContent = "thinking…";
    try {
      const lines = await opts.onPrompt(prompt);
      status.textContent = "✓";
      const entry = div("", log);
      entry.style.cssText = "border-top:1px solid #262a3a;padding:4px 0";
      txt("div", `» ${prompt}`, "", entry).style.color = "#cdd6f4";
      for (const l of lines) txt("div", l, "", entry);
      log.prepend(entry);
      ta.value = "";
    } catch (err) {
      status.textContent = "";
      const msg = err instanceof Error ? err.message : String(err);
      const entry = txt("div", `✗ ${msg}`, "", log);
      entry.style.cssText = "color:#f38ba8;border-top:1px solid #262a3a;padding:4px 0";
      log.prepend(entry);
    } finally {
      busy = false;
      go.disabled = false;
    }
  }

  return root;
}
