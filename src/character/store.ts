// Character roster persistence (localStorage) + active-character selection.
//
// Built-in presets are read-only templates; anything the user saves lives in
// the roster. The active character id is what Play mode spawns.

import { cloneCharacter, JOSHUA, normalizeCharacter, PRESETS, type CharacterData } from "./schema";

const ROSTER_KEY = "mb5.roster";
const ACTIVE_KEY = "mb5.activeChar";

export function loadRoster(): CharacterData[] {
  try {
    const raw = localStorage.getItem(ROSTER_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(normalizeCharacter) : [];
  } catch {
    return [];
  }
}

export function saveRoster(roster: CharacterData[]) {
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  } catch {
    /* storage unavailable — session-only roster */
  }
}

/** Presets first, then user characters. */
export function allCharacters(): CharacterData[] {
  return [...PRESETS.map(cloneCharacter), ...loadRoster()];
}

export function isPreset(id: string): boolean {
  return PRESETS.some((p) => p.id === id);
}

export function setActiveCharacter(id: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function activeCharacterId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) || JOSHUA.id;
  } catch {
    return JOSHUA.id;
  }
}

/** Resolve the active character (falls back to Joshua). */
export function activeCharacter(): CharacterData {
  const id = activeCharacterId();
  const found = allCharacters().find((c) => c.id === id);
  return found ? cloneCharacter(found) : cloneCharacter(JOSHUA);
}

/** Insert-or-update a character in the roster (presets are never written). */
export function upsertCharacter(c: CharacterData) {
  const roster = loadRoster();
  const i = roster.findIndex((r) => r.id === c.id);
  if (i >= 0) roster[i] = c;
  else roster.push(c);
  saveRoster(roster);
}

export function deleteCharacter(id: string) {
  saveRoster(loadRoster().filter((r) => r.id !== id));
}
