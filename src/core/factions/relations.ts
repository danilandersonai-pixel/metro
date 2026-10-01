// Отношения между фракциями: число −100..+100 и статус.
import { BALANCE, getFaction } from '../content';
import { relationKey, type GameState } from '../state';
import type { RelationStatus } from '../types';

const R = BALANCE.relations;

export function getRelation(state: GameState, a: string, b: string): number {
  if (a === b) return R.max;
  if (getFaction(a).noDiplomacy || getFaction(b).noDiplomacy) return R.min;
  return state.relations[relationKey(a, b)] ?? 0;
}

export function setRelation(state: GameState, a: string, b: string, value: number): void {
  if (a === b || getFaction(a).noDiplomacy || getFaction(b).noDiplomacy) return;
  state.relations[relationKey(a, b)] = Math.max(R.min, Math.min(R.max, Math.round(value)));
}

export function changeRelation(state: GameState, a: string, b: string, delta: number): void {
  setRelation(state, a, b, getRelation(state, a, b) + delta);
}

export function relationStatus(state: GameState, a: string, b: string): RelationStatus {
  const v = getRelation(state, a, b);
  if (v < R.warBelow) return 'war';
  if (v > R.allianceAbove && state.flags.includes(allianceFlag(a, b))) return 'alliance';
  if (v > R.peaceAbove) return 'peace';
  return 'neutral';
}

/** Союз заключается только договором/квестом — отмечается флагом. */
export function allianceFlag(a: string, b: string): string {
  return `alliance:${relationKey(a, b)}`;
}

export function isAtWar(state: GameState, a: string, b: string): boolean {
  return a !== b && relationStatus(state, a, b) === 'war';
}

/** Свои или союзники — можно спокойно стоять на станции. */
export function isFriendly(state: GameState, a: string, b: string): boolean {
  return a === b || relationStatus(state, a, b) === 'alliance';
}

export function declareWar(state: GameState, a: string, b: string): void {
  const v = Math.min(getRelation(state, a, b), BALANCE.map.warRelationValue);
  setRelation(state, a, b, v);
  state.flags = state.flags.filter((f) => f !== allianceFlag(a, b));
}

export const RELATION_NAMES: Record<RelationStatus, string> = {
  war: 'Война',
  neutral: 'Нейтралитет',
  peace: 'Мир',
  alliance: 'Союз',
};
