// Minimal unified input for Play mode.
//
// Tracks keyboard state and derives a per-frame InputState. `poll()` before
// reads, `consume()` after to clear edge-triggered flags. (A touch layer and the
// fuller iOS-safe input set from Joshua come later.)

export interface InputState {
  moveX: number; // -1..1, camera-relative strafe
  moveZ: number; // -1..1, camera-relative forward
  jumpHeld: boolean;
  jumpPressed: boolean; // edge
  dashPressed: boolean; // edge (Shift)
  poundPressed: boolean; // edge (C)
  attackPressed: boolean; // edge (J) — punch combo / air spin
  kickPressed: boolean; // edge (K) — kick / air dive kick
}

export class Input {
  state: InputState = {
    moveX: 0, moveZ: 0, jumpHeld: false, jumpPressed: false, dashPressed: false, poundPressed: false,
    attackPressed: false, kickPressed: false,
  };

  private keys = new Set<string>();
  private jumpEdge = false;
  private dashEdge = false;
  private poundEdge = false;
  private attackEdge = false;
  private kickEdge = false;
  private attached = false;

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === "Space") this.jumpEdge = true;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.dashEdge = true;
    if (e.code === "KeyC") this.poundEdge = true;
    if (e.code === "KeyJ") this.attackEdge = true;
    if (e.code === "KeyK") this.kickEdge = true;
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();

  attach() {
    if (this.attached) return;
    addEventListener("keydown", this.onKeyDown);
    addEventListener("keyup", this.onKeyUp);
    addEventListener("blur", this.onBlur);
    this.attached = true;
  }

  detach() {
    removeEventListener("keydown", this.onKeyDown);
    removeEventListener("keyup", this.onKeyUp);
    removeEventListener("blur", this.onBlur);
    this.keys.clear();
    this.attached = false;
  }

  poll() {
    const k = this.keys;
    let x = 0;
    let z = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) z += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) z -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) x += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) x -= 1;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    this.state.moveX = x;
    this.state.moveZ = z;
    this.state.jumpHeld = k.has("Space");
    this.state.jumpPressed = this.jumpEdge;
    this.state.dashPressed = this.dashEdge;
    this.state.poundPressed = this.poundEdge;
    this.state.attackPressed = this.attackEdge;
    this.state.kickPressed = this.kickEdge;
  }

  consume() {
    this.jumpEdge = false;
    this.dashEdge = false;
    this.poundEdge = false;
    this.attackEdge = false;
    this.kickEdge = false;
    this.state.jumpPressed = false;
    this.state.dashPressed = false;
    this.state.poundPressed = false;
    this.state.attackPressed = false;
    this.state.kickPressed = false;
  }
}
