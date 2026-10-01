// Загрузка игрового контента из JSON. Единственное место, где код читает src/data.
import balanceJson from '../data/balance.json';
import unitsJson from '../data/units.json';
import abilitiesJson from '../data/abilities.json';
import effectsJson from '../data/effects.json';
import type { AbilityDef, EffectDef, EffectId, UnitType } from './types';

export const BALANCE = balanceJson;

function indexById<T extends { id: string }>(items: T[]): Record<string, T> {
  const result: Record<string, T> = {};
  for (const item of items) {
    if (result[item.id]) throw new Error(`Дублирующийся id в данных: ${item.id}`);
    result[item.id] = item;
  }
  return result;
}

export const UNIT_TYPES: Record<string, UnitType> = indexById(unitsJson as UnitType[]);
export const ABILITIES: Record<string, AbilityDef> = indexById(abilitiesJson as AbilityDef[]);
export const EFFECTS = indexById(effectsJson as EffectDef[]) as Record<EffectId, EffectDef>;

export function getUnitType(id: string): UnitType {
  const type = UNIT_TYPES[id];
  if (!type) throw new Error(`Неизвестный тип бойца: ${id}`);
  return type;
}

export function getAbility(id: string): AbilityDef {
  const ability = ABILITIES[id];
  if (!ability) throw new Error(`Неизвестная способность: ${id}`);
  return ability;
}
