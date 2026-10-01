// Перемещение отрядов по тоннелям, захват станций, засады, итоги боёв на карте.
import type { BattleOutcome, Side } from '../battle';
import { BALANCE, getFaction } from '../content';
import { changeRelation, declareWar, isAtWar, isFriendly } from '../factions/relations';
import { addMessage, newUnit, queueBattle, type GameState } from '../state';
import type { Resources, Squad, Unit } from '../types';
import { addRes } from '../economy/resources';
import {
  applyOutcomeToUnits,
  defendersAt,
  hasDefenders,
  retreatTargetFor,
  type PendingBattle,
} from './battles';
import { tunnelBetween } from './graph';

const M = BALANCE.map;

export type MoveResult =
  | { kind: 'moved'; stationId: string }
  | { kind: 'in_tunnel' }
  | { kind: 'captured'; stationId: string }
  | { kind: 'battle'; battle: PendingBattle }
  | { kind: 'war_warning'; factionId: string }
  | { kind: 'neutral_choice'; stationId: string; negotiateCost: Resources }
  | { kind: 'invalid'; reason: string };

export interface MoveOptions {
  /** Игрок подтвердил объявление войны. */
  declareWar?: boolean;
  /** Выбор для независимой станции с жителями. */
  neutralChoice?: 'force' | 'negotiate';
}

export function getSquad(state: GameState, squadId: string): Squad {
  const sq = state.squads.find((s) => s.id === squadId);
  if (!sq) throw new Error(`Нет отряда ${squadId}`);
  return sq;
}

/** Бойцы, способные воевать (не выбывшие наёмники). */
export function activeUnits(squad: Squad): Unit[] {
  return squad.units.filter((u) => !(u.downedTurns && u.downedTurns > 0) && u.hp > 0);
}

/** Сколько очков движения нужно, чтобы дойти до станции toId. null — туда нельзя. */
export function moveCost(state: GameState, squad: Squad, toId: string): number | null {
  const target = state.stations[toId];
  if (!target || !target.unlocked) return null;
  if (squad.tunnelPos) {
    const t = tunnelBetween(state, squad.tunnelPos.from, squad.tunnelPos.to)!;
    if (toId === squad.tunnelPos.to) return t.length - squad.tunnelPos.progress;
    if (toId === squad.tunnelPos.from) return squad.tunnelPos.progress;
    return null;
  }
  if (!squad.stationId) return null;
  const t = tunnelBetween(state, squad.stationId, toId);
  if (!t || t.blocked) return null;
  return t.length;
}

export function canMove(state: GameState, squad: Squad, toId: string): boolean {
  return squad.movePoints > 0 && activeUnits(squad).length > 0 && moveCost(state, squad, toId) !== null;
}

/** Цена мирного присоединения независимой станции. */
export function negotiateCost(state: GameState, stationId: string): Resources {
  return { ammo: Math.round(state.stations[stationId].population * M.negotiateAmmoPerPopulation) };
}

function hasResources(have: Resources, need: Resources): boolean {
  return Object.entries(need).every(([k, v]) => (have[k as keyof Resources] ?? 0) >= (v ?? 0));
}

/**
 * Проверка перед входом на станцию: нужно ли предупреждение о войне или выбор для нейтралов.
 * Ничего не меняет в состоянии.
 */
function arrivalCheck(state: GameState, squad: Squad, stationId: string, opts: MoveOptions): MoveResult | null {
  const st = state.stations[stationId];
  const d = defendersAt(state, stationId, squad.factionId);
  const factions = new Set<string>();
  for (const f of d.factionIds) if (f) factions.add(f);
  if (st.ownerFactionId && !isFriendly(state, st.ownerFactionId, squad.factionId)) factions.add(st.ownerFactionId);
  if (!opts.declareWar) {
    for (const f of factions) {
      if (!getFaction(f).noDiplomacy && !isAtWar(state, squad.factionId, f)) return { kind: 'war_warning', factionId: f };
    }
  }
  if (st.ownerFactionId === null && st.population > 0 && d.squads.length === 0) {
    if (!opts.neutralChoice) return { kind: 'neutral_choice', stationId, negotiateCost: negotiateCost(state, stationId) };
    if (opts.neutralChoice === 'negotiate' && !hasResources(state.factions[squad.factionId].resources, negotiateCost(state, stationId))) {
      return { kind: 'invalid', reason: 'Не хватает патронов для переговоров' };
    }
  }
  return null;
}

