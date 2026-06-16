// The `window.__*` debug surface.
//
// The Joshua guide's strongest "do this from day one" recommendation: expose a
// scriptable debug API on `window` so a 3D game can be driven and inspected
// headlessly (Playwright / screenshots / CI rubric). We mirror its shape:
// `__scene`, `__state`, `__engine`, plus helpers like `__tp(x,y,z)` and a
// `__telemetry()` snapshot. Grow this as systems land (`__player`, `__camera`,
// `__world`, `__editor`, ...).

import type { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import type { GameState } from "../game/state";
import type { ContinentResult } from "../world/loader";

declare global {
  interface Window {
    __engine?: Engine;
    __scene?: Scene;
    __state?: GameState;
    /** The currently loaded world. */
    __continent?: ContinentResult;
    /** One-shot snapshot of key numbers for assertions / screenshots. */
    __telemetry?: () => Record<string, unknown>;
    /** Teleport the active camera target (more handles added as player lands). */
    __tp?: (x: number, y: number, z: number) => void;
  }
}

export interface DebugContext {
  engine: Engine;
  scene: Scene;
  state: GameState;
}

export function installDebug(ctx: DebugContext): void {
  const { engine, scene, state } = ctx;
  window.__engine = engine;
  window.__scene = scene;
  window.__state = state;

  window.__telemetry = () => ({
    phase: state.phase,
    health: state.health,
    coins: state.coins,
    fps: Math.round(engine.getFps()),
    meshes: scene.meshes.length,
    activeMeshes: scene.getActiveMeshes().length,
    physicsEnabled: !!scene.getPhysicsEngine(),
    continent: window.__continent?.data.meta.id ?? null,
    prefabCount: window.__continent?.prefabMeshes.size ?? 0,
    camera: scene.activeCamera
      ? scene.activeCamera.position.asArray().map((n) => +n.toFixed(2))
      : null,
  });

  window.__tp = (x, y, z) => {
    scene.activeCamera?.position.set(x, y, z);
  };
}
