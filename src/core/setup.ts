// Engine + scene + physics boot.
//
// NOTE on imports: the Joshua guide warns that Babylon should use deep,
// side-effecting imports (e.g. "@babylonjs/core/Physics/...") so tree-shaking
// keeps the bundle small. For this first skeleton we import from the barrel for
// correctness/speed of iteration; migrating to deep imports is tracked in
// DESIGN.md §"Gotchas / debt" before we ship anything sizeable.

import {
  Engine,
  Scene,
  Vector3,
  Color4,
  ArcRotateCamera,
  GlowLayer,
  HemisphericLight,
  DirectionalLight,
  HavokPlugin,
} from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";

export interface BootResult {
  engine: Engine;
  scene: Scene;
}

/**
 * Boots the Babylon engine, a scene, Havok physics, a camera, and lights.
 * World content is loaded separately (see the continent loader). Async because
 * Havok's WASM must be awaited; main.ts uses top-level await.
 */
export async function bootEngine(canvas: HTMLCanvasElement): Promise<BootResult> {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true, // needed for screenshot-based QA
    stencil: true,
    antialias: true,
  });
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.05, 0.07, 0.11, 1);

  // Havok needs an async WASM init — this is why main.ts is top-level await.
  const havok = await HavokPhysics();
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));

  const camera = new ArcRotateCamera(
    "cam",
    -Math.PI / 2,
    Math.PI / 3,
    70,
    new Vector3(0, 5, 0),
    scene,
  );
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 6;
  camera.upperRadiusLimit = 500;
  camera.maxZ = 2000;
  camera.wheelDeltaPercentage = 0.01;
  // Right-drag (or ctrl+drag) pans; default sensibility is far too slow for a
  // world-scale editor.
  camera.panningSensibility = 40;

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, -0.3), scene);
  sun.intensity = 1.4;

  // Emissive things (coins, crystals, rings, halos, boost pads) actually glow.
  const glow = new GlowLayer("glow", scene);
  glow.intensity = 0.55;

  return { engine, scene };
}
