// Character Designer — a full-screen overlay mode.
//
// Left: animated pixel-sprite preview + roster. Right: full customization —
// body morph sliders (drive the sprite AND the play capsule), colors,
// accessory, stat sliders (with the derived movement numbers shown live), and
// the special-move loadout. Presets fork on edit; user characters autosave.

import {
  btn, checkbox, colorField, div, heading, hint, injectCss, row, selectField,
  slider, textField, toast, txt,
} from "../editor/widgets";
import type { Vec3 } from "../world/schema";
import {
  cloneCharacter, deriveMovement, MOVES, normalizeCharacter,
  type Accessory, type CharacterData,
} from "./schema";
import { drawCharacter, SPRITE_H, SPRITE_W, type PoseKind } from "./sprite";
import {
  activeCharacterId, allCharacters, deleteCharacter, isPreset, setActiveCharacter, upsertCharacter,
} from "./store";

const POSES: PoseKind[] = ["idle", "run", "jump", "fall", "dash", "pound", "glide"];
const SCALE = 5;

class Designer {
  private root: HTMLDivElement;
  private previewCanvas!: HTMLCanvasElement;
  private buffer = document.createElement("canvas");
  private rosterEl!: HTMLDivElement;
  private formEl!: HTMLDivElement;
  private nameEl!: HTMLDivElement;
  private current: CharacterData;
  private pose: PoseKind = "run";
  private raf = 0;
  private poseChips = new Map<PoseKind, HTMLElement>();

  constructor() {
    injectCss();
    this.buffer.width = SPRITE_W;
    this.buffer.height = SPRITE_H;
    this.current = cloneCharacter(allCharacters().find((c) => c.id === activeCharacterId()) ?? allCharacters()[0]);

    this.root = div("mb5");
    Object.assign(this.root.style, {
      position: "fixed", inset: "0", zIndex: "40", background: "#0b0d15",
      display: "flex", flexDirection: "column",
    });

    // header
    const head = div("", this.root);
    Object.assign(head.style, {
      display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px",
      borderBottom: "1px solid #262a3a",
    });
    const brand = txt("div", "MB5", "", head);
    brand.style.cssText = "font:800 15px system-ui;color:#89b4fa";
    txt("span", "Character Designer", "", head).style.cssText = "font:600 13px system-ui;color:#cdd6f4";
    div("", head).style.flex = "1";
    btn("Import", () => this.importJson(), "", head);
    btn("Export", () => this.exportJson(), "", head);
    const use = btn("Use in Play", () => {
      this.persist();
      setActiveCharacter(this.current.id);
      this.renderRoster();
      toast(`${this.current.name} is now the active character`, "ok");
    }, "primary", head);
    use.title = "Play mode will spawn this character";
    btn("✕ Close", () => this.close(), "", head);

    // body: left preview/roster + right form
    const main = div("", this.root);
    Object.assign(main.style, { display: "flex", flex: "1", minHeight: "0" });

    const left = div("mb5-scroll", main);
    Object.assign(left.style, {
      width: "300px", padding: "14px", borderRight: "1px solid #262a3a", overflowY: "auto",
    });
    this.nameEl = div("", left);
    this.previewCanvas = document.createElement("canvas");
    this.previewCanvas.width = SPRITE_W * SCALE;
    this.previewCanvas.height = SPRITE_H * SCALE;
    Object.assign(this.previewCanvas.style, {
      width: "100%", imageRendering: "pixelated", background: "linear-gradient(#2b3350,#1a2035 70%,#39415e 70%)",
      borderRadius: "10px", border: "1px solid #262a3a",
    });
    left.appendChild(this.previewCanvas);
    const poseRow = row(left);
    for (const p of POSES) {
      const chip = txt("div", p, "mb5-chip", poseRow);
      chip.onclick = () => this.setPose(p);
      this.poseChips.set(p, chip);
    }
    heading("Roster", left);
    this.rosterEl = div("", left);
    const rRow = row(left);
    btn("+ New", () => this.newCharacter(), "", rRow);
    btn("Duplicate", () => this.fork(`${this.current.name} copy`), "", rRow);
    btn("Delete", () => this.remove(), "danger", rRow);
    hint("Presets fork automatically when edited. Everything autosaves to this browser.", left);

    this.formEl = div("mb5-scroll", main);
    Object.assign(this.formEl.style, { flex: "1", padding: "14px 18px", overflowY: "auto", maxWidth: "560px" });

    document.body.appendChild(this.root);
    this.setPose("run");
    this.renderRoster();
    this.renderForm();
    this.loop();
  }

