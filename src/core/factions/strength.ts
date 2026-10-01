// Оценка боевой силы — для решений ИИ и дипломатии.
import type { GameState } from '../state';
import type { Squad, Unit } from '../types';
import { computeStats } from '../units/stats';
import { defendersAt, stationDefenseModifiers } from '../map/battles';
import { factionUnits } from '../economy/turn';

/** Сила одного бойца: здоровье × урон × точность (условные единицы). */
export function unitPower(u: Unit): number {
  if (u.hp <= 0 || (u.downedTurns ?? 0) > 0) return 0;
  const s = computeStats(u.typeId, u.level);
  return (u.hp * s.damage * s.accuracy) / 100;
}

export function unitsPower(units: Unit[]): number {
  return units.reduce((sum, u) => sum + unitPower(u), 0);
}

export function squadPower(sq: Squad): number {
  return unitsPower(sq.units);
}

/** Сила обороны станции против данного нападающего (с бонусом укреплений). */
export function stationDefensePower(state: GameState, stationId: string, attackerFactionId: string): number {
  const d = defendersAt(state, stationId, attackerFactionId);
  const raw = unitsPower(d.garrison) + d.squads.reduce((s, sq) => s + squadPower(sq), 0);
  const mods = stationDefenseModifiers(state, stationId);
  return raw * (1 + (mods.accuracyBonus ?? 0)) / (mods.frontDamageTakenMult ?? 1);
}

export function factionPower(state: GameState, factionId: string): number {
  return unitsPower(factionUnits(state, factionId));
}

/** Во сколько раз фракция a сильнее b (b = 0 → большое число). */
export function strengthRatio(state: GameState, a: string, b: string): number {
  const pb = factionPower(state, b);
  return pb <= 0 ? 10 : factionPower(state, a) / pb;
}
