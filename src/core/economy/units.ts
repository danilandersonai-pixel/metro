// Найм бойцов и перевод между гарнизоном станции и отрядами.
import { BALANCE, getFaction, getUnitType } from '../content';
import { newId, newUnit, type GameState } from '../state';
import type { Resources, Squad } from '../types';
import { hasEffect } from './buildings';
import { canAfford, pay } from './resources';

export interface HireCheck {
  ok: boolean;
  reason?: string;
  cost: Resources;
}

/** Типы бойцов, которых фракция в принципе может нанимать. */
export function hireableTypes(factionId: string): string[] {
  return getFaction(factionId).unitPool;
}

export function canHire(state: GameState, stationId: string, typeId: string, factionId: string): HireCheck {
  const st = state.stations[stationId];
  const type = getUnitType(typeId);
  const cost = type.cost;
  const fail = (reason: string): HireCheck => ({ ok: false, reason, cost });
  if (st.ownerFactionId !== factionId) return fail('Станция не ваша');
  if (!hasEffect(st, 'recruit')) return fail('Нужен Вербовочный пункт');
  if (!hireableTypes(factionId).includes(typeId)) return fail('Фракция не нанимает таких бойцов');
  if (type.requiresArmory && !hasEffect(st, 'armory')) return fail('Нужна Оружейная');
  if (st.garrison.length >= BALANCE.economy.maxGarrison) return fail('Гарнизон переполнен');
  if (!canAfford(state.factions[factionId].resources, cost)) return fail('Не хватает ресурсов');
  return { ok: true, cost };
}

/** Нанять бойца в гарнизон станции. Возвращает текст ошибки или null. */
export function hireUnit(state: GameState, stationId: string, typeId: string, factionId: string): string | null {
  const check = canHire(state, stationId, typeId, factionId);
  if (!check.ok) return check.reason ?? 'Нельзя';
  pay(state.factions[factionId].resources, check.cost);
  state.stations[stationId].garrison.push(newUnit(state, typeId));
  return null;
}

export function squadsAt(state: GameState, stationId: string, factionId: string): Squad[] {
  return state.squads.filter((s) => s.stationId === stationId && s.factionId === factionId);
}

/** Перевести бойца из гарнизона в отряд, стоящий на этой станции. */
export function moveToSquad(state: GameState, stationId: string, unitUid: string, squadId: string): string | null {
  const st = state.stations[stationId];
  const squad = state.squads.find((s) => s.id === squadId);
  if (!squad || squad.stationId !== stationId || squad.factionId !== st.ownerFactionId) return 'Отряд не на этой станции';
  if (squad.units.length >= BALANCE.map.maxSquadSize) return 'В отряде нет места';
  const i = st.garrison.findIndex((u) => u.uid === unitUid);
  if (i < 0) return 'Боец не в гарнизоне';
  const [unit] = st.garrison.splice(i, 1);
  squad.units.push(unit);
  return null;
}

/** Перевести бойца из отряда в гарнизон. Пустой отряд расформировывается. */
export function moveToGarrison(state: GameState, stationId: string, squadId: string, unitUid: string): string | null {
  const st = state.stations[stationId];
  const squad = state.squads.find((s) => s.id === squadId);
  if (!squad || squad.stationId !== stationId || squad.factionId !== st.ownerFactionId) return 'Отряд не на этой станции';
  if (st.garrison.length >= BALANCE.economy.maxGarrison) return 'Гарнизон переполнен';
  const i = squad.units.findIndex((u) => u.uid === unitUid);
  if (i < 0) return 'Бойца нет в отряде';
  const [unit] = squad.units.splice(i, 1);
  st.garrison.push(unit);
  state.squads = state.squads.filter((s) => s.units.length > 0);
  return null;
}

/** Сформировать новый отряд из бойцов гарнизона. */
export function formSquad(state: GameState, stationId: string, unitUids: string[]): Squad | string {
  const st = state.stations[stationId];
  if (!st.ownerFactionId) return 'Станция ничья';
  if (unitUids.length === 0) return 'Выберите бойцов';
  if (unitUids.length > BALANCE.map.maxSquadSize) return 'Слишком много бойцов';
  const units = st.garrison.filter((u) => unitUids.includes(u.uid));
  if (units.length !== unitUids.length) return 'Не все бойцы в гарнизоне';
  st.garrison = st.garrison.filter((u) => !unitUids.includes(u.uid));
  const count = state.squads.filter((s) => s.factionId === st.ownerFactionId).length;
  const squad: Squad = {
    id: newId(state, 's'),
    name: `Отряд ${count + 1}`,
    factionId: st.ownerFactionId,
    units,
    stationId,
    tunnelPos: null,
    movePoints: BALANCE.map.squadMovePoints,
  };
  state.squads.push(squad);
  return squad;
}
