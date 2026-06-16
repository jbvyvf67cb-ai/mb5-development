// Editor UI — a DOM control panel overlaying the canvas.
//
// Tools, transform gizmos, prefab/entity palettes, sculpt brush, snap,
// undo/redo/duplicate, save/load, and an editable selection inspector
// (numeric transform + tint + collider). Framework-free plain DOM.

import type { ColliderKind, ContinentData, Vec3 } from "../world/schema";
import { allPrefabs } from "../world/prefabs";
import type { BrushMode, Editor, GizmoMode, Selection, Tool } from "./editor";

export interface EditorHost {
  editor: Editor;
  getData(): ContinentData;
  loadData(d: ContinentData): void;
  togglePlay(): void;
  isPlaying(): boolean;
}

const ENTITY_TYPES = ["playerSpawn", "coin", "checkpoint", "enemy"];
const TOOLS: Tool[] = ["select", "place", "sculpt", "entity"];
const GIZMOS: GizmoMode[] = ["move", "rotate", "scale"];
const BRUSHES: BrushMode[] = ["raise", "lower", "smooth", "flatten"];
const COLLIDERS: ColliderKind[] = ["auto", "box", "sphere", "capsule", "cylinder", "mesh", "none"];

export class EditorUI {
  root: HTMLDivElement;
  private host: EditorHost;
  private sections: Record<string, HTMLElement> = {};
  private inspector: HTMLDivElement;
  private playBtn: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private toolBtns = new Map<Tool, HTMLButtonElement>();

