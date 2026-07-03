// App — owns the world, editor, UI, and the edit/play mode switch.
//
// Edit mode: the map maker (Editor + EditorUI). Play mode: a capsule you walk
// around the level with a follow camera and kill-plane respawn. Tab toggles.

import type { ArcRotateCamera, Mesh, Scene, StandardMaterial, Texture } from "@babylonjs/core";
import { Color3, MeshBuilder, Ray, StandardMaterial as StdMat, Texture as Tex, Vector3 } from "@babylonjs/core";
import type { GameState } from "./game/state";
import type { ContinentData } from "./world/schema";
import { DEFAULT_PALETTE } from "./world/schema";
import { buildContinent, spawnPoint, World } from "./world/world";
import { flatTerrain, makeDemoContinent, newContinent } from "./world/demo";
import { normalizeContinent } from "./world/normalize";
import { Editor } from "./editor/editor";
import { EditorUI } from "./editor/ui";
import { toast } from "./editor/widgets";
import { Input } from "./core/input";
import { LockWatcher } from "./core/lock";
import { PlayerController } from "./player/controller";
import { SpriteAvatar } from "./player/avatar";
import { PlayerEffects } from "./player/effects";
import { activeCharacter } from "./character/store";
import { Hud } from "./ui/hud";
import { PlaySession } from "./game/play";

export const SAVE_KEY = "mb5.level";

export type Mode = "edit" | "play" | "design" | "designtest";

export class App {
  world: World;
  editor: Editor;
  mode: Mode = "edit";

  private ui: EditorUI;
  private hud: Hud;
  private input = new Input();
  private player?: PlayerController;
  private avatar?: SpriteAvatar;
  private effects?: PlayerEffects;
  private session?: PlaySession;
  private designer?: import("./character/designer").DesignerMode;
  private savedCam?: { alpha: number; beta: number; radius: number; target: Vector3 };
  private designSpawn = new Vector3(0, 503, 0);
  private designKillY = 488;
  private desiredCamRadius = 11.5;
  private camera: ArcRotateCamera;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private lockWatcher: LockWatcher;
  private remoteLocked = false;
  private historyChanged = () => {
    this.ui.updateHistory();
    this.scheduleSave();
  };

  constructor(
    private scene: Scene,
    private state: GameState,
    initial: ContinentData,
  ) {
    this.camera = scene.activeCamera as ArcRotateCamera;
    this.world = buildContinent(scene, normalizeContinent(initial));
    this.editor = this.makeEditor();

    const self = this;
    this.ui = new EditorUI({
      get editor() {
        return self.editor;
      },
      get data() {
        return self.world.data;
      },
      getData: () => self.world.serialize(),
      loadData: (d) => self.loadContinent(d),
      togglePlay: () => self.toggleMode(),
      isPlaying: () => self.mode === "play",
      setMeta: (p) => self.setMeta(p),
      setPhysics: (p) => {
        const m = self.world.data.meta;
        m.physics = { ...(m.physics ?? {}), ...p };
        self.scheduleSave();
      },
      setSeaLevel: (v) => {
        self.world.setSeaLevel(v);
        self.scheduleSave();
      },
      setEnv: (p) => {
        self.world.setEnv(p);
        self.scheduleSave();
      },
      getEnv: () => self.world.env(),
      setPalette: (s) => {
        self.world.setTerrainPalette(s);
        self.scheduleSave();
      },
      getPalette: () => (self.world.data.terrain?.palette ?? DEFAULT_PALETTE).map((s) => ({ h: s.h, color: [...s.color] as [number, number, number] })),
      resizeTerrain: (size, res) => self.resizeTerrain(size, res),
      regenTerrain: (r) => self.regenTerrain(r),
      newLevel: () => self.newLevel(),
      loadDemo: () => self.loadDemo(),
      setReferenceImage: (f) => self.setReferenceImage(f),
      setReferenceOpacity: (v) => self.setReferenceOpacity(v),
      clearReference: () => self.clearReference(),
      openDesigner: () => self.openDesigner(),
      applyAiOps: (ops) => self.applyAiOps(ops),
    });
    this.hud = new Hud(state);
    this.editor.onSelectionChange = (sel) => this.ui.showSelection(sel);
    this.editor.onHistoryChange = this.historyChanged;
    this.editor.enable();

    scene.onBeforeRenderObservable.add(() => this.update());
    addEventListener("keydown", (e) => this.onKeyDown(e));

    // Remote kill switch: assets/lock.json in the repo, polled ~1/min.
    this.lockWatcher = new LockWatcher((flag) => this.onRemoteLock(flag.locked));
    this.lockWatcher.start();

    const w = window as unknown as Record<string, unknown>;
    w.__app = this;
    w.__world = this.world;
    w.__editor = this.editor;
    w.__continent = this.world;
    w.__reframe = () => this.reframe();
    w.__setMode = (m: Mode) => (m === this.mode ? undefined : this.toggleMode());
    w.__lockWatcher = this.lockWatcher;

    this.reframe();
  }

