// Бои на глобальной карте: кто защищается, как собрать бой и как применить его итог.
import type { CreateBattleInput, SideModifiers, SideOutcome, Side } from '../battle';
import { BALANCE, getFaction } from '../content';
import { stationEffect } from '../economy/buildings';
import { isFriendly } from '../factions/relations';
import type { GameState } from '../state';
import type { Squad, TunnelPos, Unit } from '../types';
import { neighbors } from './graph';

export interface PendingBattle {
  kind: 'station' | 'ambush';
  attackerSquadId: string;
  attackerFactionId: string;
  targetStationId: string;
  /** Куда отходит нападающий при отступлении/поражении. */
  retreatStationId: string;
  /** Сторона нападающего в бою (игрок всегда на стороне 0 — слева). */
  attackerSide: Side;
  /** Мутанты из засады. */
  ambushUnits?: Unit[];
  /** Для засады: что делать после победы — дойти до станции или остаться в тоннеле. */
  continuation?: { arrive: boolean; tunnelPos: TunnelPos | null; opts: { declareWar?: boolean; neutralChoice?: 'force' | 'negotiate' } };
  seed: number;
}

export interface Defenders {
  squads: Squad[];
  /** Гарнизон станции, если он защищается от этого нападающего. */
  garrison: Unit[];
  /** Фракции защитников (null — независимые жители). */
  factionIds: (string | null)[];
}

/** Кто будет защищать станцию от фракции attackerFactionId. */
export function defendersAt(state: GameState, stationId: string, attackerFactionId: string): Defenders {
  const st = state.stations[stationId];
  const owner = st.ownerFactionId;
  const hostileOwner = owner === null || !isFriendly(state, owner, attackerFactionId);
  const garrison = hostileOwner ? st.garrison.filter((u) => u.hp > 0) : [];
  const squads = state.squads.filter(
    (sq) =>
      sq.stationId === stationId &&
      sq.factionId !== attackerFactionId &&
      !isFriendly(state, sq.factionId, attackerFactionId) &&
      sq.units.length > 0,
  );
  const factionIds = new Set<string | null>();
  if (garrison.length > 0) factionIds.add(owner);
  for (const sq of squads) factionIds.add(sq.factionId);
  return { squads, garrison, factionIds: [...factionIds] };
}

export function hasDefenders(d: Defenders): boolean {
  return d.garrison.length > 0 || d.squads.some((s) => s.units.length > 0);
}

/** Бонусы обороны станции: врождённый бонус + блокпост, баррикада, пулемётное гнездо. */
export function stationDefenseModifiers(state: GameState, stationId: string): SideModifiers {
  const st = state.stations[stationId];
  const mods: SideModifiers = {};
  const accuracy = st.defenseBonus + stationEffect(st, 'defense');
  if (accuracy > 0) mods.accuracyBonus = accuracy;
  const armor = stationEffect(st, 'frontArmor');
  if (armor > 0) mods.frontDamageTakenMult = Math.max(0.2, 1 - armor);
  const strike = stationEffect(st, 'openingStrike');
  if (strike > 0) mods.openingStrike = { hits: BALANCE.battle.openingStrikeHits, damage: strike };
  return mods;
}

/** Штраф точности при низком боевом духе фракции. */
export function moraleModifier(state: GameState, factionId: string | null): number {
  if (!factionId || !state.factions[factionId]) return 0;
  return state.factions[factionId].morale < BALANCE.economy.lowMoraleThreshold ? -BALANCE.economy.lowMoraleAccuracyPenalty : 0;
}

function factionName(id: string | null): string {
  return id ? getFaction(id).name : 'Жители станции';
}

/** Собрать вход для боя. Игрок всегда на стороне 0. */
export function buildBattleInput(state: GameState, pending: PendingBattle): CreateBattleInput {
  const squad = state.squads.find((s) => s.id === pending.attackerSquadId);
  if (!squad) throw new Error('buildBattleInput: нет отряда нападающих');
  const player = state.playerFactionId;

  let defenderUnits: Unit[];
  let defenderSummoned: Unit[] = [];
  let defenderName: string;
  let defenderFaction: string | null;
  let defenderMods: SideModifiers = {};
  let defenderCanRetreat = false;

  if (pending.kind === 'ambush') {
    defenderUnits = pending.ambushUnits ?? [];
    defenderName = 'Мутанты';
    defenderFaction = 'mutants';
  } else {
    const d = defendersAt(state, pending.targetStationId, squad.factionId);
    const [main, ...rest] = d.squads;
    defenderUnits = main ? main.units : d.garrison;
    defenderSummoned = main ? [...rest.flatMap((s) => s.units), ...d.garrison] : [];
    defenderFaction = d.factionIds[0] ?? null;
    defenderName = factionName(defenderFaction);
    defenderMods = stationDefenseModifiers(state, pending.targetStationId);
    defenderMods.accuracyBonus = (defenderMods.accuracyBonus ?? 0) + moraleModifier(state, defenderFaction);
    defenderCanRetreat = !!main && retreatTargetFor(state, main) !== null;
  }

  const attackerSide = {
    name: `${squad.name} (${getFaction(squad.factionId).name})`,
    units: squad.units,
    canRetreat: true,
    ai: squad.factionId !== player,
    modifiers: { accuracyBonus: moraleModifier(state, squad.factionId) },
  };
  const defenderSide = {
    name: defenderName,
    units: defenderUnits,
    summoned: defenderSummoned,
    canRetreat: defenderCanRetreat,
    ai: defenderFaction !== player,
    modifiers: defenderMods,
  };
  const sides = pending.attackerSide === 0 ? [attackerSide, defenderSide] : [defenderSide, attackerSide];
  return {
    sides: sides as CreateBattleInput['sides'],
    seed: pending.seed,
    defenderSide: (1 - pending.attackerSide) as Side,
  };
}

/** Соседняя станция, куда может отступить отряд (своя или союзная). */
export function retreatTargetFor(state: GameState, squad: Squad): string | null {
  if (!squad.stationId) return null;
  for (const n of neighbors(state, squad.stationId)) {
    const owner = state.stations[n.stationId].ownerFactionId;
    if (!n.tunnel.blocked && owner && isFriendly(state, owner, squad.factionId)) return n.stationId;
  }
  return null;
}

/** Применить итог боя к списку бойцов: погибшие удаляются, выжившие обновляются. */
export function applyOutcomeToUnits(units: Unit[], side: SideOutcome): Unit[] {
  const dead = new Set(side.dead);
  const updated = new Map([...side.survivors, ...side.summonedSurvivors].map((u) => [u.uid, u]));
  return units.filter((u) => !dead.has(u.uid)).map((u) => updated.get(u.uid) ?? u);
}
