// Wiring / boot loop.
//
// Following Joshua's convention, main.ts wires everything imperatively and is
// meant to be the best single map of the codebase — read it top to bottom.
// Systems talk through `GameState` (the event bus), not to each other.

import { bootEngine } from "./core/setup";
import { GameState } from "./game/state";
import { installDebug } from "./core/debug";
import { buildContinent } from "./world/loader";
import { makeDemoContinent } from "./world/demo";

const canvas = document.getElementById("app") as HTMLCanvasElement;
const state = new GameState();

// Havok's WASM init makes boot async; vite-plugin-top-level-await allows this.
const { engine, scene } = await bootEngine(canvas);

// Load a world. Until the editor + authored levels exist, this is a demo
// continent (heightmap terrain + prefabs) that also serves as the runtime test.
const continent = buildContinent(scene, makeDemoContinent());

installDebug({ engine, scene, state });
window.__continent = continent;

addEventListener("resize", () => engine.resize());
engine.runRenderLoop(() => scene.render());

// Hand off from the loading screen.
document.getElementById("boot")?.remove();
state.setPhase("title");
state.emit("world:loaded", { id: continent.data.meta.id });
state.emit("ready", undefined);

// Skeleton goes straight into "playing"; a title screen / menu lands later.
state.setPhase("playing");