  private setPose(p: PoseKind) {
    this.pose = p;
    for (const [k, chip] of this.poseChips) chip.classList.toggle("active", k === p);
  }

  // --- edit plumbing ---

  /** Mutate the current character (forking presets first), persist, re-render preview. */
  private edit(fn: (c: CharacterData) => void, rebuildForm = false) {
    if (isPreset(this.current.id)) {
      this.current = cloneCharacter(this.current);
      this.current.id = `c${Date.now().toString(36)}`;
      this.current.name = `${this.current.name} ★`;
      fn(this.current);
      this.persist();
      this.renderRoster();
      this.renderForm(); // name changed
      toast(`Forked preset → "${this.current.name}"`, "ok");
      return;
    }
    fn(this.current);
    this.persist();
    if (rebuildForm) this.renderForm();
  }

  private persist() {
    if (!isPreset(this.current.id)) upsertCharacter(this.current);
  }

  private newCharacter() {
    this.current = normalizeCharacter({ name: "New character" });
    this.persist();
    this.renderRoster();
    this.renderForm();
  }

  private fork(name: string) {
    this.current = cloneCharacter(this.current);
    this.current.id = `c${Date.now().toString(36)}`;
    this.current.name = name;
    this.persist();
    this.renderRoster();
    this.renderForm();
  }

  private remove() {
    if (isPreset(this.current.id)) {
      toast("Presets can't be deleted", "err");
      return;
    }
    if (!confirm(`Delete "${this.current.name}"?`)) return;
    deleteCharacter(this.current.id);
    this.current = cloneCharacter(allCharacters()[0]);
    this.renderRoster();
    this.renderForm();
  }

  private select(c: CharacterData) {
    this.current = cloneCharacter(c);
    this.renderRoster();
    this.renderForm();
  }

  // --- left column ---

