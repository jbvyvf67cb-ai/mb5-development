// Editor UI — the map maker's chrome (framework-free DOM).
//
// Layout: a top bar (file ops, undo/redo, mode switch, Play), a left tool rail
// with a contextual options panel (prefab palette w/ search, sculpt brushes,
// entity palette, gizmo+snap), a right tabbed panel (Inspector | Level | Style)
// and a bottom status bar. Style tab = full aesthetic control (sky/fog/sun/
// water/terrain palette). All widgets come from widgets.ts.

import type { ColliderKind, ContinentData, EnvSettings, PaletteStop, Vec3 } from "../world/schema";
import { DEFAULT_PALETTE } from "../world/schema";
import { allPrefabs } from "../world/prefabs";
import type { BrushMode, Editor, GizmoMode, Selection, Tool } from "./editor";
import { loadConfig, loadToken, publishLevel, saveConfig, saveToken } from "./publish";
import { activeCharacterId, allCharacters, setActiveCharacter } from "../character/store";
import { SKINS } from "../world/skins";
import { buildAssistPanel } from "../ai/panel";
import type { LevelOp } from "../ai/ops";
import {
  btn, checkbox, colorField, div, el, heading, hint, injectCss, modal, numField, readVec,
  rgbToHex, row, selectField, sep, slider, tabbar, textField, toast, txt, vecRow,
} from "./widgets";

export interface EditorHost {
  editor: Editor;
  data: ContinentData;
  getData(): ContinentData;
  loadData(d: ContinentData): void;
  togglePlay(): void;
  isPlaying(): boolean;
  setMeta(patch: { name?: string; gravityY?: number; killPlaneY?: number }): void;
  setPhysics(patch: Partial<import("../world/schema").LevelPhysics>): void;
  setSeaLevel(v: number | undefined): void;
  setEnv(patch: Partial<EnvSettings>): void;
  getEnv(): Required<EnvSettings>;
  setPalette(stops: PaletteStop[] | undefined): void;
  getPalette(): PaletteStop[];
  resizeTerrain(size: [number, number], res: [number, number]): void;
  regenTerrain(resolution: number): void;
  newLevel(): void;
  loadDemo(): void;
  setReferenceImage(file: File): void;
  setReferenceOpacity(v: number): void;
  clearReference(): void;
  openDesigner(): void;
  applyAiOps(ops: LevelOp[]): Promise<string[]>;
  /** Toggle the top-down orthographic geography view; returns the new state. */
  toggleTopView(): boolean;
}

const ENTITY_TYPES: Array<{ key: string; label: string; color: string }> = [
  { key: "playerSpawn", label: "Spawn", color: "#4ade80" },
  { key: "coin", label: "Coin", color: "#facc15" },
  { key: "checkpoint", label: "Checkpoint", color: "#60a5fa" },
  { key: "enemy", label: "Enemy", color: "#f87171" },
];
const TOOLS: Array<{ key: Tool; icon: string; label: string; hintText: string }> = [
  { key: "select", icon: "⌖", label: "Select (1)", hintText: "click to select · Q/W/E gizmo · F focus · Del delete · Ctrl+D duplicate" },
  { key: "place", icon: "▦", label: "Place (2)", hintText: "click a surface to place the chosen prefab" },
  { key: "sculpt", icon: "⛰", label: "Sculpt (3)", hintText: "drag on terrain to sculpt · orbit is paused while sculpting" },
  { key: "entity", icon: "◈", label: "Entity (4)", hintText: "click to drop the chosen gameplay marker" },
];
const GIZMOS: GizmoMode[] = ["move", "rotate", "scale"];
const BRUSHES: BrushMode[] = ["raise", "lower", "smooth", "flatten", "land", "water", "stream"];
const COLLIDERS: ColliderKind[] = ["auto", "box", "sphere", "capsule", "cylinder", "mesh", "none"];

const ENV_PRESETS: Record<string, Partial<EnvSettings>> = {
  Day: { sky: [0.05, 0.07, 0.11], horizon: [0.18, 0.16, 0.14], fogDensity: 0, sunColor: [1, 0.98, 0.92], sunIntensity: 1.4, sunAzimuth: 240, sunElevation: 55, ambient: 0.55, waterColor: [0.1, 0.32, 0.55], waterOpacity: 0.66, fogColor: [0.55, 0.65, 0.8] },
  Sunset: { sky: [0.72, 0.38, 0.24], horizon: [0.5, 0.28, 0.22], fogColor: [0.85, 0.55, 0.38], fogDensity: 0.0022, sunColor: [1, 0.68, 0.42], sunIntensity: 1.15, sunAzimuth: 265, sunElevation: 12, ambient: 0.42, waterColor: [0.22, 0.28, 0.48], waterOpacity: 0.7 },
  Night: { sky: [0.02, 0.03, 0.08], horizon: [0.05, 0.06, 0.12], fogColor: [0.04, 0.07, 0.16], fogDensity: 0.0035, sunColor: [0.6, 0.7, 1], sunIntensity: 0.35, sunAzimuth: 40, sunElevation: 35, ambient: 0.25, waterColor: [0.03, 0.1, 0.22], waterOpacity: 0.75 },
  Alien: { sky: [0.14, 0.05, 0.2], horizon: [0.2, 0.08, 0.25], fogColor: [0.45, 0.18, 0.55], fogDensity: 0.004, sunColor: [0.9, 0.55, 1], sunIntensity: 1.1, sunAzimuth: 120, sunElevation: 40, ambient: 0.5, waterColor: [0.45, 0.12, 0.42], waterOpacity: 0.6 },
};

