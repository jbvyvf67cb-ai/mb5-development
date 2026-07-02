// HUD — a minimal DOM overlay shown in Play mode (reactive to GameState).

import type { GameState } from "../game/state";
import type { CharacterData } from "../character/schema";

export class Hud {
  root: HTMLDivElement;
  private coinEl: HTMLSpanElement;
  private nameEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private unsub: () => void;

  constructor(state: GameState) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "fixed",
      top: "60px", // below the (collapsed) top bar
      right: "16px",
      color: "#f9e2af",
      font: "700 22px/1 system-ui, sans-serif",
      textShadow: "0 2px 6px rgba(0,0,0,0.6)",
      pointerEvents: "none",
      zIndex: "9",
      display: "none",
      textAlign: "right",
    } satisfies Partial<CSSStyleDeclaration>);

    this.nameEl = document.createElement("div");
    Object.assign(this.nameEl.style, { font: "700 14px/1.2 system-ui", color: "#cdd6f4", marginBottom: "4px" });
    this.root.appendChild(this.nameEl);

    const coins = document.createElement("div");
    coins.append("🪙 ");
    this.coinEl = document.createElement("span");
    this.coinEl.textContent = String(state.coins);
    coins.appendChild(this.coinEl);
    this.root.appendChild(coins);

    this.hintEl = document.createElement("div");
    Object.assign(this.hintEl.style, { marginTop: "6px", font: "500 12px/1.3 system-ui", color: "#cdd6f4", opacity: "0.8" });
    this.hintEl.textContent = "WASD move · Space jump · Tab to edit";
    this.root.appendChild(this.hintEl);

    document.body.appendChild(this.root);
    this.unsub = state.on("coins", (n) => (this.coinEl.textContent = String(n)));
  }

  /** Show who's playing and the controls their move set unlocks. */
  setCharacter(c: CharacterData) {
    this.nameEl.textContent = c.name;
    const parts = ["WASD move", "Space jump"];
    if (c.moves.includes("doubleJump")) parts.push("Space ×2 double jump");
    if (c.moves.includes("glide")) parts.push("hold Space glide");
    if (c.moves.includes("dash")) parts.push("Shift dash");
    if (c.moves.includes("groundPound")) parts.push("C pound");
    if (c.moves.includes("wallJump")) parts.push("wall jump");
    parts.push("Tab to edit");
    this.hintEl.textContent = parts.join(" · ");
  }

  show() {
    this.root.style.display = "block";
  }
  hide() {
    this.root.style.display = "none";
  }
  dispose() {
    this.unsub();
    this.root.remove();
  }
}