  constructor(host: EditorHost) {
    this.host = host;
    this.root = el("div", "mb5-editor");
    style(this.root, {
      position: "fixed",
      top: "10px",
      left: "10px",
      width: "240px",
      maxHeight: "calc(100vh - 20px)",
      overflowY: "auto",
      background: "rgba(16,18,26,0.94)",
      color: "#cdd6f4",
      font: "13px/1.45 system-ui, sans-serif",
      padding: "10px",
      borderRadius: "10px",
      boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
      userSelect: "none",
      zIndex: "10",
    });

    const head = el("div");
    style(head, { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" });
    head.appendChild(text("strong", "Map Maker"));
    this.playBtn = button("▶ Play", () => this.host.togglePlay());
    style(this.playBtn, { background: "#2a6", fontWeight: "600" });
    head.appendChild(this.playBtn);
    this.root.appendChild(head);

    // tools
    this.root.appendChild(this.label("Tool"));
    const toolRow = row();
    for (const t of TOOLS) {
      const b = button(cap(t), () => this.setTool(t));
      this.toolBtns.set(t, b);
      toolRow.appendChild(b);
    }
    this.root.appendChild(toolRow);

    // edit ops: undo/redo/dup/snap
    this.root.appendChild(this.label("Edit"));
    const opsRow = row();
    this.undoBtn = button("↶ Undo", () => this.host.editor.undo());
    this.redoBtn = button("↷ Redo", () => this.host.editor.redo());
    opsRow.appendChild(this.undoBtn);
    opsRow.appendChild(this.redoBtn);
    opsRow.appendChild(button("Duplicate", () => this.host.editor.duplicateSelected()));
    this.root.appendChild(opsRow);
    this.root.appendChild(checkbox("Snap to grid", false, (v) => this.host.editor.setSnap(v)));

    // gizmo (select)
    this.sections.gizmo = this.group("Transform");
    const gizRow = row();
    for (const m of GIZMOS) gizRow.appendChild(button(cap(m), () => this.host.editor.setGizmoMode(m)));
    this.sections.gizmo.appendChild(gizRow);

    // prefab palette (place), grouped by category
    this.sections.place = this.group("Prefab");
    const byCat = new Map<string, HTMLDivElement>();
    for (const def of allPrefabs()) {
      let r = byCat.get(def.category);
      if (!r) {
        r = row();
        byCat.set(def.category, r);
        this.sections.place.appendChild(r);
      }
      r.appendChild(
        button(def.label, () => {
          this.host.editor.placePrefab = def.key;
          this.highlightAcross(this.sections.place, def.label);
        }),
      );
    }

    // entity palette
    this.sections.entity = this.group("Entity");
    const eRow = row();
    for (const t of ENTITY_TYPES) {
      eRow.appendChild(
        button(t, () => {
          this.host.editor.entityType = t;
          this.highlight(eRow, t);
        }),
      );
    }
    this.sections.entity.appendChild(eRow);

    // brush (sculpt)
    this.sections.sculpt = this.group("Brush");
    const bRow = row();
    for (const m of BRUSHES)
      bRow.appendChild(
        button(cap(m), () => {
          this.host.editor.brush.mode = m;
          this.highlight(bRow, cap(m));
        }),
      );
    this.sections.sculpt.appendChild(bRow);
    this.sections.sculpt.appendChild(
      slider("Radius", 2, 30, this.host.editor.brush.radius, (v) => (this.host.editor.brush.radius = v)),
    );
    this.sections.sculpt.appendChild(
      slider("Strength", 0.1, 2, this.host.editor.brush.strength, (v) => (this.host.editor.brush.strength = v), 0.1),
    );

    // file ops
    this.root.appendChild(this.label("File"));
    const fRow = row();
    fRow.appendChild(button("Save", () => this.save()));
    fRow.appendChild(button("Load", () => this.load()));
    fRow.appendChild(button("Reset Cam", () => reframe()));
    this.root.appendChild(fRow);

    // inspector
    this.root.appendChild(this.label("Selection"));
    this.inspector = el("div");
    style(this.inspector, { minHeight: "20px", color: "#a6adc8" });
    this.inspector.textContent = "—";
    this.root.appendChild(this.inspector);

    const help = el("div");
    style(help, { marginTop: "10px", fontSize: "11px", color: "#7f849c" });
    help.textContent =
      "1-4 tools · Q/W/E gizmo · drag=orbit · wheel=zoom\nCtrl+Z/Y undo · Ctrl+D dup · F focus · Del remove\nPlay: WASD+Space, dbl-jump, Tab to exit";
    this.root.appendChild(help);

    document.body.appendChild(this.root);

    this.setTool("select");
    this.setMode(false);
    this.updateHistory();
  }

  setTool(t: Tool) {
    this.host.editor.setTool(t);
    for (const [k, b] of this.toolBtns) b.style.background = k === t ? "#456" : "#2a2d3a";
    this.sections.gizmo.style.display = t === "select" ? "block" : "none";
    this.sections.place.style.display = t === "place" ? "block" : "none";
    this.sections.entity.style.display = t === "entity" ? "block" : "none";
    this.sections.sculpt.style.display = t === "sculpt" ? "block" : "none";
  }

  updateHistory() {
    const h = this.host.editor.history;
    this.undoBtn.style.opacity = h.canUndo ? "1" : "0.4";
    this.redoBtn.style.opacity = h.canRedo ? "1" : "0.4";
  }

  showSelection(sel: Selection | null) {
    const box = this.inspector;
    box.textContent = "";
    if (!sel) {
      box.textContent = "—";
      return;
    }
    box.appendChild(text("div", `${sel.kind}: ${sel.label}`));
    const isPrefab = sel.kind === "prefab";

    const get = (): { pos: Vec3; rot: Vec3; scale: Vec3 } => ({
      pos: readVec(box, "pos"),
      rot: isPrefab ? readVec(box, "rot") : [0, 0, 0],
      scale: isPrefab ? readVec(box, "scale") : [1, 1, 1],
    });
    const commit = () => this.host.editor.setSelectedTransform(get());

    box.appendChild(vecRow("pos", sel.pos, commit));
    if (isPrefab) {
      box.appendChild(vecRow("rot", sel.rot, commit));
      box.appendChild(vecRow("scale", sel.scale, commit));

      const cRow = el("div");
      style(cRow, { display: "flex", gap: "6px", alignItems: "center", marginTop: "6px" });
      const color = el("input");
      color.type = "color";
      color.value = rgbToHex(sel.tint ?? [1, 1, 1]);
      color.onchange = () => this.host.editor.setSelectedTint(hexToRgb(color.value));
      cRow.appendChild(text("span", "tint"));
      cRow.appendChild(color);
      const collSel = el("select");
      for (const c of COLLIDERS) {
        const o = el("option");
        o.value = c;
        o.textContent = c;
        if ((sel.collider ?? "auto") === c) o.selected = true;
        collSel.appendChild(o);
      }
      collSel.onchange = () => this.host.editor.setSelectedCollider(collSel.value as ColliderKind);
      cRow.appendChild(collSel);
      box.appendChild(cRow);
    }

    const del = button("Delete", () => this.host.editor.deleteSelected());
    style(del, { marginTop: "6px", background: "#a33" });
    box.appendChild(del);
  }

  setMode(playing: boolean) {
    this.playBtn.textContent = playing ? "■ Edit" : "▶ Play";
    this.playBtn.style.background = playing ? "#a33" : "#2a6";
    // Collapse the whole editor panel while playing; Tab (or the HUD hint) exits.
    this.root.style.display = playing ? "none" : "block";
    if (!playing) this.setTool(this.host.editor.tool);
  }

  // --- helpers ---

  private save() {
    const data = this.host.getData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.meta.id || "continent"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private load() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        this.host.loadData(JSON.parse(await file.text()) as ContinentData);
      } catch (err) {
        console.error("[editor] failed to load JSON", err);
      }
    };
    input.click();
  }