/**
 * Сделать ход отрядом к соседней станции (или продолжить путь по тоннелю).
 * Возвращает, что произошло; при бое — state.pendingBattle заполнен.
 */
export function moveSquad(state: GameState, squadId: string, toId: string, opts: MoveOptions = {}): MoveResult {
  const squad = getSquad(state, squadId);
  if (state.pendingBattle && squad.factionId === state.playerFactionId) return { kind: 'invalid', reason: 'Сначала проведите бой' };
  if (!canMove(state, squad, toId)) return { kind: 'invalid', reason: 'Туда нельзя пройти' };

  const cost = moveCost(state, squad, toId)!;
  const arriving = squad.movePoints >= cost;
  const originId = squad.tunnelPos ? squad.tunnelPos.from : squad.stationId!;
  const retreatId = squad.tunnelPos && toId === squad.tunnelPos.from ? squad.tunnelPos.to : originId;

  if (arriving) {
    const check = arrivalCheck(state, squad, toId, opts);
    if (check) return check;
  }

  // Засада мутантов при входе в опасный тоннель.
  const leavingStation = !squad.tunnelPos;
  const tunnel = tunnelBetween(state, originId, toId === originId ? squad.tunnelPos!.to : toId)!;
  const spent = Math.min(squad.movePoints, cost);
  const nextTunnelPos = arriving
    ? null
    : squad.tunnelPos
      ? {
          ...squad.tunnelPos,
          progress: toId === squad.tunnelPos.to ? squad.tunnelPos.progress + spent : squad.tunnelPos.progress - spent,
        }
      : { from: originId, to: toId, progress: spent };

  if (leavingStation && tunnel.danger > 0 && !getFaction(squad.factionId).noDiplomacy) {
    if (state.rng.chance(tunnel.danger * M.ambush.chancePerDanger)) {
      squad.movePoints -= spent;
      const battle: PendingBattle = {
        kind: 'ambush',
        attackerSquadId: squad.id,
        attackerFactionId: squad.factionId,
        targetStationId: toId,
        retreatStationId: originId,
        attackerSide: 0,
        ambushUnits: generateAmbush(state, tunnel.danger),
        continuation: { arrive: arriving, tunnelPos: nextTunnelPos, opts },
        seed: state.rng.int(1, 1_000_000_000),
      };
      queueBattle(state, battle);
      return { kind: 'battle', battle };
    }
  }

  squad.movePoints -= spent;
  if (!arriving) {
    squad.stationId = null;
    squad.tunnelPos = nextTunnelPos;
    return { kind: 'in_tunnel' };
  }
  return arrive(state, squad, toId, retreatId, opts);
}

function generateAmbush(state: GameState, danger: number): Unit[] {
  const A = M.ambush;
  const pool = (A.poolByDanger as Record<string, string[]>)[String(Math.min(3, danger))];
  const count = A.unitsBase + A.unitsPerDanger * danger;
  const units: Unit[] = [];
  for (let i = 0; i < count; i++) units.push(newUnit(state, state.rng.pick(pool)));
  return units;
}

