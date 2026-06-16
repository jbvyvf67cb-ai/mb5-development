// HUD — a minimal DOM overlay shown in Play mode (reactive to GameState).

import type { GameState } from "../game/state";

export class Hud {
  root: HTMLDivElement;
  private coinEl: HTMLSpanElement;
  private unsub: () => void;

  constructor(state: GameState) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "fixed",
      top: "12px",
      right: "16px",
      color: "#f9e2af",
      font: "700 22px/1 system-ui, sans-serif",
      textShadow: "0 2px 6px rgba(0,0,0,0.6)",
      pointerEvents: "none",
      zIndex: "9",
      display: "none",
      textAlign: "right",
    } satisfies Partial<CSSStyleDeclaration>);

    const coins = document.createElement("div");
    coins.append("🪙 ");
    this.coinEl = document.createElement("span");
    this.coinEl.textContent = String(state.coins);
    coins.appendChild(this.coinEl);
    this.root.appendChild(coins);

    const hint = document.createElement("div");
    Object.assign(hint.style, { marginTop: "6px", font: "500 12px/1.3 system-ui", color: "#cdd6f4", opacity: "0.8" });
    hint.textContent = "WASD move · Space jump (×2) · Tab to edit";
    this.root.appendChild(hint);

    document.body.appendChild(this.root);
    this.unsub = state.on("coins", (n) => (this.coinEl.textContent = String(n)));
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
