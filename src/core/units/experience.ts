// Опыт и уровни бойцов.
import { BALANCE, getUnitType } from '../content';
import type { Unit } from '../types';
import { computeStats } from './stats';

const X = BALANCE.experience;

/** Сколько опыта нужно с уровня level на следующий: 100 × level^1.5. */
export function xpToNext(level: number): number {
  return Math.round(X.xpBase * Math.pow(level, X.xpExponent));
}

/** Сколько опыта стоит убитый враг такого уровня. */
export function xpForKill(enemyLevel: number): number {
  return X.xpPerEnemyLevel * enemyLevel;
}

/**
 * Добавить опыт бойцу и поднять уровни. HP растёт на прибавку к максимуму.
 * Возвращает число полученных уровней.
 */
export function grantXp(unit: Unit, amount: number): number {
  if (amount <= 0) return 0;
  unit.xp += Math.round(amount);
  let gained = 0;
  while (unit.level < X.maxLevel && unit.xp >= xpToNext(unit.level)) {
    const before = computeStats(unit.typeId, unit.level).maxHp;
    unit.xp -= xpToNext(unit.level);
    unit.level++;
    gained++;
    const after = computeStats(unit.typeId, unit.level).maxHp;
    unit.hp = Math.min(after, unit.hp + (after - before));
  }
  if (unit.level >= X.maxLevel) unit.xp = 0;
  return gained;
}

/** Способности бойца с учётом уровня (базовые + открытые на уровнях). */
export function unitAbilities(typeId: string, level: number): string[] {
  const type = getUnitType(typeId);
  const extra = (type.levelUnlocks ?? []).filter((u) => u.abilityId && u.level <= level).map((u) => u.abilityId!);
  return [...new Set([...type.abilities, ...extra])];
}

export function unitPassives(typeId: string, level: number): string[] {
  const type = getUnitType(typeId);
  const extra = (type.levelUnlocks ?? []).filter((u) => u.passiveId && u.level <= level).map((u) => u.passiveId!);
  return [...new Set([...type.passives, ...extra])];
}
