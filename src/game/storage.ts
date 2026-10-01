// Хранилище сохранений в браузере (localStorage). В Android-сборке (Capacitor) localStorage тоже работает.
import { deserialize, readSummary, serialize } from '../core/save';
import type { GameState } from '../core/state';

const PREFIX = 'tunnels.save.';
export const AUTOSAVE_SLOT = 'auto';
export const MANUAL_SLOTS = ['1', '2', '3'];

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveToSlot(slot: string, state: GameState): boolean {
  try {
    storage()?.setItem(PREFIX + slot, serialize(state));
    return true;
  } catch {
    return false;
  }
}

export function loadFromSlot(slot: string): GameState | null {
  const raw = storage()?.getItem(PREFIX + slot);
  if (!raw) return null;
  return deserialize(raw);
}

export function slotInfo(slot: string): { turn: number; stations: number; savedAt: string } | null {
  const raw = storage()?.getItem(PREFIX + slot);
  return raw ? readSummary(raw) : null;
}

export function hasAnySave(): boolean {
  return [AUTOSAVE_SLOT, ...MANUAL_SLOTS].some((s) => slotInfo(s) !== null);
}
