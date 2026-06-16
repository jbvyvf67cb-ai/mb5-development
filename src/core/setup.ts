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
  Color3,
  Color4,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  MeshBuilder,
  StandardMaterial,
  HavokPlugin,
  PhysicsAggregate,
  PhysicsShapeType,
} from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";

export interface BootResult {
  engine: Engine;
  scene: Scene;
}

/**
 * Boots the Babylon engine, a scene, Havok physics, and a placeholder world
 * (lit ground + a falling ball) that proves the whole stack — render loop and
 * live physics — is wired correctly. Real content replaces the placeholder.
 *
 * Async because Havok's WASM must be awaited; main.ts uses top-level await.
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
    28,
    Vector3.Zero(),
    scene,
  );
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 6;
  camera.upperRadiusLimit = 140;
  camera.wheelDeltaPercentage = 0.01;

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, -0.3), scene);
  sun.intensity = 1.4;

  // Placeholder ground.
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: 80, height: 80, subdivisions: 4 },
    scene,
  );
  const gmat = new StandardMaterial("gmat", scene);
  gmat.diffuseColor = new Color3(0.16, 0.3, 0.2);
  gmat.specularColor = new Color3(0.05, 0.05, 0.05);
  ground.material = gmat;
  new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, scene);

  // A falling ball proves physics is live (it should settle on the ground).
  const ball = MeshBuilder.CreateSphere("ball", { diameter: 2, segments: 24 }, scene);
  ball.position.set(0, 14, 0);
  const bmat = new StandardMaterial("bmat", scene);
  bmat.diffuseColor = new Color3(0.92, 0.52, 0.2);
  ball.material = bmat;
  new PhysicsAggregate(ball, PhysicsShapeType.SPHERE, { mass: 1, restitution: 0.55 }, scene);

  return { engine, scene };
}
