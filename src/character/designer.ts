// Character Designer — a real mode you tab into (Build ⇄ Characters).
//
// The character renders as its live 3D rig in the actual engine scene, on a
// physical stage: panels sit at the edges of the screen and the center is
// transparent 3D you can orbit. Edits rebuild the rig live; 🧪 Test Drive
// hands the same stage to the real player controller so speed/jumps/moves are
// felt, not read. No modal, no Close — switch tabs like the user expects.

import { Color3, MeshBuilder, PhysicsAggregate, PhysicsShapeType, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { ArcRotateCamera, Scene } from "@babylonjs/core";
import {
  btn, checkbox, colorField, div, heading, hint, injectCss, row, selectField,
  slider, textField, toast, txt,
} from "../editor/widgets";
import { buildAssistPanel } from "../ai/panel";
import {
  ACCESSORIES, cloneCharacter, deriveMovement, normalizeCharacter,
  type Accessory, type BodyStyle, type CharacterData,
} from "./schema";
import { equipableMoves, SLOT_LABELS, type MoveSpec, type SlotKey } from "./moves";
import { CharacterRig, type RigPose } from "./rig";
import {
  activeCharacterId, allCharacters, deleteCharacter, isPreset, setActiveCharacter, upsertCharacter,
} from "./store";

const POSES: RigPose[] = ["idle", "run", "jump", "fall", "dash", "pound", "glide"];

/** The stage floats far above any loaded level so world physics can't reach it. */
const STAGE_Y = 500;

export interface DesignerHost {
  scene: Scene;
  camera: ArcRotateCamera;
  /** Switch back to the Build tab. */
  switchToBuild(): void;
  /** Enter Play in the loaded level as the active character. */
  useInPlay(): void;
  /** Start/stop the in-tab test drive with the current character. */
  startTest(ch: CharacterData, spawn: Vector3, killY: number): void;
  stopTest(): void;
}

// ------------------------------------------------------------------
// The stage: a physical test arena shared by the turntable view and the
// test drive (steps, a dash gap, a wall-jump channel).
// ------------------------------------------------------------------

class Stage {
  root: TransformNode;
  private aggregates: PhysicsAggregate[] = [];
  private mats: StandardMaterial[] = [];

  constructor(scene: Scene, baseY: number) {
    this.root = new TransformNode("designStage", scene);
    const mat = (r: number, g: number, b: number) => {
      const m = new StandardMaterial("stageMat", scene);
      m.diffuseColor = new Color3(r, g, b);
      m.specularColor = new Color3(0.03, 0.03, 0.03);
      this.mats.push(m);
      return m;
    };
    const ground = MeshBuilder.CreateCylinder("stage:ground", { diameter: 44, height: 1, tessellation: 48 }, scene);
    ground.position.y = baseY - 0.5;
    ground.material = mat(0.36, 0.55, 0.36);
    const ring = MeshBuilder.CreateCylinder("stage:ring", { diameter: 46, height: 0.5, tessellation: 48 }, scene);
    ring.position.y = baseY - 0.85;
    ring.material = mat(0.5, 0.42, 0.3);
    ring.parent = this.root;

    const boxAt = (x: number, y: number, z: number, w: number, h: number, d: number, m: StandardMaterial) => {
      const bx = MeshBuilder.CreateBox("stage:box", { width: w, height: h, depth: d }, scene);
      bx.position.set(x, baseY + y, z);
      bx.material = m;
      bx.parent = this.root;
      this.aggregates.push(new PhysicsAggregate(bx, PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, scene));
      return bx;
    };
    const stone = mat(0.62, 0.6, 0.58);
    const teal = mat(0.45, 0.78, 0.72);
    // steps (jump heights)
    boxAt(7, 0.5, -2, 3, 1, 3, stone);
    boxAt(10, 1, 1, 3, 2, 3, stone);
    boxAt(13, 1.5, 4.5, 3, 3, 3, stone);
    // dash gap (two pads over the edge)
    boxAt(-3, 1, -9, 3, 0.5, 3, teal);
    boxAt(-11, 1, -12, 3, 0.5, 3, teal);
    // wall-jump channel
    boxAt(-9, 3, 6, 0.6, 6, 5, stone);
    boxAt(-6.4, 3.5, 6, 0.6, 7, 5, stone);

    ground.parent = this.root;
    this.aggregates.push(new PhysicsAggregate(ground, PhysicsShapeType.CYLINDER, { mass: 0, friction: 0.9 }, scene));
  }

  dispose() {
    for (const a of this.aggregates) a.dispose();
    this.root.dispose(false, true);
    for (const m of this.mats) m.dispose();
  }
}

// ------------------------------------------------------------------

export class DesignerMode {
  private ui: HTMLDivElement;
  private leftPanel!: HTMLDivElement;
  private rightPanel!: HTMLDivElement;
  private testBar!: HTMLDivElement;
  private tabBuild!: HTMLElement;
  private tabChars!: HTMLElement;
  private rosterEl!: HTMLDivElement;
  private formEl!: HTMLDivElement;

  private stage: Stage | null = null;
  private rig: CharacterRig | null = null;
  private rigDirty = false;
  private pose: RigPose = "idle";
  private phase = 0;
  private turntable = true;
  private testing = false;
  private poseChips = new Map<RigPose, HTMLElement>();

  private current: CharacterData;

  constructor(private host: DesignerHost) {
    injectCss();
    this.current = cloneCharacter(
      allCharacters().find((c) => c.id === activeCharacterId()) ?? allCharacters()[0],
    );
    this.ui = this.buildUi();
    document.body.appendChild(this.ui);
    this.ui.style.display = "none";
  }

  // ---------- mode lifecycle (App drives these) ----------

  show() {
    this.ui.style.display = "block";
    this.stage = new Stage(this.host.scene, STAGE_Y);
    this.rebuildRig();
    this.frameCamera();
    this.renderRoster();
    this.renderForm();
  }

  hide() {
    this.stopTestUi();
    this.rig?.dispose();
    this.rig = null;
    this.stage?.dispose();
    this.stage = null;
    this.ui.style.display = "none";
  }

  /** Per-frame while in design mode (not during test — the player owns then). */
  tick(dt: number) {
    if (this.testing) return;
    if (this.rigDirty) {
      this.rigDirty = false;
      this.rebuildRig();
    }
    if (!this.rig) return;
    this.phase = (this.phase + dt * (this.pose === "run" ? 1.6 : 0.9)) % 1;
    // sway mostly camera-facing (camera sits at -Z; the face is +Z → yaw π)
    this.rig.setYaw(Math.PI + Math.sin(performance.now() / 1900) * (this.turntable ? 0.7 : 0.25));
    this.rig.update(this.pose, this.phase, dt);
  }

  get character(): CharacterData {
    return this.current;
  }

  /** Called by App when the test drive ends (restore panels + rig view). */
  onTestStopped() {
    this.testing = false;
    this.testBar.style.display = "none";
    this.leftPanel.style.display = "flex";
    this.rightPanel.style.display = "block";
    this.rebuildRig();
    this.frameCamera();
  }

  private frameCamera() {
    const cam = this.host.camera;
    const h = this.rig?.height ?? 1.8;
    cam.setTarget(new Vector3(0, STAGE_Y + h * 0.52, 0));
    cam.alpha = -Math.PI / 2 - 0.28;
    cam.beta = 1.32;
    cam.radius = Math.max(4.5, h * 2.9);
  }

  private rebuildRig() {
    this.rig?.dispose();
    this.rig = new CharacterRig(this.host.scene, this.current, "preview", {
      targetHeight: deriveMovement(this.current).capsuleHeight, // same size as in play
    });
    this.rig.root.position.y = STAGE_Y;
  }

  private startTest() {
    if (this.testing) return;
    this.testing = true;
    this.rig?.dispose();
    this.rig = null;
    this.leftPanel.style.display = "none";
    this.rightPanel.style.display = "none";
    this.testBar.style.display = "flex";
    this.host.startTest(cloneCharacter(this.current), new Vector3(0, STAGE_Y + 2.5, 0), STAGE_Y - 12);
  }

  // ---------- DOM ----------

  private buildUi(): HTMLDivElement {
    const root = div("mb5");
    Object.assign(root.style, { position: "fixed", inset: "0", zIndex: "25", pointerEvents: "none" });

    // top bar with real tabs
    const bar = div("mb5-panel", root);
    Object.assign(bar.style, {
      position: "absolute", top: "8px", left: "10px", right: "10px", height: "42px",
      display: "flex", alignItems: "center", gap: "6px", padding: "0 10px", pointerEvents: "auto",
    });
    txt("div", "MB5", "", bar).style.cssText = "font:800 15px system-ui;color:#89b4fa";
    txt("span", "Studio", "", bar).style.cssText = "font:600 12px system-ui;color:#6c7391;margin-right:8px";
    const tabs = div("mb5-tabbar", bar);
    tabs.style.marginBottom = "0";
    this.tabBuild = txt("div", "Build", "mb5-tab", tabs);
    this.tabBuild.style.padding = "5px 14px";
    this.tabBuild.onclick = () => this.host.switchToBuild();
    this.tabChars = txt("div", "Characters", "mb5-tab active", tabs);
    this.tabChars.style.padding = "5px 14px";
    div("", bar).style.flex = "1";
    btn("Import", () => this.importJson(), "", bar);
    btn("Export", () => this.exportJson(), "", bar);
    const test = btn("🧪 Test Drive", () => this.startTest(), "", bar);
    test.title = "Run this character on the test stage — feel the speed, jumps, and moves";
    const use = btn("▶ Use in Play", () => {
      this.persist();
      setActiveCharacter(this.current.id);
      toast(`Playing as ${this.current.name}`, "ok");
      this.host.useInPlay();
    }, "primary", bar);
    use.title = "Play the loaded level as this character";

    // test-mode bar (hidden unless testing)
    this.testBar = div("mb5-panel", root);
    Object.assign(this.testBar.style, {
      position: "absolute", top: "58px", left: "50%", transform: "translateX(-50%)",
      display: "none", alignItems: "center", gap: "10px", padding: "6px 12px", pointerEvents: "auto",
    });
    txt("span", "Test drive — WASD + Space (+ your moves)", "mb5-lbl", this.testBar);
    btn("■ Back to designer", () => this.host.stopTest(), "danger", this.testBar);

    // left panel: roster + assist
    this.leftPanel = div("mb5-panel mb5-scroll", root);
    Object.assign(this.leftPanel.style, {
      position: "absolute", top: "58px", left: "10px", width: "270px", bottom: "10px",
      padding: "10px", overflowY: "auto", pointerEvents: "auto", display: "flex", flexDirection: "column",
    });

    // right panel: the form
    this.rightPanel = div("mb5-panel mb5-scroll", root);
    Object.assign(this.rightPanel.style, {
      position: "absolute", top: "58px", right: "10px", width: "300px", bottom: "10px",
      padding: "10px 12px", overflowY: "auto", pointerEvents: "auto",
    });

    this.buildLeft();
    this.formEl = div("", this.rightPanel);

    const help = div("mb5-panel", root);
    Object.assign(help.style, {
      position: "absolute", bottom: "10px", left: "50%", transform: "translateX(-50%)",
      padding: "4px 12px", fontSize: "11px", color: "#8b92ab", pointerEvents: "auto",
    });
    help.textContent = "drag to orbit · wheel to zoom — the stage is also the Test Drive arena";
    return root;
  }

  private buildLeft() {
    const box = this.leftPanel;
    heading("Pose preview", box);
    const pRow = row(box);
    for (const p of POSES) {
      const chip = txt("div", p, "mb5-chip", pRow);
      chip.onclick = () => {
        this.pose = p;
        this.turntable = p === "idle";
        for (const [k, el] of this.poseChips) el.classList.toggle("active", k === p);
      };
      this.poseChips.set(p, chip);
    }
    this.poseChips.get("idle")?.classList.add("active");

    box.appendChild(
      buildAssistPanel({
        title: "Assist — describe a character",
        placeholder: "e.g. \"a tall lanky purple rabbit, fast but fragile, can glide\" — or attach an image of a drawing/character",
        withImage: true,
        onPrompt: async (prompt, image) => {
          const { generateCharacter } = await import("../ai/assist");
          const c = await generateCharacter(prompt, this.current, image);
          this.current = c;
          this.persist();
          this.rigDirty = true;
          this.renderRoster();
          this.renderForm();
          toast(`Created "${c.name}" — tune it with the sliders`, "ok");
          return [`Created "${c.name}" (${c.moves.join(", ") || "no moves"}) — saved to the roster.`];
        },
      }),
    );

    heading("Roster", box);
    this.rosterEl = div("", box);
    const rRow = row(box);
    btn("+ New", () => this.newCharacter(), "", rRow);
    btn("Duplicate", () => this.fork(`${this.current.name} copy`), "", rRow);
    btn("Delete", () => this.remove(), "danger", rRow);
    hint("Presets fork automatically when edited. Everything autosaves to this browser.", box);
  }

  // ---------- edit plumbing ----------

  private edit(fn: (c: CharacterData) => void, rebuildForm = false) {
    if (isPreset(this.current.id)) {
      this.current = cloneCharacter(this.current);
      this.current.id = `c${Date.now().toString(36)}`;
      this.current.name = `${this.current.name} ★`;
      fn(this.current);
      this.persist();
      this.rigDirty = true;
      this.renderRoster();
      this.renderForm();
      toast(`Forked preset → "${this.current.name}"`, "ok");
      return;
    }
    fn(this.current);
    this.persist();
    this.rigDirty = true;
    if (rebuildForm) this.renderForm();
  }

  private persist() {
    if (!isPreset(this.current.id)) upsertCharacter(this.current);
  }

  private newCharacter() {
    this.current = normalizeCharacter({ name: "New character" });
    this.persist();
    this.rigDirty = true;
    this.renderRoster();
    this.renderForm();
  }

  private fork(name: string) {
    this.current = cloneCharacter(this.current);
    this.current.id = `c${Date.now().toString(36)}`;
    this.current.name = name;
    this.persist();
    this.rigDirty = true;
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
    this.rigDirty = true;
    this.renderRoster();
    this.renderForm();
  }

  private select(c: CharacterData) {
    this.current = cloneCharacter(c);
    this.rigDirty = true;
    this.renderRoster();
    this.renderForm();
  }

  // ---------- panels ----------

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
      dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:rgb(${c.colors.fur.map((n) => Math.round(n * 255)).join(",")})`;
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

  private renderForm() {
    const box = this.formEl;
    box.textContent = "";
    const c = this.current;

    textField("", c.name, (v) => {
      this.edit((cc) => (cc.name = v || "Unnamed"));
      this.renderRoster();
    }, box).input.style.cssText += "font:700 14px system-ui;padding:6px 8px";

    heading("Body", box);
    selectField(
      "Style",
      [
        { value: "blocky", label: "Blocky (voxel)" },
        { value: "rounded", label: "Rounded (organic)" },
      ],
      c.style ?? "blocky",
      (v) => this.edit((cc) => (cc.style = v as BodyStyle)),
      box,
    );
    const b = c.body;
    slider("Height", 0.75, 1.6, 0.01, b.height, (v) => this.edit((cc) => (cc.body.height = v)), box);
    slider("Width", 0.75, 1.6, 0.01, b.width, (v) => this.edit((cc) => (cc.body.width = v)), box);
    slider("Weight", 0, 1, 0.01, b.weight, (v) => this.edit((cc) => (cc.body.weight = v)), box);
    slider("Head size", 0.8, 1.3, 0.01, b.head, (v) => this.edit((cc) => (cc.body.head = v)), box);
    slider("Ears", 0.4, 1.8, 0.01, b.ears, (v) => this.edit((cc) => (cc.body.ears = v)), box);
    hint("Also drives the physics capsule + mass in play.", box);

    heading("Colors", box);
    colorField("Fur", c.colors.fur, (v) => this.edit((cc) => (cc.colors.fur = v)), box);
    colorField("Muzzle & ears", c.colors.muzzle, (v) => this.edit((cc) => (cc.colors.muzzle = v)), box);
    colorField("Belly", c.colors.belly, (v) => this.edit((cc) => (cc.colors.belly = v)), box);
    colorField("Accessory", c.colors.accent, (v) => this.edit((cc) => (cc.colors.accent = v)), box);
    selectField(
      "Accessory",
      ACCESSORIES.map((a) => ({ value: a.key, label: a.label })),
      c.accessory,
      (v) => this.edit((cc) => (cc.accessory = v as Accessory)),
      box,
    );

    heading("Stats", box);
    const statNote = div("", box);
    const renderDerived = () => {
      const d = deriveMovement(this.current);
      statNote.textContent = "";
      hint(
        `run ${d.runSpeed.toFixed(1)} m/s · jump ${d.jumpVelocity.toFixed(1)} m/s · ` +
          `dash ${d.dashSpeed.toFixed(1)} m/s · strike ${d.strikePower.toFixed(0)} · mass ${Math.round(d.mass)} kg`,
        statNote,
      );
    };
    const statSlider = (label: string, key: keyof CharacterData["stats"]) => {
      slider(label, 1, 10, 1, c.stats[key], (v) => {
        this.edit((cc) => (cc.stats[key] = v));
        renderDerived();
      }, box);
    };
    statSlider("Speed", "speed");
    statSlider("Jump", "jump");
    statSlider("Attack", "attack");
    statSlider("Defense", "defense");
    box.appendChild(statNote);
    renderDerived();

    heading("Move loadout", box);
    hint("One move per trigger slot — every move works on every body. Empty attack/kick slots fall back to the base kit (punch combo / roundhouse / dive kick).", box);
    // group the catalog by slot
    const bySlot = new Map<SlotKey, MoveSpec[]>();
    for (const m of equipableMoves()) {
      const list = bySlot.get(m.slot) ?? [];
      list.push(m);
      bySlot.set(m.slot, list);
    }
    const slotOrder: SlotKey[] = [
      "jumpAir", "fallHold", "dashGround", "dashAir", "wall",
      "powerAir", "powerGround", "attackGround", "attackAir", "kickGround", "kickAir",
    ];
    const descEl = new Map<SlotKey, HTMLElement>();
    for (const slot of slotOrder) {
      const list = bySlot.get(slot) ?? [];
      if (!list.length) continue;
      const currentKey = c.moves.find((k) => list.some((m) => m.key === k)) ?? "";
      const sel = selectField(
        SLOT_LABELS[slot],
        [{ value: "", label: "— none —" }, ...list.map((m) => ({ value: m.key, label: m.label }))],
        currentKey,
        (v) => {
          this.edit((cc) => {
            cc.moves = cc.moves.filter((k) => !list.some((m) => m.key === k));
            if (v) cc.moves.push(v);
          });
          const d = descEl.get(slot);
          if (d) d.textContent = list.find((m) => m.key === v)?.desc ?? "";
        },
        box,
      );
      void sel;
      const d = txt("div", list.find((m) => m.key === currentKey)?.desc ?? "", "mb5-hint", box);
      d.style.marginTop = "-2px";
      descEl.set(slot, d);
    }
    heading("Passives", box);
    for (const m of equipableMoves().filter((m) => m.slot === "passive")) {
      const wrap = div("", box);
      wrap.style.marginBottom = "6px";
      checkbox(m.label, c.moves.includes(m.key), (on) => {
        this.edit((cc) => {
          cc.moves = on ? [...new Set([...cc.moves, m.key])] : cc.moves.filter((k) => k !== m.key);
        });
      }, wrap);
      const d = txt("div", m.desc, "mb5-hint", wrap);
      d.style.marginLeft = "22px";
      d.style.marginTop = "0";
    }
    hint("🧪 Test Drive to feel the whole kit on the stage.", box);
  }

  private stopTestUi() {
    if (this.testing) this.host.stopTest();
  }

  // ---------- import/export ----------

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
        this.rigDirty = true;
        this.renderRoster();
        this.renderForm();
        toast(`Imported ${c.name}`, "ok");
      } catch {
        toast("Could not parse that file", "err");
      }
    };
    input.click();
  }
}
