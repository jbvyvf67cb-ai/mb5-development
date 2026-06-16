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
}

export class Input {
  state: InputState = { moveX: 0, moveZ: 0, jumpHeld: false, jumpPressed: false };

  private keys = new Set<string>();
  private jumpEdge = false;
  private attached = false;

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === "Space") this.jumpEdge = true;
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
  }

  consume() {
    this.jumpEdge = false;
    this.state.jumpPressed = false;
  }
}