/** Отряд добрался до станции. */
function arrive(state: GameState, squad: Squad, stationId: string, retreatId: string, opts: MoveOptions): MoveResult {
  const st = state.stations[stationId];
  const d = defendersAt(state, stationId, squad.factionId);

  if (opts.declareWar) {
    const targets = new Set<string>();
    for (const f of d.factionIds) if (f) targets.add(f);
    if (st.ownerFactionId && st.ownerFactionId !== squad.factionId) targets.add(st.ownerFactionId);
    for (const f of targets) {
      if (!isAtWar(state, squad.factionId, f) && !getFaction(f).noDiplomacy) {
        declareWar(state, squad.factionId, f);
        addMessage(state, `${getFaction(squad.factionId).name} объявляет войну: ${getFaction(f).name}`);
      }
    }
  }

  // Независимая станция с жителями.
  if (st.ownerFactionId === null && st.population > 0 && d.squads.length === 0) {
    if (opts.neutralChoice === 'negotiate') {
      addRes(state.factions[squad.factionId].resources, negotiateCost(state, stationId), -1);
      placeSquad(squad, stationId);
      st.ownerFactionId = squad.factionId;
      addMessage(state, `${st.name} добровольно присоединяется к ${getFaction(squad.factionId).name}`);
      return { kind: 'captured', stationId };
    }
    if (opts.neutralChoice === 'force') {
      for (const f of Object.keys(state.factions)) {
        if (f !== squad.factionId) changeRelation(state, squad.factionId, f, -M.neutralForcePenalty);
      }
    }
  }

  if (hasDefenders(d)) {
    const battle: PendingBattle = {
      kind: 'station',
      attackerSquadId: squad.id,
      attackerFactionId: squad.factionId,
      targetStationId: stationId,
      retreatStationId: retreatId,
      attackerSide: d.factionIds.includes(state.playerFactionId) ? 1 : 0,
      seed: state.rng.int(1, 1_000_000_000),
    };
    // Пока идёт бой, отряд стоит у входа на станцию — в точке отхода.
    placeSquad(squad, retreatId);
    queueBattle(state, battle);
    return { kind: 'battle', battle };
  }

  placeSquad(squad, stationId);
  if (st.ownerFactionId !== squad.factionId && !(st.ownerFactionId && isFriendly(state, st.ownerFactionId, squad.factionId))) {
    captureStation(state, stationId, squad.factionId);
    return { kind: 'captured', stationId };
  }
  return { kind: 'moved', stationId };
}

function placeSquad(squad: Squad, stationId: string): void {
  squad.stationId = stationId;
  squad.tunnelPos = null;
}

/** Станция переходит к фракции: штраф отношений, повреждение зданий, зачистка логова. */
export function captureStation(state: GameState, stationId: string, factionId: string): void {
  const st = state.stations[stationId];
  const prev = st.ownerFactionId;
  st.ownerFactionId = factionId;
  st.garrison = [];
  st.tags = st.tags.filter((t) => t !== 'infested');
  for (const b of st.buildings) {
    if (state.rng.chance(M.buildingDamageChance)) b.damaged = true;
  }
  if (prev && prev !== factionId) changeRelation(state, factionId, prev, -M.captureRelationPenalty);
  addMessage(
    state,
    `${getFaction(factionId).name} захватывает станцию ${st.name}${prev ? ` у ${getFaction(prev).name}` : ''}`,
  );
}

/**
 * Применить итог боя к карте. Возвращает результат «продолжения» —
 * например, после победы в засаде отряд доходит до станции и может начаться новый бой.
 */
export function resolveBattle(state: GameState, outcome: BattleOutcome): MoveResult | null {
  const pending = state.pendingBattle;
  if (!pending) throw new Error('resolveBattle: нет ожидающего боя');
  state.pendingBattle = null;
  const playerSide = pending.attackerFactionId === state.playerFactionId ? pending.attackerSide : pending.attackerSide === 1 ? 0 : null;
  if (playerSide !== null) {
    for (const lu of outcome.sides[playerSide].levelUps) addMessage(state, `${lu.name} получает уровень ${lu.level}`);
  }
  const follow = resolveBattleInner(state, pending, outcome);
  // Следующий бой из очереди — только после того, как продолжение хода (возможный новый бой) обработано.
  if (!state.pendingBattle) state.pendingBattle = state.battleQueue.shift() ?? null;
  return follow;
}

