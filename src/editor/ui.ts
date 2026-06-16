// Editor UI — a DOM control panel overlaying the canvas.
//
// Reads/writes the current Editor (tools, gizmo mode, prefab/entity selection,
// brush) and offers save/load + a Play/Edit toggle. Kept framework-free: plain
// DOM, so it stays light and there's no extra build surface.

import type { ContinentData } from "../world/schema";
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

export class EditorUI {
  root: HTMLDivElement;
  private host: EditorHost;
  private sections: Record<string, HTMLElement> = {};
  private inspector: HTMLDivElement;
  private playBtn: HTMLButtonElement;
  private toolBtns = new Map<Tool, HTMLButtonElement>();

  constructor(host: EditorHost) {
    this.host = host;
    this.root = el("div", "mb5-editor");
    style(this.root, {
      position: "fixed",
      top: "10px",
      left: "10px",
      width: "230px",
      maxHeight: "calc(100vh - 20px)",
      overflowY: "auto",
      background: "rgba(16,18,26,0.92)",
      color: "#cdd6f4",
      font: "13px/1.45 system-ui, sans-serif",
      padding: "10px",
      borderRadius: "10px",
      boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
      userSelect: "none",
      zIndex: "10",
    });

    // header + play toggle
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

    // gizmo mode (select)
    this.sections.gizmo = this.group("Transform");
    const gizRow = row();
    for (const m of GIZMOS) gizRow.appendChild(button(cap(m), () => this.host.editor.setGizmoMode(m)));
    this.sections.gizmo.appendChild(gizRow);

    // prefab palette (place)
    this.sections.place = this.group("Prefab");
    const pRow = row();
    for (const def of allPrefabs()) {
      pRow.appendChild(
        button(def.label, () => {
          this.host.editor.placePrefab = def.key;
          this.highlight(pRow, def.label);
        }),
      );
    }
    this.sections.place.appendChild(pRow);

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
    for (const m of BRUSHES) bRow.appendChild(button(cap(m), () => {
      this.host.editor.brush.mode = m;
      this.highlight(bRow, cap(m));
    }));
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
    fRow.appendChild(button("Reset Cam", () => this.host.editor /* noop hook point */ && reframe()));
    this.root.appendChild(fRow);

    // inspector
    this.root.appendChild(this.label("Selection"));
    this.inspector = el("div");
    style(this.inspector, { minHeight: "20px", color: "#a6adc8", whiteSpace: "pre-line" });
    this.inspector.textContent = "—";
    this.root.appendChild(this.inspector);

    // help
    const help = el("div");
    style(help, { marginTop: "10px", fontSize: "11px", color: "#7f849c" });
    help.textContent =
      "Drag = orbit · wheel = zoom · tap = act\nDelete/Backspace removes selection\nPlay: WASD + Space, Tab to exit";
    this.root.appendChild(help);

    document.body.appendChild(this.root);

    addEventListener("keydown", (e) => {
      if (this.host.isPlaying()) return;
      if ((e.code === "Delete" || e.code === "Backspace") && document.activeElement === document.body) {
        this.host.editor.deleteSelected();
      }
    });

    this.setTool("select");
    this.setMode(false);
  }

  setTool(t: Tool) {
    this.host.editor.setTool(t);
    for (const [k, b] of this.toolBtns) b.style.background = k === t ? "#456" : "#2a2d3a";
    this.sections.gizmo.style.display = t === "select" ? "block" : "none";
    this.sections.place.style.display = t === "place" ? "block" : "none";
    this.sections.entity.style.display = t === "entity" ? "block" : "none";
    this.sections.sculpt.style.display = t === "sculpt" ? "block" : "none";
  }

  showSelection(sel: Selection | null) {
    if (!sel) {
      this.inspector.textContent = "—";
      return;
    }
    const f = (a: number[]) => a.map((n) => n.toFixed(2)).join(", ");
    this.inspector.textContent =
      `${sel.kind}: ${sel.label}\n` +
      `pos  ${f(sel.pos)}\n` +
      `rot  ${f(sel.rot)}\n` +
      `scl  ${f(sel.scale)}`;
  }

  setMode(playing: boolean) {
    this.playBtn.textContent = playing ? "■ Edit" : "▶ Play";
    this.playBtn.style.background = playing ? "#a33" : "#2a6";
    // hide editing controls while playing
    for (const key of ["gizmo", "place", "entity", "sculpt"]) this.sections[key].style.display = "none";
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
        const data = JSON.parse(await file.text()) as ContinentData;
        this.host.loadData(data);
      } catch (err) {
        console.error("[editor] failed to load JSON", err);
      }
    };
    input.click();
  }

  private label(t: string): HTMLElement {
    const d = text("div", t);
    style(d, { marginTop: "10px", marginBottom: "4px", fontWeight: "600", fontSize: "11px", textTransform: "uppercase", color: "#89b4fa" });
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
}

// --- tiny DOM helpers ---

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
  style(r, { display: "flex", flexWrap: "wrap", gap: "4px" });
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
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function reframe() {
  // Camera reframe is wired by App via window.__reframe (kept decoupled from UI).
  (window as unknown as { __reframe?: () => void }).__reframe?.();
}
