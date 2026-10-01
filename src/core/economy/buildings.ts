// Здания на станции: что построено, эффекты, стройка, ремонт, улучшение.
import { BALANCE, getBuilding } from '../content';
import { addMessage, type GameState } from '../state';
import type { BuildingEffectType, BuildingInstance, Resources, Station } from '../types';
import { canAfford, pay, scaleRes } from './resources';

const E = BALANCE.economy;

/** Здание работает: достроено (или улучшается) и не повреждено. */
export function isWorking(b: BuildingInstance): boolean {
  return !b.damaged && (b.turnsLeft <= 0 || !!b.upgradeTo);
}

export function workingBuildings(st: Station): BuildingInstance[] {
  return st.buildings.filter(isWorking);
}

/** Сумма значений эффекта по работающим зданиям станции (с учётом уровня). */
export function stationEffect(st: Station, type: BuildingEffectType): number {
  let total = 0;
  for (const b of workingBuildings(st)) {
    for (const e of getBuilding(b.typeId).effects) {
      if (e.type === type) total += e.value * b.level;
    }
  }
  return total;
}

export function hasWorking(st: Station, buildingId: string): boolean {
  return workingBuildings(st).some((b) => b.typeId === buildingId);
}

export function hasEffect(st: Station, type: BuildingEffectType): boolean {
  return workingBuildings(st).some((b) => getBuilding(b.typeId).effects.some((e) => e.type === type));
}

/** Идёт ли на станции стройка (одновременно — только одна). */
export function constructionInProgress(st: Station): BuildingInstance | null {
  return st.buildings.find((b) => b.turnsLeft > 0) ?? null;
}

/** Цена постройки нового здания или улучшения до следующего уровня. */
export function buildCost(buildingId: string, targetLevel: number): Resources {
  return scaleRes(getBuilding(buildingId).cost, 1 + E.upgradeCostPerLevel * (targetLevel - 1));
}

export function repairCost(buildingId: string): Resources {
  return scaleRes(getBuilding(buildingId).cost, E.repairCostFraction);
}

export interface BuildCheck {
  ok: boolean;
  reason?: string;
  cost: Resources;
  /** Новое здание (1) или улучшение до уровня N. */
  targetLevel: number;
}

/** Можно ли построить (или улучшить) здание на станции. */
export function canBuild(state: GameState, stationId: string, buildingId: string, factionId: string): BuildCheck {
  const st = state.stations[stationId];
  const def = getBuilding(buildingId);
  const existing = st.buildings.find((b) => b.typeId === buildingId);
  const targetLevel = existing ? (existing.upgradeTo ?? existing.level) + 1 : 1;
  const cost = buildCost(buildingId, targetLevel);
  const fail = (reason: string): BuildCheck => ({ ok: false, reason, cost, targetLevel });

  if (st.ownerFactionId !== factionId) return fail('Станция не ваша');
  if (constructionInProgress(st)) return fail('На станции уже идёт стройка');
  if (existing && existing.damaged) return fail('Сначала почините здание');
  if (existing && existing.level >= def.maxLevel) return fail('Максимальный уровень');
  for (const req of def.requires) {
    if (!hasWorking(st, req)) return fail(`Нужно здание: ${getBuilding(req).name}`);
  }
  for (const tag of def.requiresTags ?? []) {
    if (!st.tags.includes(tag)) return fail(tag === 'surface_exit' ? 'Нужен выход на поверхность' : `Нужна особенность станции: ${tag}`);
  }
  if (!canAfford(state.factions[factionId].resources, cost)) return fail('Не хватает ресурсов');
  return { ok: true, cost, targetLevel };
}

/** Начать стройку или улучшение. Возвращает текст ошибки или null. */
export function startConstruction(state: GameState, stationId: string, buildingId: string, factionId: string): string | null {
  const check = canBuild(state, stationId, buildingId, factionId);
  if (!check.ok) return check.reason ?? 'Нельзя';
  const st = state.stations[stationId];
  pay(state.factions[factionId].resources, check.cost);
  const def = getBuilding(buildingId);
  const existing = st.buildings.find((b) => b.typeId === buildingId);
  if (existing) {
    // Улучшение: здание продолжает работать на старом уровне, пока идёт стройка.
    existing.turnsLeft = def.buildTurns;
    existing.upgradeTo = check.targetLevel;
  } else {
    st.buildings.push({ typeId: buildingId, level: 1, turnsLeft: def.buildTurns, damaged: false });
  }
  return null;
}

export function repairBuilding(state: GameState, stationId: string, buildingId: string, factionId: string): string | null {
  const st = state.stations[stationId];
  const b = st.buildings.find((x) => x.typeId === buildingId);
  if (!b || !b.damaged) return 'Чинить нечего';
  if (st.ownerFactionId !== factionId) return 'Станция не ваша';
  if (!pay(state.factions[factionId].resources, repairCost(buildingId))) return 'Не хватает ресурсов';
  b.damaged = false;
  return null;
}

/** Фаза стройки в конце хода. */
export function advanceConstruction(state: GameState, factionId: string): void {
  for (const st of Object.values(state.stations)) {
    if (st.ownerFactionId !== factionId) continue;
    for (const b of st.buildings) {
      if (b.turnsLeft > 0) {
        b.turnsLeft--;
        if (b.turnsLeft === 0 && b.upgradeTo) {
          b.level = b.upgradeTo;
          delete b.upgradeTo;
        }
        if (b.turnsLeft === 0 && factionId === state.playerFactionId) {
          const def = getBuilding(b.typeId);
          addMessage(state, `${st.name}: построено — ${def.name}${b.level > 1 ? ` (ур. ${b.level})` : ''}`);
        }
      }
    }
  }
}