function resolveBattleInner(state: GameState, pending: PendingBattle, outcome: BattleOutcome): MoveResult | null {
  if (pending.kind === 'raid') {
    resolveRaid(state, pending, outcome);
    return null;
  }

  const attackerSide = pending.attackerSide;
  const defenderSide = (1 - attackerSide) as Side;
  const squad = state.squads.find((s) => s.id === pending.attackerSquadId);
  const attackerWon = outcome.winner === attackerSide;
  const st = state.stations[pending.targetStationId];

  // Нападающие
  if (squad) squad.units = applyOutcomeToUnits(squad.units, outcome.sides[attackerSide]);

  // Защитники
  const defenderOut = outcome.sides[defenderSide];
  let defendingSquads: Squad[] = [];
  if (pending.kind === 'station') {
    const d = defendersAt(state, pending.targetStationId, pending.attackerFactionId);
    defendingSquads = d.squads;
    for (const ds of d.squads) ds.units = applyOutcomeToUnits(ds.units, defenderOut);
    if (d.garrison.length > 0) st.garrison = applyOutcomeToUnits(st.garrison, defenderOut);
  }

  // Трофеи победителю
  const winnerFaction = attackerWon
    ? pending.attackerFactionId
    : pending.kind === 'ambush'
      ? 'mutants'
      : (st.ownerFactionId ?? null);
  if (winnerFaction && state.factions[winnerFaction]) addRes(state.factions[winnerFaction].resources, outcome.loot);

  const attackerName = squad ? squad.name : 'Отряд';
  let follow: MoveResult | null = null;

  if (pending.kind === 'ambush') {
    if (squad && attackerWon && activeUnits(squad).length > 0) {
      addMessage(state, `${attackerName} отбился от засады в тоннеле`);
      const c = pending.continuation!;
      if (c.arrive) {
        follow = arrive(state, squad, pending.targetStationId, pending.retreatStationId, c.opts);
      } else {
        squad.stationId = null;
        squad.tunnelPos = c.tunnelPos;
        follow = { kind: 'in_tunnel' };
      }
    } else if (squad) {
      placeSquad(squad, pending.retreatStationId);
      addMessage(state, `${attackerName} отступил после засады`);
    }
  } else if (attackerWon && squad) {
    // Оставшиеся защитники отходят на соседнюю свою станцию или гибнут.
    for (const ds of defendingSquads) {
      if (ds.units.length === 0) continue;
      const to = retreatTargetFor(state, ds);
      if (to) {
        placeSquad(ds, to);
        addMessage(state, `${ds.name} отступает на ${state.stations[to].name}`);
      } else {
        ds.units = [];
      }
    }
    placeSquad(squad, pending.targetStationId);
    if (st.ownerFactionId !== squad.factionId) captureStation(state, st.id, squad.factionId);
    follow = { kind: 'captured', stationId: st.id };
  } else if (squad) {
    placeSquad(squad, pending.retreatStationId);
    addMessage(state, `${attackerName} не смог взять ${st.name}`);
  }

  state.squads = state.squads.filter((s) => s.units.length > 0);
  return follow;
}

/** Итог набега мутантов на станцию. */
function resolveRaid(state: GameState, pending: PendingBattle, outcome: BattleOutcome): void {
  const st = state.stations[pending.targetStationId];
  const defenderSide = (1 - pending.attackerSide) as Side;
  const d = defendersAt(state, st.id, 'mutants');
  const out = outcome.sides[defenderSide];
  for (const ds of d.squads) ds.units = applyOutcomeToUnits(ds.units, out);
  st.garrison = applyOutcomeToUnits(st.garrison, out);
  const defended = outcome.winner === defenderSide;
  if (defended) {
    if (st.ownerFactionId && state.factions[st.ownerFactionId]) addRes(state.factions[st.ownerFactionId].resources, outcome.loot);
    if (st.ownerFactionId === state.playerFactionId) addMessage(state, `${st.name}: набег мутантов отбит`);
  } else {
    raidDamage(state, st.id);
  }
  state.squads = state.squads.filter((s) => s.units.length > 0);
}

/** Мутанты прорвались: гибнут жители, ломаются здания. */
export function raidDamage(state: GameState, stationId: string): void {
  const st = state.stations[stationId];
  const lost = Math.round(st.population * BALANCE.events.raidPopulationLoss);
  st.population -= lost;
  for (const b of st.buildings) if (state.rng.chance(M.buildingDamageChance)) b.damaged = true;
  if (st.ownerFactionId === state.playerFactionId) {
    addMessage(state, `${st.name}: мутанты прорвались! Погибло жителей: ${lost}, здания повреждены`);
  }
}