export class EditorUI {
  private host: EditorHost;
  private chrome: HTMLElement[] = [];
  private toolPanels: Partial<Record<Tool, HTMLDivElement>> = {};
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private gizmoBtns = new Map<GizmoMode, HTMLButtonElement>();
  private brushBtns = new Map<BrushMode, HTMLButtonElement>();
  private inspectorEl!: HTMLDivElement;
  private levelEl!: HTMLDivElement;
  private styleEl!: HTMLDivElement;
  private statusHint!: HTMLElement;
  private statusStats!: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private playBtn!: HTMLButtonElement;
  private charSelect!: HTMLSelectElement;
  private rightTabs!: { set: (k: string) => void };

  constructor(host: EditorHost) {
    this.host = host;
    injectCss();
    this.buildTopbar();
    this.buildRail();
    this.buildToolPanels();
    this.buildStatusBar(); // before the right panel: its initial render updates the stats line
    this.buildRightPanel();
    this.buildAssist();
    addEventListener("keydown", (e) => {
      if (e.key === "?" && !isTyping()) this.showShortcuts();
    });
    this.setTool("select");
    this.setMode(false);
    this.updateHistory();
  }

  /** Claude prompt box: describe additions/changes, ops apply as normal edits. */
  private buildAssist() {
    const panel = buildAssistPanel({
      title: "Assist — describe a change",
      placeholder: "e.g. \"ring of pillars around the peak\", \"make it a snowy night\", \"a village by the east beach with fences and trees\"",
      floating: true,
      onPrompt: async (prompt) => {
        const { generateLevelOps } = await import("../ai/assist");
        const res = await generateLevelOps(prompt, this.host.getData());
        const log = await this.host.applyAiOps(res.ops);
        toast("Assist applied — Ctrl+Z undoes placed objects", "ok");
        return [res.summary, ...log];
      },
    });
    document.body.appendChild(panel);
    this.chrome.push(panel);
  }

  // ------------------------------------------------- top bar
  private buildTopbar() {
    const bar = div("mb5 mb5-panel");
    Object.assign(bar.style, {
      position: "fixed", top: "8px", left: "10px", right: "10px", height: "42px",
      display: "flex", alignItems: "center", gap: "6px", padding: "0 10px", zIndex: "20",
    });
    const brand = txt("div", "MB5", "", bar);
    Object.assign(brand.style, { font: "800 15px system-ui", color: "#89b4fa", letterSpacing: ".04em" });
    txt("span", "Studio", "", bar).style.cssText = "font:600 12px system-ui;color:#6c7391;margin-right:8px";

    // mode switch: Build (this editor) | Characters (the designer)
    const modes = div("mb5-tabbar", bar);
    modes.style.marginBottom = "0";
    const build = txt("div", "Build", "mb5-tab active", modes);
    build.style.padding = "5px 14px";
    const chars = txt("div", "Characters", "mb5-tab", modes);
    chars.style.padding = "5px 14px";
    chars.onclick = () => this.host.openDesigner();
    build.onclick = () => {};

    div("", bar).style.flex = "1";

    btn("New", () => confirm("Discard current level and start fresh?") && this.host.newLevel(), "", bar);
    btn("Open", () => this.load(), "", bar);
    btn("Save", () => this.save(), "", bar);
    btn("Demo", () => confirm("Discard current level and load the demo?") && this.host.loadDemo(), "", bar);
    const imp = btn("🗺 Import", () => this.showMapImport(), "", bar);
    imp.title = "Turn a drawn map (photo/scan) into a full continent with Claude";
    btn("Publish", () => this.showPublish(), "", bar);
    div("", bar).style.cssText = "width:1px;height:22px;background:#262a3a;margin:0 4px";
    this.undoBtn = btn("↶", () => this.host.editor.undo(), "ghost", bar);
    this.undoBtn.title = "Undo (Ctrl+Z)";
    this.redoBtn = btn("↷", () => this.host.editor.redo(), "ghost", bar);
    this.redoBtn.title = "Redo (Ctrl+Y)";
    // who you'll play as — kept in sync with the designer's "Use in Play"
    this.charSelect = el("select", "mb5-in", bar);
    this.charSelect.title = "Character for Play mode (edit in the Characters tab)";
    Object.assign(this.charSelect.style, { width: "110px", flex: "none", marginLeft: "4px" });
    this.charSelect.onchange = () => {
      setActiveCharacter(this.charSelect.value);
      this.charSelect.blur();
    };
    this.refreshCharacter();
    this.playBtn = btn("▶ Play", () => this.host.togglePlay(), "primary", bar);
    this.playBtn.style.marginLeft = "4px";

    document.body.appendChild(bar);
    this.chrome.push(bar);
    this.topbar = bar;
  }
  private topbar!: HTMLDivElement;