  private renderRoster() {
    const box = this.rosterEl;
    box.textContent = "";
    const activeId = activeCharacterId();
    for (const c of allCharacters()) {
      const item = div("mb5-chip", box);
      Object.assign(item.style, { width: "100%", marginBottom: "4px", justifyContent: "space-between" });
      const left = div("", item);
      left.style.cssText = "display:flex;align-items:center;gap:7px";
      const dot = div("", left);
      dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${vecCss(c.colors.fur)}`;
      txt("span", c.name, "", left);
      const tags = div("", item);
      tags.style.cssText = "display:flex;gap:4px;align-items:center";
      if (isPreset(c.id)) txt("span", "preset", "mb5-lbl", tags);
      if (c.id === activeId) {
        const a = txt("span", "▶ active", "", tags);
        a.style.cssText = "color:#a6e3a1;font-size:10.5px;font-weight:700";
      }
      if (c.id === this.current.id) item.classList.add("active");
      item.onclick = () => this.select(c);
    }
  }

  // --- right column (form) ---

  private renderForm() {
    const box = this.formEl;
    box.textContent = "";
    const c = this.current;

    // name row
    this.nameEl.textContent = "";
    const nameWrap = div("", this.nameEl);
    nameWrap.style.marginBottom = "8px";
    textField("", c.name, (v) => {
      this.edit((cc) => (cc.name = v || "Unnamed"));
      this.renderRoster();
    }, nameWrap).input.style.cssText += "font:700 14px system-ui;padding:6px 8px";

    const grid = div("", box);
    grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:0 26px";
    const colA = div("", grid);
    const colB = div("", grid);

    heading("Body", colA);
    const b = c.body;
    slider("Height", 0.75, 1.35, 0.01, b.height, (v) => this.edit((cc) => (cc.body.height = v)), colA);
    slider("Width", 0.75, 1.35, 0.01, b.width, (v) => this.edit((cc) => (cc.body.width = v)), colA);
    slider("Weight", 0, 1, 0.01, b.weight, (v) => this.edit((cc) => (cc.body.weight = v)), colA);
    slider("Head size", 0.8, 1.3, 0.01, b.head, (v) => this.edit((cc) => (cc.body.head = v)), colA);
    slider("Ears", 0.4, 1.8, 0.01, b.ears, (v) => this.edit((cc) => (cc.body.ears = v)), colA);
    hint("Height/width/weight also change the physics capsule and mass in Play.", colA);

    heading("Colors", colA);
    colorField("Fur", c.colors.fur, (v) => this.edit((cc) => (cc.colors.fur = v)), colA);
    colorField("Muzzle & ears", c.colors.muzzle, (v) => this.edit((cc) => (cc.colors.muzzle = v)), colA);
    colorField("Belly", c.colors.belly, (v) => this.edit((cc) => (cc.colors.belly = v)), colA);
    colorField("Accessory", c.colors.accent, (v) => this.edit((cc) => (cc.colors.accent = v)), colA);
    selectField(
      "Accessory",
      [
        { value: "none", label: "None" },
        { value: "bowtie", label: "Bow tie" },
        { value: "cap", label: "Cap" },
        { value: "scarf", label: "Scarf" },
      ],
      c.accessory,
      (v) => this.edit((cc) => (cc.accessory = v as Accessory)),
      colA,
    );

    heading("Stats", colB);
    const statNote = div("", colB);
    const renderDerived = () => {
      const d = deriveMovement(this.current);
      statNote.innerHTML = "";
      hint(
        `run ${d.runSpeed.toFixed(1)} m/s · jump ${d.jumpVelocity.toFixed(1)} m/s · ` +
          `dash ${d.dashSpeed.toFixed(1)} m/s · mass ${Math.round(d.mass)} kg`,
        statNote,
      );
    };
    const statSlider = (label: string, key: keyof CharacterData["stats"]) => {
      slider(label, 1, 10, 1, c.stats[key], (v) => {
        this.edit((cc) => (cc.stats[key] = v));
        renderDerived();
      }, colB);
    };
    statSlider("Speed", "speed");
    statSlider("Jump", "jump");
    statSlider("Attack", "attack");
    statSlider("Defense", "defense");
    colB.appendChild(statNote);
    renderDerived();
    hint("Attack/defense are stored for combat (coming later).", colB);

    heading("Special moves", colB);
    for (const m of MOVES) {
      const wrap = div("", colB);
      wrap.style.marginBottom = "6px";
      checkbox(`${m.label} — ${m.control}`, c.moves.includes(m.key), (on) => {
        this.edit((cc) => {
          cc.moves = on ? [...new Set([...cc.moves, m.key])] : cc.moves.filter((k) => k !== m.key);
        });
      }, wrap);
      const d = txt("div", m.desc, "mb5-hint", wrap);
      d.style.marginLeft = "22px";
      d.style.marginTop = "0";
    }
  }

  // --- preview loop ---

  private loop = () => {
    const t = (performance.now() / 900) % 1;
    const ctx2 = this.buffer.getContext("2d")!;
    drawCharacter(ctx2, this.current, this.pose, t);
    const ctx = this.previewCanvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    ctx.drawImage(this.buffer, 0, 0, this.previewCanvas.width, this.previewCanvas.height);
    this.raf = requestAnimationFrame(this.loop);
  };

  // --- import/export ---

  private exportJson() {
    const blob = new Blob([JSON.stringify(this.current, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${this.current.id}.character.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Character downloaded", "ok");
  }

  private importJson() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const c = normalizeCharacter(JSON.parse(await file.text()));
        this.current = c;
        this.persist();
        this.renderRoster();
        this.renderForm();
        toast(`Imported ${c.name}`, "ok");
      } catch {
        toast("Could not parse that file", "err");
      }
    };
    input.click();
  }

  close() {
    cancelAnimationFrame(this.raf);
    this.root.remove();
    instance = null;
  }
}

let instance: Designer | null = null;

export function openDesigner() {
  if (!instance) instance = new Designer();
}

function vecCss(c: Vec3): string {
  return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
}
