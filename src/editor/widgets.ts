// Widgets — the editor's tiny design system (framework-free DOM).
//
// One injected stylesheet + a set of small builders (buttons, sliders, fields,
// sections, tabs, modals, toasts) shared by the map maker UI and the character
// designer, so every panel looks and behaves the same.

import type { Vec3 } from "../world/schema";

const CSS = `
.mb5{color:#cdd6f4;font:12.5px/1.45 system-ui,sans-serif;user-select:none;-webkit-user-select:none}
.mb5 *{box-sizing:border-box}
.mb5-panel{background:rgba(15,17,24,.95);border:1px solid #262a3a;border-radius:10px;
  box-shadow:0 8px 28px rgba(0,0,0,.45)}
.mb5-btn{background:#242838;color:#cdd6f4;border:1px solid #303650;border-radius:7px;
  padding:5px 10px;cursor:pointer;font:600 12px/1.2 system-ui;transition:background .12s}
.mb5-btn:hover{background:#2e3350}
.mb5-btn:disabled{opacity:.45;cursor:default}
.mb5-btn.active{background:#3a4a7a;border-color:#89b4fa;color:#fff}
.mb5-btn.primary{background:#1f6f4c;border-color:#2a9d68;color:#eaffef}
.mb5-btn.primary:hover{background:#268a5e}
.mb5-btn.danger{background:#6f1f2e;border-color:#a03048;color:#ffe3ea}
.mb5-btn.danger:hover{background:#8a2639}
.mb5-btn.ghost{background:transparent;border-color:transparent}
.mb5-btn.ghost:hover{background:#242838}
.mb5-icon{width:34px;height:34px;display:flex;align-items:center;justify-content:center;
  font-size:16px;padding:0;border-radius:8px}
.mb5-row{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin:4px 0}
.mb5-h{margin:12px 0 5px;font:700 10.5px/1 system-ui;letter-spacing:.09em;text-transform:uppercase;
  color:#89b4fa}
.mb5-h:first-child{margin-top:2px}
.mb5-lbl{font-size:11px;color:#8b92ab}
.mb5-in{background:#0e1017;color:#cdd6f4;border:1px solid #2c3147;border-radius:6px;
  font:12px system-ui;padding:4px 6px;outline:none;width:100%}
.mb5-in:focus{border-color:#89b4fa}
.mb5-in.num{width:58px;text-align:right}
.mb5-in.vec{width:52px;text-align:right;padding:3px 4px}
select.mb5-in{width:auto;flex:1}
.mb5-field{display:flex;gap:6px;align-items:center;margin:3px 0}
.mb5-field>.mb5-lbl{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mb5-slider{margin:5px 0 2px}
.mb5-slider input[type=range]{width:100%;accent-color:#89b4fa;height:18px;margin:0}
.mb5-sliderhead{display:flex;justify-content:space-between;font-size:11px;color:#8b92ab}
.mb5-sliderhead b{color:#cdd6f4;font-weight:600}
.mb5-tabbar{display:flex;gap:2px;padding:3px;background:#0e1017;border-radius:8px;margin-bottom:8px}
.mb5-tab{flex:1;text-align:center;padding:5px 2px;border-radius:6px;cursor:pointer;
  font:600 11.5px system-ui;color:#8b92ab}
.mb5-tab:hover{color:#cdd6f4}
.mb5-tab.active{background:#3a4a7a;color:#fff}
.mb5-swatch{width:22px;height:22px;border-radius:5px;border:1px solid #303650;flex:none}
input[type=color].mb5-color{width:30px;height:24px;padding:0;border:1px solid #2c3147;
  border-radius:6px;background:#0e1017;cursor:pointer}
input[type=checkbox].mb5-check{accent-color:#89b4fa;width:14px;height:14px;margin:0}
.mb5-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin:4px 0}
.mb5-toasts{position:fixed;top:54px;left:50%;transform:translateX(-50%);z-index:60;display:flex;
  flex-direction:column;gap:6px;align-items:center;pointer-events:none}
.mb5-toast{padding:7px 14px;border-radius:8px;font:600 12px system-ui;color:#dfe6ff;
  background:rgba(30,34,52,.97);border:1px solid #3a4166;box-shadow:0 6px 20px rgba(0,0,0,.4);
  animation:mb5in .18s ease-out}
.mb5-toast.ok{border-color:#2a9d68;color:#c9f7dd}
.mb5-toast.err{border-color:#a03048;color:#ffd7df}
@keyframes mb5in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.mb5-modalbg{position:fixed;inset:0;background:rgba(5,7,12,.6);z-index:50;display:flex;
  align-items:center;justify-content:center}
.mb5-modal{min-width:320px;max-width:440px;max-height:82vh;overflow-y:auto;padding:14px 16px}
.mb5-modalhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.mb5-modalhead b{font-size:14px}
.mb5-kbd{display:inline-block;background:#242838;border:1px solid #3a4166;border-bottom-width:2px;
  border-radius:5px;padding:1px 6px;font:600 11px ui-monospace,monospace;color:#cdd6f4}
.mb5-hint{font-size:11px;color:#6c7391;margin-top:4px}
.mb5-sep{height:1px;background:#262a3a;margin:9px 0}
.mb5-scroll{overflow-y:auto;scrollbar-width:thin;scrollbar-color:#303650 transparent}
.mb5-scroll::-webkit-scrollbar{width:8px}
.mb5-scroll::-webkit-scrollbar-thumb{background:#303650;border-radius:4px}
.mb5-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:7px;
  background:#242838;border:1px solid #303650;cursor:pointer;font:600 11.5px system-ui}
.mb5-chip:hover{background:#2e3350}
.mb5-chip.active{background:#3a4a7a;border-color:#89b4fa}
.mb5-hidden{display:none!important}
`;

