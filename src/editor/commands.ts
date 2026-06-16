// Undo/redo — a command history over World mutations.
//
// Commands are pushed already-executed (the editor applies the change, then
// records how to reverse/replay it). Keeps editor code straightforward: do the
// thing, then `history.push(cmd)`.

import type { EntityInstance, PrefabInstance, Vec3, ColliderKind } from "../world/schema";
import type { World } from "../world/world";

export interface Command {
  label: string;
  undo(): void;
  redo(): void;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  onChange?: () => void;

  /** Record a command that has already been applied. */
  push(cmd: Command) {
    this.undoStack.push(cmd);
    this.redoStack = [];
    this.onChange?.();
  }

  undo() {
    const c = this.undoStack.pop();
    if (!c) return;
    c.undo();
    this.redoStack.push(c);
    this.onChange?.();
  }

  redo() {
    const c = this.redoStack.pop();
    if (!c) return;
    c.redo();
    this.undoStack.push(c);
    this.onChange?.();
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange?.();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

export interface Transform {
  pos: Vec3;
  rot: Vec3;
  scale: Vec3;
}

// --- command factories ---

export function addPrefabCmd(world: World, inst: PrefabInstance): Command {
  return {
    label: "add prefab",
    undo: () => world.removePrefab(inst.id),
    redo: () => world.addPrefabInstance(inst),
  };
}

export function removePrefabCmd(world: World, inst: PrefabInstance): Command {
  return {
    label: "delete prefab",
    undo: () => world.addPrefabInstance(inst),
    redo: () => world.removePrefab(inst.id),
  };
}

export function transformPrefabCmd(
  world: World,
  id: string,
  before: Transform,
  after: Transform,
): Command {
  return {
    label: "transform",
    undo: () => world.setPrefabTransform(id, before),
    redo: () => world.setPrefabTransform(id, after),
  };
}

export function tintPrefabCmd(world: World, id: string, before: Vec3, after: Vec3): Command {
  return {
    label: "recolor",
    undo: () => world.setPrefabTint(id, before),
    redo: () => world.setPrefabTint(id, after),
  };
}

export function colliderPrefabCmd(
  world: World,
  id: string,
  before: ColliderKind,
  after: ColliderKind,
): Command {
  return {
    label: "collider",
    undo: () => world.setPrefabCollider(id, before),
    redo: () => world.setPrefabCollider(id, after),
  };
}

export function addEntityCmd(world: World, ent: EntityInstance): Command {
  return {
    label: "add entity",
    undo: () => world.removeEntity(ent.id),
    redo: () => world.addEntityInstance(ent),
  };
}

export function removeEntityCmd(world: World, ent: EntityInstance): Command {
  return {
    label: "delete entity",
    undo: () => world.addEntityInstance(ent),
    redo: () => world.removeEntity(ent.id),
  };
}

export function moveEntityCmd(world: World, id: string, before: Vec3, after: Vec3): Command {
  return {
    label: "move entity",
    undo: () => world.setEntityPos(id, before),
    redo: () => world.setEntityPos(id, after),
  };
}

export function sculptCmd(world: World, before: number[], after: number[]): Command {
  return {
    label: "sculpt",
    undo: () => {
      if (world.data.terrain) world.data.terrain.heights = before.slice();
      world.rebuildTerrain();
    },
    redo: () => {
      if (world.data.terrain) world.data.terrain.heights = after.slice();
      world.rebuildTerrain();
    },
  };
}