  // ------------------------------------------------- left rail + tool panels
  private buildRail() {
    const rail = div("mb5 mb5-panel");
    Object.assign(rail.style, {
      position: "fixed", top: "58px", left: "10px", width: "44px", padding: "5px",
      display: "flex", flexDirection: "column", gap: "4px", zIndex: "15", alignItems: "center",
    });
    for (const t of TOOLS) {
      const b = btn(t.icon, () => this.setTool(t.key), "icon ghost", rail);
      b.title = t.label;
      b.classList.add("mb5-icon");
      this.toolBtns.set(t.key, b);
    }
    div("", rail).style.cssText = "height:1px;width:26px;background:#262a3a;margin:2px 0";
    const cam = btn("⌂", () => (window as unknown as { __reframe?: () => void }).__reframe?.(), "icon ghost", rail);
    cam.title = "Frame level (reset camera)";
    cam.classList.add("mb5-icon");
    this.topBtn = btn("⬒", () => this.setTopView(this.host.toggleTopView()), "icon ghost", rail);
    this.topBtn.title = "Top view (T) — orthographic map view for painting land, water, and streams";
    this.topBtn.classList.add("mb5-icon");
    document.body.appendChild(rail);
    this.chrome.push(rail);
  }

  private topBtn!: HTMLButtonElement;

  /** Reflect the top-view state on the rail button (App calls this too). */
  setTopView(on: boolean) {
    this.topBtn?.classList.toggle("active", on);
    if (on) this.setStatusHint("Top view — paint with Sculpt's Land/Water/Stream brushes · wheel zooms · right-drag pans · T to exit");
  }

