// Assist panel — the shared "describe it" prompt box (map maker + character
// designer). Handles the browser-local API key, submission state, and a small
// result log; the host supplies what a prompt actually does.

import { btn, div, hint, txt } from "../editor/widgets";
import { loadApiKey, saveApiKey } from "./assist";

export interface AssistImage {
  /** Base64 payload (no data: prefix). */
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}

/**
 * Read an image file for the API, downscaling to maxEdge px (long side) —
 * phone photos of drawings are routinely 4000px/8MB, past API limits and
 * wasted tokens; ~1568px is the model's sweet spot.
 */
export async function fileToAssistImage(
  file: File,
  maxEdge = 1568,
): Promise<{ image: AssistImage; url: string }> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("could not read the file"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("that file is not a readable image"));
    im.src = url;
  });
  const edge = Math.max(img.width, img.height);
  if (edge <= maxEdge && url.length < 4_000_000) {
    const mediaType = (file.type || "image/png") as AssistImage["mediaType"];
    return { image: { data: url.slice(url.indexOf(",") + 1), mediaType }, url };
  }
  const k = Math.min(1, maxEdge / edge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * k));
  canvas.height = Math.max(1, Math.round(img.height * k));
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpeg = canvas.toDataURL("image/jpeg", 0.92);
  return { image: { data: jpeg.slice(jpeg.indexOf(",") + 1), mediaType: "image/jpeg" }, url: jpeg };
}

export interface AssistPanelOpts {
  title?: string;
  placeholder: string;
  /** Run the prompt; resolve to log lines to show (first line is the headline). */
  onPrompt: (prompt: string, image?: AssistImage) => Promise<string[]>;
  /** Fixed bottom-right floating card (Build mode) vs inline block (designer). */
  floating?: boolean;
  /** Show a 📷 attach button (image + prompt → generation). */
  withImage?: boolean;
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

  // optional image attachment (drawing/photo/reference → generation)
  let image: AssistImage | undefined;
  let thumb: HTMLImageElement | null = null;
  const setImage = (img: AssistImage | undefined, url?: string) => {
    image = img;
    if (thumb) {
      thumb.style.display = img ? "inline-block" : "none";
      if (url) thumb.src = url;
    }
  };
  if (opts.withImage) {
    const attach = btn("📷", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/webp,image/gif";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        fileToAssistImage(file)
          .then(({ image: img, url }) => setImage(img, url))
          .catch(() => setImage(undefined));
      };
      input.click();
    }, "", row);
    attach.title = "Attach an image (a drawing, a photo, a reference character)";
    thumb = document.createElement("img");
    thumb.style.cssText = "width:26px;height:26px;object-fit:cover;border-radius:5px;border:1px solid #303650;display:none;cursor:pointer";
    thumb.title = "Click to remove the image";
    thumb.onclick = () => setImage(undefined);
    row.appendChild(thumb);
  }

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
      const lines = await opts.onPrompt(prompt, image);
      setImage(undefined);
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