let injected = false;
export function injectCss() {
  if (injected) return;
  injected = true;
  const s = document.createElement("style");
  s.id = "mb5-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

// --- element builders ---

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

export function div(cls?: string, parent?: HTMLElement): HTMLDivElement {
  return el("div", cls, parent);
}

export function txt<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  t: string,
  cls?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = el(tag, cls, parent);
  e.textContent = t;
  return e;
}

export function btn(
  label: string,
  onClick: () => void,
  cls = "",
  parent?: HTMLElement,
): HTMLButtonElement {
  const b = txt("button", label, `mb5-btn ${cls}`.trim(), parent);
  b.type = "button";
  b.onclick = () => {
    // Blur immediately: a focused button re-triggers on Space/Enter, which in
    // Play mode means the first jump press clicks "Stop" and kicks you out.
    b.blur();
    onClick();
  };
  return b;
}

export function row(parent?: HTMLElement): HTMLDivElement {
  return div("mb5-row", parent);
}

export function heading(t: string, parent: HTMLElement): HTMLElement {
  return txt("div", t, "mb5-h", parent);
}

export function sep(parent: HTMLElement) {
  div("mb5-sep", parent);
}

export function hint(t: string, parent: HTMLElement): HTMLElement {
  return txt("div", t, "mb5-hint", parent);
}

// --- form fields ---

export function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void,
  parent?: HTMLElement,
  fmt: (v: number) => string = (v) => String(Math.round(v * 1000) / 1000),
): { root: HTMLElement; set: (v: number) => void } {
  const root = div("mb5-slider", parent);
  const head = div("mb5-sliderhead", root);
  txt("span", label, "", head);
  const val = txt("b", fmt(value), "", head);
  const input = el("input", "", root);
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.oninput = () => {
    const v = parseFloat(input.value);
    val.textContent = fmt(v);
    onInput(v);
  };
  return {
    root,
    set: (v) => {
      input.value = String(v);
      val.textContent = fmt(v);
    },
  };
}

export function numField(
  label: string,
  value: number,
  onChange: (v: number) => void,
  parent?: HTMLElement,
  step = 1,
): { root: HTMLElement; input: HTMLInputElement } {
  const root = div("mb5-field", parent);
  txt("span", label, "mb5-lbl", root);
  const input = el("input", "mb5-in num", root);
  input.type = "number";
  input.step = String(step);
  input.value = String(value);
  input.onchange = () => onChange(parseFloat(input.value) || 0);
  return { root, input };
}

export function textField(
  label: string,
  value: string,
  onChange: (v: string) => void,
  parent?: HTMLElement,
): { root: HTMLElement; input: HTMLInputElement } {
  const root = div("mb5-field", parent);
  if (label) txt("span", label, "mb5-lbl", root);
  const input = el("input", "mb5-in", root);
  input.type = "text";
  input.value = value;
  input.onchange = () => onChange(input.value);
  return { root, input };
}

