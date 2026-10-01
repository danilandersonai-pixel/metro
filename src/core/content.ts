// Загрузка игрового контента из JSON. Единственное место, где код читает src/data.
import balanceJson from '../data/balance.json';
import unitsJson from '../data/units.json';
import abilitiesJson from '../data/abilities.json';
import effectsJson from '../data/effects.json';
import stationsJson from '../data/stations.json';
import linesJson from '../data/lines.json';
import tunnelsJson from '../data/tunnels.json';
import factionsJson from '../data/factions.json';
import scenarioJson from '../data/scenario.json';
import type { AbilityDef, EffectDef, EffectId, Faction, Line, Resources, StationTag, UnitType } from './types';

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

// ---------- Карта и фракции ----------

/** Станция в файле данных: география + начальное состояние. */
export interface StationDef {
  id: string;
  name: string;
  lineIds: string[];
  x: number;
  y: number;
  owner: string | null;
  population: number;
  defenseBonus: number;
  tags: StationTag[];
  unlocked?: boolean;
  garrison: { type: string; level?: number }[];
  buildings?: { type: string; level?: number }[];
}

export interface TunnelDef {
  from: string;
  to: string;
  length: number;
  danger: number;
  blocked?: boolean;
}

export interface ScenarioDef {
  playerFactionId: string;
  resources: Record<string, Resources>;
  relations: { a: string; b: string; value: number }[];
  squads: { factionId: string; name: string; stationId: string; units: { type: string; level?: number }[] }[];
}

export const STATION_DEFS = stationsJson as StationDef[];
export const LINES: Record<string, Line> = indexById(linesJson as Line[]);
export const TUNNEL_DEFS = tunnelsJson as TunnelDef[];
export const FACTIONS: Record<string, Faction> = indexById(factionsJson as Faction[]);
export const SCENARIO = scenarioJson as ScenarioDef;

export function getFaction(id: string): Faction {
  const f = FACTIONS[id];
  if (!f) throw new Error(`Неизвестная фракция: ${id}`);
  return f;
}
