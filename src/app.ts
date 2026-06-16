// App — owns the world, editor, UI, and the edit/play mode switch.
//
// Edit mode: the map maker (Editor + EditorUI). Play mode: a capsule you walk
// around the level with a follow camera and kill-plane respawn. Tab toggles.

import type { ArcRotateCamera, Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import type { GameState } from "./game/state";
import type { ContinentData } from "./world/schema";
import { buildContinent, spawnPoint, World } from "./world/world";
import { Editor } from "./editor/editor";
import { EditorUI } from "./editor/ui";
import { Input } from "./core/input";
import { PlayerController } from "./player/controller";
import { Hud } from "./ui/hud";
import { PlaySession } from "./game/play";

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

  constructor(
    private scene: Scene,
    private state: GameState,
    initial: ContinentData,
  ) {
    this.camera = scene.activeCamera as ArcRotateCamera;
    this.world = buildContinent(scene, initial);
    this.editor = this.makeEditor();

    const self = this;
    this.ui = new EditorUI({
      get editor() {
        return self.editor;
      },
      getData: () => self.world.serialize(),
      loadData: (d) => self.loadContinent(d),
      togglePlay: () => self.toggleMode(),
      isPlaying: () => self.mode === "play",
    });
    this.hud = new Hud(state);
    this.editor.onSelectionChange = (sel) => this.ui.showSelection(sel);
    this.editor.onHistoryChange = () => this.ui.updateHistory();
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

  loadContinent(data: ContinentData) {
    if (this.mode === "play") this.exitPlay();
    this.editor.disable();
    this.world.dispose();
    this.world = buildContinent(this.scene, data);
    this.editor = this.makeEditor();
    this.editor.onSelectionChange = (sel) => this.ui.showSelection(sel);
    this.editor.onHistoryChange = () => this.ui.updateHistory();
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
