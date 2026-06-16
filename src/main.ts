// Wiring / boot loop.
//
// Following Joshua's convention, main.ts wires everything imperatively and is
// meant to be the best single map of the codebase — read it top to bottom.
// Systems talk through `GameState` (the event bus), not to each other.

import { bootEngine } from "./core/setup";
import { GameState } from "./game/state";
import { installDebug } from "./core/debug";

const canvas = document.getElementById("app") as HTMLCanvasElement;
const state = new GameState();

// Havok's WASM init makes boot async; vite-plugin-top-level-await allows this.
const { engine, scene } = await bootEngine(canvas);

installDebug({ engine, scene, state });

addEventListener("resize", () => engine.resize());
engine.runRenderLoop(() => scene.render());

// Hand off from the loading screen.
document.getElementById("boot")?.remove();
state.setPhase("title");
state.emit("ready", undefined);

// Skeleton goes straight into "playing"; a title screen / menu lands later.
state.setPhase("playing");