export function colorField(
  label: string,
  rgb: Vec3,
  onChange: (rgb: Vec3) => void,
  parent?: HTMLElement,
): { root: HTMLElement; set: (rgb: Vec3) => void } {
  const root = div("mb5-field", parent);
  txt("span", label, "mb5-lbl", root);
  const input = el("input", "mb5-color", root);
  input.type = "color";
  input.value = rgbToHex(rgb);
  input.oninput = () => onChange(hexToRgb(input.value));
  return { root, set: (c) => (input.value = rgbToHex(c)) };
}

export function selectField(
  label: string,
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange: (v: string) => void,
  parent?: HTMLElement,
): { root: HTMLElement; select: HTMLSelectElement } {
  const root = div("mb5-field", parent);
  if (label) txt("span", label, "mb5-lbl", root);
  const select = el("select", "mb5-in", root);
  for (const o of options) {
    const opt = el("option", "", select);
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
  }
  select.onchange = () => onChange(select.value);
  return { root, select };
}

export function checkbox(
  label: string,
  value: boolean,
  onChange: (v: boolean) => void,
  parent?: HTMLElement,
): { root: HTMLElement; input: HTMLInputElement } {
  const root = el("label", "mb5-field", parent);
  root.style.cursor = "pointer";
  const input = el("input", "mb5-check", root);
  input.type = "checkbox";
  input.checked = value;
  input.onchange = () => onChange(input.checked);
  txt("span", label, "mb5-lbl", root);
  return { root, input };
}

/** A labeled row of 3 numeric inputs (transform vectors). */
export function vecRow(
  name: string,
  value: [number, number, number],
  onCommit: () => void,
  parent?: HTMLElement,
): HTMLElement {
  const root = div("mb5-field", parent);
  root.dataset.vec = name;
  const lab = txt("span", name, "mb5-lbl", root);
  lab.style.width = "34px";
  lab.style.flex = "none";
  for (let i = 0; i < 3; i++) {
    const input = el("input", "mb5-in vec", root);
    input.type = "number";
    input.step = "0.1";
    input.value = String(value[i]);
    input.onchange = onCommit;
  }
  return root;
}

export function readVec(box: HTMLElement, name: string): [number, number, number] {
  const wrap = box.querySelector(`[data-vec="${name}"]`);
  if (!wrap) return [0, 0, 0];
  const inputs = Array.from(wrap.querySelectorAll("input")) as HTMLInputElement[];
  return [
    parseFloat(inputs[0].value) || 0,
    parseFloat(inputs[1].value) || 0,
    parseFloat(inputs[2].value) || 0,
  ];
}

// --- tabs ---

export function tabbar(
  tabs: Array<{ key: string; label: string }>,
  onPick: (key: string) => void,
  parent?: HTMLElement,
): { root: HTMLElement; set: (key: string) => void } {
  const root = div("mb5-tabbar", parent);
  const els = new Map<string, HTMLElement>();
  const set = (key: string) => {
    for (const [k, e] of els) e.classList.toggle("active", k === key);
  };
  for (const t of tabs) {
    const e = txt("div", t.label, "mb5-tab", root);
    els.set(t.key, e);
    e.onclick = () => {
      set(t.key);
      onPick(t.key);
    };
  }
  return { root, set };
}

// --- toasts ---

let toastBox: HTMLDivElement | null = null;
export function toast(msg: string, kind: "ok" | "err" | "info" = "info", ms = 2600) {
  if (!toastBox) {
    toastBox = div("mb5 mb5-toasts");
    document.body.appendChild(toastBox);
  }
  const t = txt("div", msg, `mb5-toast ${kind === "info" ? "" : kind}`.trim(), toastBox);
  setTimeout(() => {
    t.style.transition = "opacity .3s";
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 320);
  }, ms);
}

// --- modal ---

export function modal(title: string): { body: HTMLDivElement; close: () => void } {
  const bg = div("mb5 mb5-modalbg");
  const card = div("mb5-panel mb5-modal mb5-scroll", bg);
  const head = div("mb5-modalhead", card);
  txt("b", title, "", head);
  const x = btn("✕", () => close(), "ghost", head);
  x.style.padding = "2px 8px";
  const body = div("", card);
  const close = () => {
    bg.remove();
    removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  addEventListener("keydown", onKey);
  bg.onclick = (e) => {
    if (e.target === bg) close();
  };
  document.body.appendChild(bg);
  return { body, close };
}

// --- color helpers ---

export function rgbToHex(rgb: Vec3): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

export function hexToRgb(hex: string): Vec3 {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