  private buildToolPanels() {
    const wrap = div("mb5 mb5-panel mb5-scroll");
    Object.assign(wrap.style, {
      position: "fixed", top: "58px", left: "62px", width: "230px", padding: "10px",
      maxHeight: "calc(100vh - 120px)", overflowY: "auto", zIndex: "14",
    });
    document.body.appendChild(wrap);
    this.chrome.push(wrap);

    // --- select panel
    const sel = div("", wrap);
    heading("Transform", sel);
    const gRow = row(sel);
    for (const m of GIZMOS) {
      const b = btn(cap(m), () => this.setGizmo(m), "", gRow);
      this.gizmoBtns.set(m, b);
    }
    heading("Snap", sel);
    const ed = this.host.editor;
    checkbox("Snap to grid", ed.snap.enabled, (v) => ed.setSnap(v), sel);
    numField("Position step", ed.snap.pos, (v) => (ed.snap.pos = Math.max(0.1, v)), sel, 0.5);
    numField("Rotation step °", ed.snap.rotDeg, (v) => (ed.snap.rotDeg = Math.max(1, v)), sel, 5);
    numField("Scale step", ed.snap.scale, (v) => (ed.snap.scale = Math.max(0.05, v)), sel, 0.05);
    hint("Drag gizmo handles to transform. F focuses the selection.", sel);
    this.toolPanels.select = sel;

    // --- place panel
    const place = div("", wrap);
    heading("Prefabs", place);
    const search = el("input", "mb5-in", place);
    search.type = "search";
    search.placeholder = "Search…";
    search.oninput = () => filterPalette();
    const palette = div("", place);
    const chips: Array<{ el: HTMLElement; key: string; label: string }> = [];
    const byCat = new Map<string, HTMLDivElement>();
    for (const def of allPrefabs()) {
      let box = byCat.get(def.category);
      if (!box) {
        heading(cap(def.category), palette).dataset.cat = def.category;
        box = div("mb5-row", palette);
        byCat.set(def.category, box);
      }
      const chip = div("mb5-chip", box);
      const sw = div("mb5-swatch", chip);
      sw.style.background = rgbToHex(def.baseColor);
      sw.style.width = "14px";
      sw.style.height = "14px";
      txt("span", def.label, "", chip);
      chip.onclick = () => {
        this.host.editor.placePrefab = def.key;
        for (const c of chips) c.el.classList.toggle("active", c.key === def.key);
        this.setStatusHint(`click a surface to place ${def.label}`);
      };
      chips.push({ el: chip, key: def.key, label: def.label.toLowerCase() });
      if (def.key === this.host.editor.placePrefab) chip.classList.add("active");
    }
    const filterPalette = () => {
      const q = search.value.trim().toLowerCase();
      for (const c of chips) (c.el as HTMLElement).style.display = !q || c.label.includes(q) ? "" : "none";
    };
    hint("Click a chip, then click in the world. Snap applies from the Select tool settings.", place);
    this.toolPanels.place = place;

    // --- sculpt panel
    const sc = div("", wrap);
    heading("Brush", sc);
    const bRow = row(sc);
    for (const m of BRUSHES) {
      const b = btn(cap(m), () => this.setBrush(m), "", bRow);
      this.brushBtns.set(m, b);
    }
    slider("Radius", 2, 40, 1, ed.brush.radius, (v) => (ed.brush.radius = v), sc);
    slider("Strength", 0.1, 3, 0.1, ed.brush.strength, (v) => (ed.brush.strength = v), sc);
    hint("Flatten levels toward the height you first clicked. Physics rebuilds when you release.", sc);
    heading("Geography", sc);
    slider("Land height", 1, 14, 0.5, ed.brush.landHeight, (v) => (ed.brush.landHeight = v), sc);
    slider("Water depth", 0.5, 8, 0.5, ed.brush.waterDepth, (v) => (ed.brush.waterDepth = v), sc);
    hint(
      "Land / Water / Stream reshape coastlines relative to sea level: Land grows islands (never crushes peaks), Water digs ocean and lakes, Stream carves narrow channels (use a small radius). Best from the top view (T). Painting water turns the ocean on if the level has none. For lava lakes and ponds at altitude, place the Lava pool / Water pool prefabs and scale them.",
      sc,
    );
    this.toolPanels.sculpt = sc;

    // --- entity panel
    const ent = div("", wrap);
    heading("Gameplay markers", ent);
    const eRow = row(ent);
    const echips: HTMLElement[] = [];
    for (const t of ENTITY_TYPES) {
      const chip = div("mb5-chip", eRow);
      const dot = div("", chip);
      dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${t.color}`;
      txt("span", t.label, "", chip);
      chip.onclick = () => {
        this.host.editor.entityType = t.key;
        for (const c of echips) c.classList.toggle("active", c === chip);
        this.setStatusHint(`click to drop a ${t.label}`);
      };
      echips.push(chip);
      if (t.key === this.host.editor.entityType) chip.classList.add("active");
    }
    hint("Spawn = where Play starts. Checkpoints update the respawn. Coins are collectible.", ent);
    this.toolPanels.entity = ent;
  }

  // ------------------------------------------------- right panel (tabs)
  private buildRightPanel() {
    const panel = div("mb5 mb5-panel");
    Object.assign(panel.style, {
      position: "fixed", top: "58px", right: "10px", width: "270px", padding: "10px",
      maxHeight: "calc(100vh - 120px)", display: "flex", flexDirection: "column", zIndex: "15",
      overflow: "hidden",
    });
    const bodies: Record<string, HTMLDivElement> = {};
    this.rightTabs = tabbar(
      [
        { key: "inspector", label: "Inspector" },
        { key: "level", label: "Level" },
        { key: "style", label: "Style" },
      ],
      (k) => {
        for (const [key, b] of Object.entries(bodies)) b.style.display = key === k ? "block" : "none";
      },
      panel,
    );
    const scroll = div("mb5-scroll", panel);
    scroll.style.cssText = "overflow-y:auto;flex:1;min-height:0";
    for (const k of ["inspector", "level", "style"]) {
      bodies[k] = div("", scroll);
      bodies[k].style.display = k === "inspector" ? "block" : "none";
    }
    this.inspectorEl = bodies.inspector;
    this.levelEl = bodies.level;
    this.styleEl = bodies.style;
    this.rightTabs.set("inspector");
    this.buildLevelTab();
    this.buildStyleTab();
    this.showSelection(null);
    document.body.appendChild(panel);
    this.chrome.push(panel);
  }

  /** (Re)build the Level tab from current data. */
  private buildLevelTab() {
    const box = this.levelEl;
    box.textContent = "";
    const meta = this.host.data.meta;
    heading("Level", box);
    textField("Name", meta.name, (v) => this.host.setMeta({ name: v }), box);
    numField("Kill plane Y", meta.killPlaneY ?? -40, (v) => this.host.setMeta({ killPlaneY: v }), box);

    heading("Physics", box);
    numField("Gravity Y", meta.gravity?.[1] ?? -16, (v) => this.host.setMeta({ gravityY: v }), box);
    const phys = meta.physics ?? {};
    slider("Run speed ×", 0.25, 3, 0.05, phys.runMultiplier ?? 1, (v) => this.host.setPhysics({ runMultiplier: v }), box);
    slider("Jump power ×", 0.25, 2.5, 0.05, phys.jumpMultiplier ?? 1, (v) => this.host.setPhysics({ jumpMultiplier: v }), box);
    slider("Air control", 0, 1, 0.05, phys.airControl ?? 1, (v) => this.host.setPhysics({ airControl: v }), box);
    hint("Multipliers over the character's stats — feel can differ per level (low gravity, speed stages…). Applies on the next Play.", box);

    heading("Water", box);
    const seaOn = meta.seaLevel !== undefined;
    let seaVal = meta.seaLevel ?? 0;
    const seaNum = numField("Sea level Y", seaVal, (v) => {
      seaVal = v;
      if (chk.input.checked) this.host.setSeaLevel(v);
    }, box, 0.5);
    const chk = checkbox("Ocean plane", seaOn, (v) => this.host.setSeaLevel(v ? seaVal : undefined), box);
    box.insertBefore(chk.root, seaNum.root);

    heading("Terrain", box);
    const t = this.host.data.terrain;
    let sizeX = t?.size[0] ?? 120;
    let sizeZ = t?.size[1] ?? 120;
    let cols = t?.resolution[0] ?? 41;
    let rows = t?.resolution[1] ?? 41;
    numField("Size X (m)", sizeX, (v) => (sizeX = clampN(v, 20, 2000)), box, 10);
    numField("Size Z (m)", sizeZ, (v) => (sizeZ = clampN(v, 20, 2000)), box, 10);
    numField("Grid cols", cols, (v) => (cols = clampN(Math.round(v), 2, 257)), box, 8);
    numField("Grid rows", rows, (v) => (rows = clampN(Math.round(v), 2, 257)), box, 8);
    const tRow = row(box);
    btn("Apply (resample)", () => {
      this.host.resizeTerrain([sizeX, sizeZ], [cols, rows]);
      toast("Terrain resampled", "ok");
    }, "", tRow);
    btn("New flat", () => {
      if (confirm("Replace the terrain with a flat grid? (undo not available)"))
        this.host.regenTerrain(cols);
    }, "", tRow);
    hint("Resample keeps the current shape at a new size/detail. Sculpt is cheaper at lower grid sizes.", box);

    heading("Reference image", box);
    const rRow = row(box);
    btn("Load…", () => this.pickReference(), "", rRow);
    btn("Clear", () => this.host.clearReference(), "", rRow);
    slider("Opacity", 0, 1, 0.05, 0.6, (v) => this.host.setReferenceOpacity(v), box);
    hint("Underlay a photo of a hand-drawn map to trace it with the sculpt brush.", box);
  }

  /** (Re)build the Style tab from the current environment + palette. */
  private buildStyleTab() {
    const box = this.styleEl;
    box.textContent = "";
    const env = this.host.getEnv();
    const set = (patch: Partial<EnvSettings>) => this.host.setEnv(patch);

    heading("Presets", box);
    const pRow = row(box);
    for (const [name, preset] of Object.entries(ENV_PRESETS)) {
      btn(name, () => {
        this.host.setEnv(preset);
        this.buildStyleTab(); // re-read values into the controls
        toast(`${name} preset applied`, "ok");
      }, "", pRow);
    }

    heading("Sky & light", box);
    colorField("Sky", env.sky, (c) => set({ sky: c }), box);
    colorField("Horizon bounce", env.horizon, (c) => set({ horizon: c }), box);
    colorField("Sun color", env.sunColor, (c) => set({ sunColor: c }), box);
    slider("Sun intensity", 0, 3, 0.05, env.sunIntensity, (v) => set({ sunIntensity: v }), box);
    slider("Sun azimuth °", 0, 360, 5, env.sunAzimuth, (v) => set({ sunAzimuth: v }), box);
    slider("Sun elevation °", 5, 90, 1, env.sunElevation, (v) => set({ sunElevation: v }), box);
    slider("Ambient", 0, 1.5, 0.05, env.ambient, (v) => set({ ambient: v }), box);

    heading("Fog", box);
    colorField("Fog color", env.fogColor, (c) => set({ fogColor: c }), box);
    slider("Fog density", 0, 0.02, 0.0005, env.fogDensity, (v) => set({ fogDensity: v }), box, (v) => v.toFixed(4));

    heading("Water", box);
    colorField("Water color", env.waterColor, (c) => set({ waterColor: c }), box);
    slider("Water opacity", 0.05, 1, 0.05, env.waterOpacity, (v) => set({ waterOpacity: v }), box);

    heading("Terrain palette", box);
    hint("Elevation → color ramp, low to high. Edit heights/colors, add or remove stops.", box);
    const palBox = div("", box);
    const stops: PaletteStop[] = this.host.getPalette().map((s) => ({ h: s.h, color: [...s.color] as Vec3 }));
    const apply = () => {
      stops.sort((a, b) => a.h - b.h);
      this.host.setPalette(stops.map((s) => ({ h: s.h, color: [...s.color] as Vec3 })));
    };
    const rebuild = () => {
      palBox.textContent = "";
      stops.forEach((s, i) => {
        const r = div("mb5-field", palBox);
        const color = el("input", "mb5-color", r);
        color.type = "color";
        color.value = rgbToHex(s.color);
        color.oninput = () => {
          s.color = hexToRgbLocal(color.value);
          apply();
        };
        const h = el("input", "mb5-in num", r);
        h.type = "number";
        h.step = "0.5";
        h.value = String(s.h);
        h.onchange = () => {
          s.h = parseFloat(h.value) || 0;
          apply();
        };
        txt("span", "m", "mb5-lbl", r);
        const rm = btn("✕", () => {
          if (stops.length <= 2) return;
          stops.splice(i, 1);
          apply();
          rebuild();
        }, "ghost", r);
        rm.style.padding = "2px 7px";
        rm.title = "Remove stop";
      });
      const aRow = row(palBox);
      btn("+ Add stop", () => {
        if (stops.length >= 8) return;
        const last = stops[stops.length - 1];
        stops.push({ h: last.h + 8, color: [...last.color] as Vec3 });
        apply();
        rebuild();
      }, "", aRow);
      btn("Reset", () => {
        stops.length = 0;
        for (const s of DEFAULT_PALETTE) stops.push({ h: s.h, color: [...s.color] as Vec3 });
        this.host.setPalette(undefined);
        rebuild();
      }, "", aRow);
    };
    rebuild();
  }

  // ------------------------------------------------- status bar
  private buildStatusBar() {
    const bar = div("mb5 mb5-panel");
    Object.assign(bar.style, {
      position: "fixed", left: "10px", right: "10px", bottom: "8px", height: "26px",
      display: "flex", alignItems: "center", gap: "10px", padding: "0 10px",
      fontSize: "11px", color: "#8b92ab", zIndex: "15",
    });
    this.statusHint = txt("span", "", "", bar);
    this.statusHint.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0";
    div("", bar).style.cssText = "flex:1 0 12px";
    this.statusStats = txt("span", "", "", bar);
    this.statusStats.style.cssText = "white-space:nowrap;flex:none";
    const help = btn("?", () => this.showShortcuts(), "ghost", bar);
    help.style.padding = "1px 8px";
    help.title = "Keyboard shortcuts (?)";
    document.body.appendChild(bar);
    this.chrome.push(bar);
    this.updateStats();
  }

  private setStatusHint(t: string) {
    this.statusHint.textContent = t;
  }

  updateStats() {
    const d = this.host.data;
    const t = d.terrain;
    this.statusStats.textContent =
      `${d.prefabs.length} prefabs · ${d.entities.length} entities` +
      (t ? ` · ${t.resolution[0]}×${t.resolution[1]} terrain` : "") +
      " · autosave on";
  }

  // ------------------------------------------------- overlays
  private showShortcuts() {
    const m = modal("Keyboard & mouse");
    const table: Array<[string, string]> = [
      ["1 – 4", "Tools: Select · Place · Sculpt · Entity"],
      ["Q / W / E", "Gizmo: move / rotate / scale"],
      ["F", "Focus camera on selection"],
      ["Del", "Delete selection"],
      ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
      ["Ctrl+D", "Duplicate selection"],
      ["Tab", "Toggle Play mode"],
      ["drag / wheel", "Orbit / zoom camera"],
      ["right-drag", "Pan camera"],
      ["?", "This help"],
      ["— Play mode —", ""],
      ["WASD / arrows", "Move (camera-relative)"],
      ["Space", "Jump — again in air for double jump, hold to glide (if unlocked)"],
      ["Shift", "Dash (if unlocked)"],
      ["C", "Ground pound (if unlocked)"],
    ];
    for (const [k, desc] of table) {
      const r = div("mb5-field", m.body);
      const kk = txt("span", k, k.startsWith("—") ? "mb5-lbl" : "mb5-kbd", r);
      kk.style.minWidth = "110px";
      txt("span", desc, "mb5-lbl", r);
    }
  }

  /** 🗺 Import: a drawn map (photo/scan/sketch) → a full continent via Claude. */
  private showMapImport() {
    const m = modal("🗺 Import a map from a drawing");
    hint(
      "Attach a photo or scan of a drawn map. Claude reads it — coastlines, mountains, rivers, " +
      "forests, paths, labels — and builds the whole continent: terrain, scenery, and a playable " +
      "route (spawn → coins → checkpoints → goal), no questions asked. Then tune it by hand or " +
      "with the ✨ Assist box, and Publish it to the repo like any level.",
      m.body,
    );
    sep(m.body);

    // API key (same browser-local key as the Assist boxes)
    const keyRow = row(m.body);
    const keyIn = el("input", "mb5-in", keyRow);
    keyIn.type = "password";
    keyIn.placeholder = "Anthropic API key (kept in this browser)";
    btn("Save key", async () => {
      const { saveApiKey } = await import("../ai/assist");
      saveApiKey(keyIn.value.trim());
      keyRow.style.display = keyIn.value.trim() ? "none" : "flex";
    }, "", keyRow);
    void import("../ai/assist").then(({ loadApiKey }) => {
      keyIn.value = loadApiKey();
      keyRow.style.display = loadApiKey() ? "none" : "flex";
    });

    let image: import("../ai/panel").AssistImage | undefined;
    const pickRow = row(m.body);
    btn("📷 Choose image…", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/webp,image/gif";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const { fileToAssistImage } = await import("../ai/panel");
          const res = await fileToAssistImage(file);
          image = res.image;
          preview.src = res.url;
          preview.style.display = "block";
        } catch (err) {
          status.textContent = err instanceof Error ? err.message : String(err);
        }
      };
      input.click();
    }, "", pickRow);
    const preview = el("img", "", m.body);
    preview.style.cssText =
      "display:none;max-width:100%;max-height:230px;object-fit:contain;border-radius:8px;border:1px solid #303650;margin:6px 0";

    const ta = el("textarea", "mb5-in", m.body);
    ta.rows = 2;
    ta.placeholder = "optional guidance — e.g. \"the west island is a volcano\", \"night theme\", \"go heavy on coins\"";
    ta.style.cssText += "resize:vertical;font-family:inherit;margin-top:6px";
    ta.addEventListener("keydown", (e) => e.stopPropagation());

    const status = hint("", m.body);
    const log = div("", m.body);
    log.style.cssText = "font-size:11px;color:#8b92ab;line-height:1.5;max-height:120px;overflow-y:auto";

    let busy = false;
    const go = btn("Build the continent", async () => {
      if (busy) return;
      if (!image) {
        status.textContent = "attach a picture of the map first";
        return;
      }
      const { loadApiKey } = await import("../ai/assist");
      if (!loadApiKey()) {
        keyRow.style.display = "flex";
        status.textContent = "add your Anthropic API key first";
        return;
      }
      busy = true;
      go.disabled = true;
      (status as HTMLElement).style.color = "";
      status.textContent = "reading the drawing… (a detailed map can take a few minutes)";
      try {
        const { generateMapPlan } = await import("../ai/assist");
        const plan = await generateMapPlan(image, ta.value, (chars) => {
          status.textContent = `drafting the plan… ${(chars / 1024).toFixed(1)} KB of map so far`;
        });
        status.textContent = "rasterizing terrain + placing everything…";
        const { compileMapPlan } = await import("../ai/mapplan");
        const { data, log: lines } = compileMapPlan(plan);
        this.host.loadData(data);
        toast(`Imported "${data.meta.name}" ✓ — tune it, then Publish`, "ok", 5000);
        status.textContent = plan.notes || "done";
        log.textContent = "";
        for (const l of lines) txt("div", l, "", log);
      } catch (err) {
        (status as HTMLElement).style.color = "#f38ba8";
        status.textContent = err instanceof Error ? err.message : String(err);
      } finally {
        busy = false;
        go.disabled = false;
      }
    }, "primary", m.body);
  }

  private showPublish() {
    const m = modal("Publish to GitHub");
    const cfg = loadConfig();
    hint("Writes the current level JSON into your repo via the GitHub API. Needs a fine-grained PAT with Contents: write. The token stays in this browser.", m.body);
    sep(m.body);
    const tok = el("input", "mb5-in", m.body);
    tok.type = "password";
    tok.placeholder = "fine-grained PAT";
    tok.value = loadToken();
    const tRow = row(m.body);
    btn("Save token", () => {
      saveToken(tok.value.trim());
      toast("Token saved (browser-local)", "ok");
    }, "", tRow);
    btn("Clear", () => {
      saveToken("");
      tok.value = "";
    }, "", tRow);
    sep(m.body);
    const mk = (label: string, key: keyof typeof cfg) =>
      textField(label, cfg[key], (v) => {
        cfg[key] = v.trim();
        saveConfig(cfg);
      }, m.body);
    mk("Owner", "owner");
    mk("Repo", "repo");
    mk("Branch", "branch");
    mk("Dir", "dir");
    sep(m.body);
    const status = hint("", m.body);
    const go = btn("Publish level", async () => {
      go.disabled = true;
      status.textContent = "publishing…";
      const res = await publishLevel(this.host.getData(), cfg, tok.value.trim());
      status.textContent = res.message;
      (status as HTMLElement).style.color = res.ok ? "#a6e3a1" : "#f38ba8";
      toast(res.ok ? "Published ✓" : "Publish failed", res.ok ? "ok" : "err");
      go.disabled = false;
    }, "primary", m.body);

    sep(m.body);
    heading("🔒 Remote lock", m.body);
    hint("A kill switch: commits assets/lock.json to the repo. Every open client polls it about once a minute and shows a lock screen while it's on. Flip it here (uses the token above) or by editing the file on GitHub.", m.body);
    const lockMsg = el("input", "mb5-in", m.body);
    lockMsg.placeholder = "optional lock-screen message";
    const lockStatus = hint("", m.body);
    const lockRow = row(m.body);
    const flip = async (locked: boolean, b: HTMLButtonElement) => {
      b.disabled = true;
      lockStatus.textContent = locked ? "locking…" : "unlocking…";
      const { setRemoteLock } = await import("../core/lock");
      const res = await setRemoteLock(locked, lockMsg.value.trim());
      lockStatus.textContent = res.detail;
      (lockStatus as HTMLElement).style.color = res.ok ? "#a6e3a1" : "#f38ba8";
      toast(res.ok ? (locked ? "App locked 🔒" : "App unlocked 🔓") : "Lock flip failed", res.ok ? "ok" : "err");
      b.disabled = false;
    };
    const lockBtn = btn("🔒 Lock the app", () => void flip(true, lockBtn), "danger", lockRow);
    const unlockBtn = btn("🔓 Unlock", () => void flip(false, unlockBtn), "", lockRow);
  }

  // ------------------------------------------------- tool state
  setTool(t: Tool) {
    this.host.editor.setTool(t);
    for (const [k, b] of this.toolBtns) b.classList.toggle("active", k === t);
    for (const [k, p] of Object.entries(this.toolPanels))
      (p as HTMLElement).style.display = k === t ? "block" : "none";
    const def = TOOLS.find((x) => x.key === t);
    this.setStatusHint(def ? `${cap(t)} — ${def.hintText}` : "");
    if (t === "select") this.setGizmo(this.host.editor.gizmoMode);
    if (t === "sculpt") this.setBrush(this.host.editor.brush.mode);
  }

  private setGizmo(m: GizmoMode) {
    this.host.editor.setGizmoMode(m);
    for (const [k, b] of this.gizmoBtns) b.classList.toggle("active", k === m);
  }

  private setBrush(m: BrushMode) {
    this.host.editor.brush.mode = m;
    for (const [k, b] of this.brushBtns) b.classList.toggle("active", k === m);
  }

  updateHistory() {
    const h = this.host.editor.history;
    this.undoBtn.disabled = !h.canUndo;
    this.redoBtn.disabled = !h.canRedo;
    this.updateStats();
  }

  /** Re-sync the Level + Style tabs from current data (after load/new). */
  refreshPanels() {
    this.buildLevelTab();
    this.buildStyleTab();
    this.updateStats();
  }

  /** Repopulate the top-bar character picker (roster/active may have changed). */
  refreshCharacter() {
    this.charSelect.textContent = "";
    const active = activeCharacterId();
    for (const c of allCharacters()) {
      const o = el("option", "", this.charSelect);
      o.value = c.id;
      o.textContent = c.name;
      if (c.id === active) o.selected = true;
    }
  }

  // ------------------------------------------------- inspector
  showSelection(sel: Selection | null) {
    const box = this.inspectorEl;
    box.textContent = "";
    if (!sel) {
      heading("Selection", box);
      hint("Nothing selected. Use the Select tool (1) and click a prefab or marker.", box);
      this.updateStats();
      return;
    }
    heading(sel.kind === "prefab" ? "Prefab" : "Entity", box);
    const title = txt("div", sel.label, "", box);
    title.style.cssText = "font:700 13px system-ui;margin-bottom:2px";
    const idl = txt("div", sel.id, "mb5-lbl", box);
    idl.style.marginBottom = "6px";

    const isPrefab = sel.kind === "prefab";
    const commit = () =>
      this.host.editor.setSelectedTransform({
        pos: readVec(box, "pos"),
        rot: isPrefab ? readVec(box, "rot") : [0, 0, 0],
        scale: isPrefab ? readVec(box, "scale") : [1, 1, 1],
      });
    vecRow("pos", sel.pos, commit, box);
    if (isPrefab) {
      vecRow("rot", sel.rot, commit, box);
      vecRow("scale", sel.scale, commit, box);
      colorField("Tint", sel.tint ?? [1, 1, 1], (c) => this.host.editor.setSelectedTint(c), box);
      selectField(
        "Skin",
        SKINS.map((s) => ({ value: s, label: cap(s) })),
        sel.skin ?? "default",
        (v) => this.host.editor.setSelectedSkin(v),
        box,
      );
      selectField(
        "Collider",
        COLLIDERS.map((c) => ({ value: c, label: c })),
        sel.collider ?? "auto",
        (v) => this.host.editor.setSelectedCollider(v as ColliderKind),
        box,
      );
      this.buildPropsEditor(box, sel);
    }
    const bRow = row(box);
    bRow.style.marginTop = "8px";
    if (isPrefab) btn("Duplicate", () => this.host.editor.duplicateSelected(), "", bRow);
    btn("Focus", () => this.host.editor.focusSelected(), "", bRow);
    btn("Delete", () => this.host.editor.deleteSelected(), "danger", bRow);
    this.updateStats();
  }

  /** Hide/show ALL build chrome (used by the Characters tab / design mode). */
  setHidden(hidden: boolean) {
    for (const c of this.chrome) c.classList.toggle("mb5-hidden", hidden);
    this.topbar.classList.toggle("mb5-hidden", hidden);
  }

  /** Gameplay-prefab tuning fields (moving platform path, spring/boost power). */
  private buildPropsEditor(box: HTMLElement, sel: Selection) {
    const props = sel.props ?? {};
    const set = (patch: Record<string, unknown>) => this.host.editor.setSelectedProps(patch);
    const numOf = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
    if (sel.label === "movingPlatform") {
      heading("Motion", box);
      selectField(
        "Axis",
        [
          { value: "x", label: "X (east-west)" },
          { value: "y", label: "Y (up-down)" },
          { value: "z", label: "Z (north-south)" },
        ],
        typeof props.axis === "string" ? (props.axis as string) : "x",
        (v) => set({ axis: v }),
        box,
      );
      numField("Distance (m)", numOf(props.dist, 6), (v) => set({ dist: Math.max(0.5, v) }), box);
      numField("Speed (m/s)", numOf(props.speed, 2), (v) => set({ speed: Math.max(0.1, v) }), box, 0.5);
      hint("Moves back and forth from its placed position. Applies on the next Play.", box);
    } else if (sel.label === "spring") {
      heading("Spring", box);
      numField("Launch power", numOf(props.power, 19), (v) => set({ power: Math.max(2, v) }), box);
    } else if (sel.label === "boost") {
      heading("Boost", box);
      numField("Boost speed", numOf(props.power, 24), (v) => set({ power: Math.max(2, v) }), box);
      hint("Boosts along the pad's facing (rotate the pad to aim it).", box);
    }
  }

  // ------------------------------------------------- play-mode chrome
  setMode(playing: boolean) {
    this.playBtn.textContent = playing ? "■ Stop" : "▶ Play";
    this.playBtn.classList.toggle("danger", playing);
    this.playBtn.classList.toggle("primary", !playing);
    // Class-based hide: inline `display=""` would wipe the panels' flex display.
    for (const c of this.chrome) if (c !== this.topbar) c.classList.toggle("mb5-hidden", playing);
    // In play mode shrink the topbar to just the stop control.
    for (const child of Array.from(this.topbar.children) as HTMLElement[]) {
      if (child !== this.playBtn && !isBrandEl(child)) child.style.visibility = playing ? "hidden" : "visible";
    }
    if (!playing) this.setTool(this.host.editor.tool);
  }

  // ------------------------------------------------- file ops
  private save() {
    const data = this.host.getData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.meta.id || "continent"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Level downloaded", "ok");
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
        toast(`Loaded ${file.name}`, "ok");
      } catch (err) {
        console.error("[editor] failed to load JSON", err);
        toast("Could not parse that file", "err");
      }
    };
    input.click();
  }

  private pickReference() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) this.host.setReferenceImage(file);
    };
    input.click();
  }
}

// --- tiny local helpers ---

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function clampN(v: number, lo: number, hi: number): number {
  return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}
function hexToRgbLocal(hex: string): Vec3 {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function isTyping(): boolean {
  const tag = document.activeElement?.tagName ?? "";
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}
function isBrandEl(e: HTMLElement): boolean {
  return e.tagName === "DIV" && e.textContent === "MB5";
}
