// Характеристики бойца с учётом уровня.
import { BALANCE, getUnitType } from '../content';
import type { Unit } from '../types';

export interface UnitStats {
  maxHp: number;
  armor: number;
  damage: number;
  heal: number;
  accuracy: number;
  evasion: number;
  initiative: number;
}

export function computeStats(typeId: string, level: number): UnitStats {
  const type = getUnitType(typeId);
  const g = BALANCE.unitGrowth;
  const lv = Math.max(0, level - 1);
  return {
    maxHp: Math.round(type.hp * (1 + g.hpPerLevel * lv)),
    armor: type.armor + g.armorPerLevel * lv,
    damage: type.damage * (1 + g.damagePerLevel * lv),
    heal: (type.heal ?? 0) * (1 + g.damagePerLevel * lv),
    accuracy: type.accuracy + g.accuracyPerLevel * lv,
    evasion: type.evasion,
    initiative: type.initiative + g.initiativePerLevel * lv,
  };
}

export function maxHpOf(unit: Unit): number {
  return computeStats(unit.typeId, unit.level).maxHp;
}

let uidCounter = 0;

/** Новый боец с полным здоровьем. uid можно задать явно (для тестов и сохранений). */
export function createUnit(typeId: string, level = 1, uid?: string): Unit {
  const stats = computeStats(typeId, level);
  return {
    uid: uid ?? `u${Date.now().toString(36)}_${(uidCounter++).toString(36)}`,
    typeId,
    level,
    xp: 0,
    hp: stats.maxHp,
    effects: [],
    position: { row: getUnitType(typeId).attackType === 'melee' ? 0 : 1, slot: 0 },
  };
}
