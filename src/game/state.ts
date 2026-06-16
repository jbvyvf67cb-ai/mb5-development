// Typed event bus + canonical game state.
//
// The single architectural pattern the Joshua guide says to adopt no matter
// what: systems DON'T call each other, they go through this bus. UI subscribes
// (`on`), gameplay emits (`emit`). Keep it tiny and dependency-free.

export type GamePhase =
  | "boot"
  | "title"
  | "playing"
  | "paused"
  | "editor"; // the map maker runs as its own phase

/**
 * The set of events that can flow across the bus, with their payload types.
 * Add events here as systems are built — the compiler then enforces correct
 * payloads at every `on`/`emit` site.
 */
export interface GameEventMap {
  ready: void;
  phase: GamePhase;
  "player:spawn": { x: number; y: number; z: number };
  "player:health": number;
  "player:died": void;
  coins: number;
  // world/editor lifecycle (placeholders for the map maker)
  "world:loaded": { id: string };
  "editor:dirty": boolean;
}

type Handler<T> = (payload: T) => void;

export class GameState {
  // Canonical numbers (mirrors Joshua's GameState: health/coins/phase machine).
  phase: GamePhase = "boot";
  health = 100;
  maxHealth = 100;
  coins = 0;

  private handlers: Map<keyof GameEventMap, Set<Handler<unknown>>> = new Map();

  /** Subscribe. Returns an unsubscribe function. */
  on<K extends keyof GameEventMap>(
    ev: K,
    fn: Handler<GameEventMap[K]>,
  ): () => void {
    let set = this.handlers.get(ev);
    if (!set) {
      set = new Set();
      this.handlers.set(ev, set);
    }
    set.add(fn as Handler<unknown>);
    return () => {
      this.handlers.get(ev)?.delete(fn as Handler<unknown>);
    };
  }

  /** Emit an event to all current subscribers. */
  emit<K extends keyof GameEventMap>(ev: K, payload: GameEventMap[K]): void {
    const set = this.handlers.get(ev);
    if (!set) return;
    // Snapshot so a handler can safely unsubscribe during dispatch.
    for (const fn of [...set]) (fn as Handler<GameEventMap[K]>)(payload);
  }

  /** Phase transition helper that only emits on an actual change. */
  setPhase(p: GamePhase): void {
    if (p === this.phase) return;
    this.phase = p;
    this.emit("phase", p);
  }

  addCoins(n = 1): void {
    this.coins += n;
    this.emit("coins", this.coins);
  }

  /** Reset per-run counters (called when entering Play mode). */
  resetRun(): void {
    this.coins = 0;
    this.health = this.maxHealth;
    this.emit("coins", this.coins);
    this.emit("player:health", this.health);
  }
}