  private label(t: string): HTMLElement {
    const d = text("div", t);
    style(d, {
      marginTop: "10px",
      marginBottom: "4px",
      fontWeight: "600",
      fontSize: "11px",
      textTransform: "uppercase",
      color: "#89b4fa",
    });
    return d;
  }

  private group(title: string): HTMLElement {
    const g = el("div");
    g.appendChild(this.label(title));
    this.root.appendChild(g);
    return g;
  }

  private highlight(rowEl: HTMLElement, activeLabel: string) {
    for (const c of Array.from(rowEl.children) as HTMLButtonElement[])
      c.style.background = c.textContent === activeLabel ? "#456" : "#2a2d3a";
  }

  private highlightAcross(container: HTMLElement, activeLabel: string) {
    for (const b of Array.from(container.querySelectorAll("button")) as HTMLButtonElement[])
      b.style.background = b.textContent === activeLabel ? "#456" : "#2a2d3a";
  }
}

// --- DOM helpers ---

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function text<K extends keyof HTMLElementTagNameMap>(tag: K, t: string): HTMLElementTagNameMap[K] {
  const e = el(tag);
  e.textContent = t;
  return e;
}
function style(e: HTMLElement, s: Partial<CSSStyleDeclaration>) {
  Object.assign(e.style, s);
}
function row(): HTMLDivElement {
  const r = el("div");
  style(r, { display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "4px" });
  return r;
}
function button(labelText: string, onClick: () => void): HTMLButtonElement {
  const b = text("button", labelText);
  style(b, {
    background: "#2a2d3a",
    color: "#cdd6f4",
    border: "none",
    borderRadius: "6px",
    padding: "5px 8px",
    cursor: "pointer",
    fontSize: "12px",
  });
  b.onclick = onClick;
  return b;
}
function checkbox(labelText: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const wrap = text("label", " " + labelText);
  style(wrap, { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", marginTop: "2px" });
  const input = el("input");
  input.type = "checkbox";
  input.checked = value;
  input.onchange = () => onChange(input.checked);
  wrap.prepend(input);
  return wrap;
}
function slider(
  labelText: string,
  min: number,
  max: number,
  value: number,
  onInput: (v: number) => void,
  step = 1,
): HTMLElement {
  const wrap = el("div");
  style(wrap, { marginTop: "6px" });
  const lab = text("div", `${labelText}: ${value}`);
  style(lab, { fontSize: "11px", color: "#a6adc8" });
  const input = el("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  style(input, { width: "100%" });
  input.oninput = () => {
    const v = parseFloat(input.value);
    lab.textContent = `${labelText}: ${v}`;
    onInput(v);
  };
  wrap.appendChild(lab);
  wrap.appendChild(input);
  return wrap;
}
/** A labeled row of 3 numeric inputs, tagged so readVec() can find it. */
function vecRow(name: string, value: [number, number, number], onCommit: () => void): HTMLElement {
  const wrap = el("div");
  wrap.dataset.vec = name;
  style(wrap, { display: "flex", gap: "4px", alignItems: "center", marginTop: "4px" });
  const lab = text("span", name);
  style(lab, { width: "34px", fontSize: "11px", color: "#a6adc8" });
  wrap.appendChild(lab);
  for (let i = 0; i < 3; i++) {
    const inp = el("input");
    inp.type = "number";
    inp.step = "0.1";
    inp.value = String(value[i]);
    style(inp, { width: "46px", background: "#11131a", color: "#cdd6f4", border: "1px solid #313244", borderRadius: "4px", fontSize: "11px", padding: "2px" });
    inp.onchange = onCommit;
    wrap.appendChild(inp);
  }
  return wrap;
}
function readVec(box: HTMLElement, name: string): Vec3 {
  const wrap = box.querySelector(`[data-vec="${name}"]`);
  if (!wrap) return [0, 0, 0];
  const inputs = Array.from(wrap.querySelectorAll("input")) as HTMLInputElement[];
  return [parseFloat(inputs[0].value) || 0, parseFloat(inputs[1].value) || 0, parseFloat(inputs[2].value) || 0];
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function rgbToHex(rgb: Vec3): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}
function hexToRgb(hex: string): Vec3 {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function reframe() {
  (window as unknown as { __reframe?: () => void }).__reframe?.();
}
