// Wiring / boot loop.
//
// Following Joshua's convention, main.ts wires everything imperatively and is
// meant to be the best single map of the codebase — read it top to bottom.
// Systems talk through `GameState` (the event bus), not to each other.

import { bootEngine } from "./core/setup";
import { GameState } from "./game/state";
import { installDebug } from "./core/debug";
import { App } from "./app";
import { makeDemoContinent } from "./world/demo";

const canvas = document.getElementById("app") as HTMLCanvasElement;
const state = new GameState();

// Havok's WASM init makes boot async; vite-plugin-top-level-await allows this.
const { engine, scene } = await bootEngine(canvas);

installDebug({ engine, scene, state });

// The App owns the world + map-maker editor and the edit/play switch. It boots
// in edit mode on a demo continent (until authored levels are loaded).
const app = new App(scene, state, makeDemoContinent());

// Optional: ?level=<url> loads an authored/converted continent at boot
// (e.g. ?level=./continents/foo.json). Useful for hand-drawn → JSON imports.
const levelUrl = new URLSearchParams(location.search).get("level");
if (levelUrl) {
  try {
    const res = await fetch(levelUrl);
    if (res.ok) app.loadContinent(await res.json());
    else console.warn(`[boot] level fetch failed: ${res.status} ${levelUrl}`);
  } catch (err) {
    console.warn("[boot] level load error", err);
  }
}

addEventListener("resize", () => engine.resize());
engine.runRenderLoop(() => scene.render());

// Hand off from the loading screen into the editor.
document.getElementById("boot")?.remove();
state.setPhase("editor");
state.emit("world:loaded", { id: app.world.data.meta.id });
state.emit("ready", undefined);
