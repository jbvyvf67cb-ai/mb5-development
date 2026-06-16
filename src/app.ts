// App — owns the world, editor, UI, and the edit/play mode switch.
//
// Edit mode: the map maker (Editor + EditorUI). Play mode: a capsule you walk
// around the level with a follow camera and kill-plane respawn. Tab toggles.

import type { ArcRotateCamera, Mesh, Scene, StandardMaterial, Texture } from "@babylonjs/core";
import { Color3, MeshBuilder, StandardMaterial as StdMat, Texture as Tex, Vector3 } from "@babylonjs/core";
import type { GameState } from "./game/state";
import type { ContinentData } from "./world/schema";
import { buildContinent, spawnPoint, World } from "./world/world";
import { flatTerrain, makeDemoContinent, newContinent } from "./world/demo";
import { normalizeContinent } from "./world/normalize";
import { Editor } from "./editor/editor";
import { EditorUI } from "./editor/ui";
import { Input } from "./core/input";
import { PlayerController } from "./player/controller";
import { Hud } from "./ui/hud";
import { PlaySession } from "./game/play";

export const SAVE_KEY = "mb5.level";

export type Mode = "edit" | "play";

export class App {
  world: World;
  editor: Editor;
  mode: Mode = "edit";

  private ui: EditorUI;
  private hud: Hud;
  private input = new Input();
  private player?: PlayerController;
  private session?: PlaySession;
  private camera: ArcRotateCamera;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
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
      regenTerrain: (r) => self.regenTerrain(r),
      newLevel: () => self.newLevel(),
      loadDemo: () => self.loadDemo(),
      setReferenceImage: (f) => self.setReferenceImage(f),
      setReferenceOpacity: (v) => self.setReferenceOpacity(v),
      clearReference: () => self.clearReference(),
    });
    this.hud = new Hud(state);
    this.editor.onSelectionChange = (sel) => this.ui.showSelection(sel);
    this.editor.onHistoryChange = this.historyChanged;
    this.editor.enable();

    scene.onBeforeRenderObservable.add(() => this.update());
    addEventListener("keydown", (e) => this.onKeyDown(e));

    const w = window as unknown as Record<string, unknown>;
    w.__app = this;
    w.__world = this.world;
    w.__editor = this.editor;
    w.__continent = this.world;
    w.__reframe = () => this.reframe();
    w.__setMode = (m: Mode) => (m === this.mode ? undefined : this.toggleMode());

    this.reframe();
  }

  private makeEditor(): Editor {
    const ed = new Editor(this.scene, this.world, this.camera);
    return ed;
  }

  private onKeyDown(e: KeyboardEvent) {
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
    if (this.mode === "play" && this.player) {
      this.input.poll();
      const camYaw = -this.camera.alpha - Math.PI / 2;
      this.player.update(dt, this.input.state, camYaw);

      // Chase camera: lazily swing behind the player's heading.
      const desired = -this.player.facing - Math.PI / 2;
      let d = desired - this.camera.alpha;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.camera.alpha += d * Math.min(1, dt * 3);
      this.camera.target.copyFrom(this.player.position).addInPlaceFromFloats(0, 1, 0);

      this.session?.update(dt);
      this.input.consume();
    }
    this.world.updateCulling(this.camera.position);
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
    if (this.mode === "edit") this.enterPlay();
    else this.exitPlay();
  }

  private enterPlay() {
    this.mode = "play";
    this.editor.disable();
    this.ui.setMode(true);
    this.player = new PlayerController(this.scene, spawnPoint(this.world.data));
    this.input.attach();
    this.session = new PlaySession(this.scene, this.world, this.state, this.player);
    this.hud.show();
    this.camera.target.copyFrom(this.player.position);
    this.camera.radius = 14;
    this.camera.beta = 1.1;
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
    this.player?.dispose();
    this.player = undefined;
    (window as unknown as Record<string, unknown>).__player = undefined;
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