  private makeEditor(): Editor {
    const ed = new Editor(this.scene, this.world, this.camera);
    return ed;
  }

  /** The remote lock flipped: park the app in (frozen) edit mode + overlay. */
  private onRemoteLock(locked: boolean) {
    this.remoteLocked = locked;
    if (locked) {
      // Leave any live mode; the overlay (drawn by LockWatcher) covers the UI,
      // and a disabled editor ignores its keyboard shortcuts underneath.
      if (this.mode === "designtest") this.stopDesignTest();
      if (this.mode === "design") this.exitDesign();
      if (this.mode === "play") this.exitPlay();
      this.editor.disable();
      (document.activeElement as HTMLElement | null)?.blur?.();
    } else {
      this.editor.enable();
    }
  }

  private onKeyDown(e: KeyboardEvent) {
    if (this.remoteLocked) return;
    if (this.mode === "design" || this.mode === "designtest") {
      if (e.code === "Escape" && this.mode === "designtest") this.stopDesignTest();
      return;
    }
    if (e.code === "Tab") {
      e.preventDefault();
      this.toggleMode();
      return;
    }
    if (this.mode === "play") return;
    const tag = document.activeElement?.tagName ?? "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const ed = this.editor;
    if (e.ctrlKey || e.metaKey) {
      if (e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) ed.redo();
        else ed.undo();
      } else if (e.code === "KeyY") {
        e.preventDefault();
        ed.redo();
      } else if (e.code === "KeyD") {
        e.preventDefault();
        ed.duplicateSelected();
      }
      return;
    }
    switch (e.code) {
      case "Digit1": this.ui.setTool("select"); break;
      case "Digit2": this.ui.setTool("place"); break;
      case "Digit3": this.ui.setTool("sculpt"); break;
      case "Digit4": this.ui.setTool("entity"); break;
      case "KeyQ": ed.setGizmoMode("move"); break;
      case "KeyW": ed.setGizmoMode("rotate"); break;
      case "KeyE": ed.setGizmoMode("scale"); break;
      case "KeyF": ed.focusSelected(); break;
      case "Delete":
      case "Backspace":
        ed.deleteSelected();
        break;
    }
  }

  private update() {
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1);
    if ((this.mode === "play" || this.mode === "designtest") && this.player) {
      this.input.poll();
      const camYaw = -this.camera.alpha - Math.PI / 2;
      this.player.update(dt, this.input.state, camYaw);

      // Chase camera: lazily swing behind the player's heading.
      const desired = -this.player.facing - Math.PI / 2;
      let d = desired - this.camera.alpha;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.camera.alpha += d * Math.min(1, dt * 3.4);
      this.camera.target.copyFrom(this.player.position).addInPlaceFromFloats(0, this.player.mv.capsuleHeight * 0.72, 0);
      this.collideCamera(dt);
      // speed FOV kick (dash/boost rush)
      const fovWant = 0.8 + Math.min(0.18, Math.max(0, this.player.hSpeed - 9) / 55);
      this.camera.fov += (fovWant - this.camera.fov) * Math.min(1, dt * 5);

      this.avatar?.update(dt, this.camera);
      this.effects?.update(dt);
      if (this.mode === "designtest") {
        if (this.player.position.y < this.designKillY) this.player.teleport(this.designSpawn);
      } else {
        this.session?.update(dt);
      }
      this.input.consume();
    } else if (this.mode === "design") {
      this.designer?.tick(dt);
    }
    // Distance-cull only while playing; the editor must always show everything.
    if (this.mode === "play") this.world.updateCulling(this.camera.position);
  }

  /**
   * Physics-aware chase camera: cast from the look target back toward the
   * camera; if a wall/hill is in the way, pull the camera in front of it
   * (snappy), then ease back out to the desired distance when clear.
   */
  private collideCamera(dt: number) {
    const target = this.camera.target;
    const toCam = this.camera.position.subtract(target);
    const len = toCam.length();
    if (len < 0.05) return;
    toCam.scaleInPlace(1 / len);
    const ray = new Ray(target, toCam, this.desiredCamRadius + 0.5);
    const capsule = this.player?.capsule;
    const hit = this.scene.pickWithRay(
      ray,
      (m) => m.isPickable && m !== capsule && !m.name.startsWith("entity:"),
    );
    const want =
      hit?.hit && hit.distance > 0.1
        ? Math.max(2.2, Math.min(this.desiredCamRadius, hit.distance * 0.92))
        : this.desiredCamRadius;
    const k = want < this.camera.radius ? 25 : 3; // snap in, ease out
    this.camera.radius += (want - this.camera.radius) * Math.min(1, dt * k);
  }

  // --- level properties (from the editor UI) ---

  setMeta(patch: { name?: string; gravityY?: number; killPlaneY?: number }) {
    const m = this.world.data.meta;
    if (patch.name !== undefined) m.name = patch.name;
    if (patch.killPlaneY !== undefined) m.killPlaneY = patch.killPlaneY;
    if (patch.gravityY !== undefined) {
      m.gravity = [0, patch.gravityY, 0];
      this.scene.getPhysicsEngine()?.setGravity(new Vector3(0, patch.gravityY, 0));
    }
    this.scheduleSave();
  }

  regenTerrain(resolution: number) {
    const size = this.world.data.terrain?.size[0] ?? 120;
    this.world.setTerrain(flatTerrain(size, resolution));
    this.scheduleSave();
  }

  /** Resample the current heightmap onto a new extent/grid (bilinear). */
  resizeTerrain(size: [number, number], res: [number, number]) {
    const old = this.world.data.terrain;
    const [cols, rows] = res;
    const heights = new Array(cols * rows).fill(0);
    if (old) {
      const [oc, or] = old.resolution;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // sample the old grid at the same normalized position
          const u = (c / Math.max(1, cols - 1)) * (oc - 1);
          const v = (r / Math.max(1, rows - 1)) * (or - 1);
          const c0 = Math.floor(u);
          const r0 = Math.floor(v);
          const c1 = Math.min(oc - 1, c0 + 1);
          const r1 = Math.min(or - 1, r0 + 1);
          const fu = u - c0;
          const fv = v - r0;
          const h00 = old.heights[r0 * oc + c0] ?? 0;
          const h10 = old.heights[r0 * oc + c1] ?? 0;
          const h01 = old.heights[r1 * oc + c0] ?? 0;
          const h11 = old.heights[r1 * oc + c1] ?? 0;
          heights[r * cols + c] =
            h00 * (1 - fu) * (1 - fv) + h10 * fu * (1 - fv) + h01 * (1 - fu) * fv + h11 * fu * fv;
        }
      }
    }
    this.world.setTerrain({
      size,
      resolution: res,
      heights,
      ...(old?.origin ? { origin: old.origin } : {}),
      ...(old?.palette ? { palette: old.palette } : {}),
    });
    this.scheduleSave();
  }

  /** Apply a batch of Claude-generated level ops through normal edit paths. */
  applyAiOps(ops: import("./ai/ops").LevelOp[]): Promise<string[]> {
    return import("./ai/ops").then(({ applyLevelOps }) => {
      const log = applyLevelOps(ops, {
        world: this.world,
        editor: this.editor,
        setMeta: (p) => this.setMeta(p),
        setSeaLevel: (v) => {
          this.world.setSeaLevel(v);
        },
        setEnv: (p) => this.world.setEnv(p),
        setPalette: (s) => this.world.setTerrainPalette(s),
      });
      this.ui.refreshPanels();
      this.scheduleSave();
      return log;
    });
  }

  /** Switch to the Characters tab (a real mode — Build ⇄ Characters). */
  openDesigner() {
    void this.enterDesign();
  }

  private async enterDesign() {
    if (this.mode === "play") this.exitPlay();
    if (this.mode !== "edit") return;
    this.mode = "design";
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.editor.disable();
    this.ui.setHidden(true);
    this.world.root.setEnabled(false); // the stage lives at y≈500, world physics can't reach
    this.savedCam = {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      target: this.camera.target.clone(),
    };
    if (!this.designer) {
      const { DesignerMode } = await import("./character/designer");
      this.designer = new DesignerMode({
        scene: this.scene,
        camera: this.camera,
        switchToBuild: () => this.exitDesign(),
        useInPlay: () => {
          this.exitDesign();
          this.ui.refreshCharacter();
          this.toggleMode();
        },
        startTest: (ch, spawn, killY) => this.startDesignTest(ch, spawn, killY),
        stopTest: () => this.stopDesignTest(),
      });
    }
    this.designer.show();
  }

  private exitDesign() {
    if (this.mode === "designtest") this.stopDesignTest();
    if (this.mode !== "design") return;
    this.designer?.hide();
    this.world.root.setEnabled(true);
    if (this.savedCam) {
      this.camera.alpha = this.savedCam.alpha;
      this.camera.beta = this.savedCam.beta;
      this.camera.radius = this.savedCam.radius;
      this.camera.setTarget(this.savedCam.target);
    }
    this.ui.setHidden(false);
    this.ui.refreshCharacter();
    this.editor.enable();
    this.mode = "edit";
  }

  /** Test drive on the designer stage: the real controller, default physics. */
  private startDesignTest(ch: import("./character/schema").CharacterData, spawn: Vector3, killY: number) {
    if (this.mode !== "design") return;
    this.mode = "designtest";
    this.designSpawn = spawn.clone();
    this.designKillY = killY;
    this.player = new PlayerController(this.scene, spawn, ch);
    this.avatar = new SpriteAvatar(this.scene, this.player, ch);
    this.effects = new PlayerEffects(this.scene, this.player);
    this.player.onShock = (pos) => this.effects?.burstAt(pos, 30);
    this.player.onBurst = (pos, count) => this.effects?.burstAt(pos, count);
    this.player.onStrike = (pos, dx, dz, opts) => {
      this.effects?.burstAt(pos.add(new Vector3(dx * 1.2, 0.2, dz * 1.2)), 6 + Math.round(opts.power / 3));
    };
    this.input.attach();
    this.hud.setCharacter(ch);
    this.hud.show();
    const testScale = Math.min(1.8, Math.max(0.85, this.player.mv.capsuleHeight / 1.9));
    this.desiredCamRadius = 13 * testScale;
    this.camera.radius = this.desiredCamRadius;
    this.camera.beta = 1.24;
    this.camera.target.copyFrom(spawn);
  }

  private stopDesignTest() {
    if (this.mode !== "designtest") return;
    this.input.detach();
    this.hud.hide();
    this.effects?.dispose();
    this.effects = undefined;
    this.avatar?.dispose();
    this.avatar = undefined;
    this.player?.dispose();
    this.player = undefined;
    this.camera.fov = 0.8;
    this.mode = "design";
    this.designer?.onTestStopped();
  }

  newLevel() {
    this.loadContinent(newContinent());
  }

  loadDemo() {
    this.loadContinent(makeDemoContinent());
  }

  // --- reference image underlay (tracing aid; not part of the level) ---

  private refPlane?: Mesh;
  private refMat?: StandardMaterial;
  private refTex?: Texture;
  private refUrl?: string;

  setReferenceImage(file: File) {
    this.clearReference();
    const url = URL.createObjectURL(file);
    this.refUrl = url;
    const b = this.world.data.meta.bounds;
    const w = Math.max(2, b.max[0] - b.min[0]);
    const d = Math.max(2, b.max[2] - b.min[2]);
    const plane = MeshBuilder.CreateGround("refPlane", { width: w, height: d }, this.scene);
    plane.position.set((b.min[0] + b.max[0]) / 2, 0.1, (b.min[2] + b.max[2]) / 2);
    plane.isPickable = false;
    const mat = new StdMat("refMat", this.scene);
    const tex = new Tex(url, this.scene);
    mat.diffuseTexture = tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.6;
    plane.material = mat;
    this.refPlane = plane;
    this.refMat = mat;
    this.refTex = tex;
  }

  setReferenceOpacity(v: number) {
    if (this.refMat) this.refMat.alpha = v;
  }

  clearReference() {
    this.refPlane?.dispose();
    this.refMat?.dispose();
    this.refTex?.dispose();
    if (this.refUrl) URL.revokeObjectURL(this.refUrl);
    this.refPlane = undefined;
    this.refMat = undefined;
    this.refTex = undefined;
    this.refUrl = undefined;
  }

  /** Debounced autosave of the current level to localStorage. */
  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(this.world.data));
      } catch {
        /* storage may be unavailable (private mode / quota) — ignore */
      }
    }, 600);
  }

  toggleMode() {
    if (this.remoteLocked) return;
    if (this.mode === "edit") this.enterPlay();
    else this.exitPlay();
  }

  private enterPlay() {
    this.mode = "play";
    // Nothing may keep keyboard focus into play mode (Space/Enter would
    // re-trigger the focused control).
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.editor.disable();
    this.ui.setMode(true);
    const character = activeCharacter();
    toast(`Playing as ${character.name} — WASD + Space · Tab to edit`, "ok");
    this.player = new PlayerController(
      this.scene,
      spawnPoint(this.world.data),
      character,
      this.world.data.meta.physics ?? {},
    );
    this.avatar = new SpriteAvatar(this.scene, this.player, character);
    this.input.attach();
    this.session = new PlaySession(this.scene, this.world, this.state, this.player);
    this.effects = new PlayerEffects(this.scene, this.player);
    this.player.onShock = (pos) => this.session?.shockwave(pos);
    this.player.onBurst = (pos, count) => this.effects?.burstAt(pos, count);
    this.player.onStrike = (pos, dx, dz, opts) => {
      const hitPos = pos.add(new Vector3(dx * 1.2, 0.2, dz * 1.2));
      const hits = this.session?.applyStrike(pos, dx, dz, opts) ?? 0;
      this.effects?.burstAt(hitPos, 6 + hits * 8);
    };
    this.player.onQueryTarget = (pos, maxDist) => this.session?.nearestTarget(pos, maxDist) ?? null;
    this.hud.setCharacter(character);
    this.hud.show();
    this.camera.target.copyFrom(this.player.position);
    // Sonic-style framing: further back and lower; distance scales with the
    // character (giants get framed wide, runts close).
    const camScale = Math.min(1.8, Math.max(0.85, this.player.mv.capsuleHeight / 1.9));
    this.desiredCamRadius = 14.5 * camScale;
    this.camera.radius = this.desiredCamRadius;
    this.camera.beta = 1.26;
    const player = this.player;
    const w = window as unknown as Record<string, unknown>;
    w.__player = player;
    w.__tpPlayer = (x: number, y: number, z: number) => player.teleport(new Vector3(x, y, z));
    this.state.setPhase("playing");
    this.state.emit("player:spawn", {
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
    });
  }

  private exitPlay() {
    this.mode = "edit";
    this.input.detach();
    this.session?.dispose();
    this.session = undefined;
    this.hud.hide();
    this.effects?.dispose();
    this.effects = undefined;
    this.avatar?.dispose();
    this.avatar = undefined;
    this.player?.dispose();
    this.player = undefined;
    this.camera.fov = 0.8;
    (window as unknown as Record<string, unknown>).__player = undefined;
    this.world.updateCulling(this.camera.position, Infinity); // un-cull everything for editing
    this.editor.enable();
    this.ui.setMode(false);
    this.state.setPhase("editor");
  }

  loadContinent(raw: ContinentData) {
    const data = normalizeContinent(raw);
    if (this.mode === "play") this.exitPlay();
    this.editor.disable();
    this.world.dispose();
    this.world = buildContinent(this.scene, data);
    this.editor = this.makeEditor();
    this.editor.onSelectionChange = (sel) => this.ui.showSelection(sel);
    this.editor.onHistoryChange = this.historyChanged;
    this.editor.enable();
    this.ui.showSelection(null);
    this.ui.updateHistory();
    this.ui.refreshPanels();
    this.ui.setMode(false);
    const w = window as unknown as Record<string, unknown>;
    w.__world = this.world;
    w.__editor = this.editor;
    w.__continent = this.world;
    this.state.emit("world:loaded", { id: data.meta.id });
    this.reframe();
    this.scheduleSave();
  }

  /** Frame the camera on the level bounds. */
  reframe() {
    const { min, max } = this.world.data.meta.bounds;
    const center = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const span = Math.max(max[0] - min[0], max[2] - min[2], 10);
    this.camera.setTarget(center);
    this.camera.radius = span * 0.9;
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = 1.0;
  }
}
