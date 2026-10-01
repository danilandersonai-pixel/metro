// События конца хода: набеги мутантов, рост логов, случайные события с выбором.
import { BALANCE, getFaction } from './content';
import eventsJson from '../data/events.json';
import { addRes } from './economy/resources';
import { ownedStations } from './economy/turn';
import { autoResolveBattle } from './map/autoresolve';
import { hasDefenders, defendersAt, type PendingBattle } from './map/battles';
import { neighbors } from './map/graph';
import { raidDamage } from './map/movement';
import { addMessage, newUnit, queueBattle, type GameState } from './state';
import type { Resources, StationTag } from './types';

const EV = BALANCE.events;

export interface EventChoice {
  text: string;
  effects: { resources?: Resources; population?: number; morale?: number };
}

export interface GameEventDef {
  id: string;
  trigger: 'random';
  weight: number;
  title: string;
  text: string;
  requiresTag?: StationTag;
  choices: EventChoice[];
}

export const EVENTS = eventsJson as GameEventDef[];

export function getEvent(id: string): GameEventDef {
  const e = EVENTS.find((x) => x.id === id);
  if (!e) throw new Error(`Неизвестное событие: ${id}`);
  return e;
}

/** Шанс набега мутантов на подходящую станцию в этом ходу. */
export function mutantAttackChance(turn: number): number {
  return Math.min(EV.mutantAttackMax, EV.mutantAttackBase + EV.mutantAttackPerTurn * turn);
}

/** Станция под угрозой набега: выход на поверхность или сосед-логово. */
export function isRaidTarget(state: GameState, stationId: string): boolean {
  const st = state.stations[stationId];
  if (!st.ownerFactionId || getFaction(st.ownerFactionId).noDiplomacy) return false;
  if (st.tags.includes('surface_exit')) return true;
  return neighbors(state, stationId).some((n) => state.stations[n.stationId].tags.includes('infested'));
}

/** Фаза событий конца хода. */
export function processEvents(state: GameState): void {
  regrowLairs(state);
  rollMutantRaids(state);
  rollRandomEvent(state);
}

function regrowLairs(state: GameState): void {
  if (state.turn % EV.lairRegrowEvery !== 0) return;
  for (const st of Object.values(state.stations)) {
    if (!st.tags.includes('infested') || st.ownerFactionId !== 'mutants') continue;
    if (st.garrison.length < EV.lairMaxGarrison) st.garrison.push(newUnit(state, state.rng.pick(EV.mutantAttackPool)));
  }
}

function rollMutantRaids(state: GameState): void {
  const chance = mutantAttackChance(state.turn);
  const size = Math.min(EV.mutantAttackMaxUnits, EV.mutantAttackUnitsBase + Math.floor(state.turn / EV.mutantAttackTurnsPerExtraUnit));
  for (const st of Object.values(state.stations)) {
    if (!isRaidTarget(state, st.id)) continue;
    if (!state.rng.chance(chance)) continue;
    const raiders = Array.from({ length: size }, () => newUnit(state, state.rng.pick(EV.mutantAttackPool)));
    const isPlayer = st.ownerFactionId === state.playerFactionId;
    if (!hasDefenders(defendersAt(state, st.id, 'mutants'))) {
      raidDamage(state, st.id);
      continue;
    }
    const battle: PendingBattle = {
      kind: 'raid',
      attackerSquadId: '',
      attackerFactionId: 'mutants',
      targetStationId: st.id,
      retreatStationId: st.id,
      attackerSide: isPlayer ? 1 : 0,
      ambushUnits: raiders,
      seed: state.rng.int(1, 1_000_000_000),
    };
    if (isPlayer) {
      addMessage(state, `Мутанты атакуют станцию ${st.name}!`);
      queueBattle(state, battle);
    } else {
      // Набег на ИИ проводится сразу.
      autoResolveBattle(state, battle);
    }
  }
}

function rollRandomEvent(state: GameState): void {
  if (!state.rng.chance(EV.randomEventChance)) return;
  const stations = ownedStations(state, state.playerFactionId);
  if (stations.length === 0) return;
  const station = state.rng.pick(stations);
  const pool = EVENTS.filter((e) => e.trigger === 'random' && (!e.requiresTag || station.tags.includes(e.requiresTag)));
  if (pool.length === 0) return;
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let roll = state.rng.next() * total;
  let picked = pool[0];
  for (const e of pool) {
    roll -= e.weight;
    if (roll < 0) {
      picked = e;
      break;
    }
  }
  state.pendingEvents.push({ kind: 'event', eventId: picked.id, stationId: station.id });
}

/** Текст события с подставленным названием станции. */
export function eventText(state: GameState, eventId: string, stationId: string): string {
  return getEvent(eventId).text.replace('{station}', state.stations[stationId]?.name ?? '');
}

/** Можно ли выбрать вариант (хватает ресурсов на траты). */
export function canChoose(state: GameState, choice: EventChoice): boolean {
  const res = state.factions[state.playerFactionId].resources;
  return Object.entries(choice.effects.resources ?? {}).every(([k, v]) => (v ?? 0) >= 0 || (res[k as keyof Resources] ?? 0) >= -(v ?? 0));
}

/** Применить выбор игрока в событии. */
export function applyEventChoice(state: GameState, eventId: string, stationId: string, choiceIndex: number): void {
  const choice = getEvent(eventId).choices[choiceIndex];
  const faction = state.factions[state.playerFactionId];
  const st = state.stations[stationId];
  if (choice.effects.resources) addRes(faction.resources, choice.effects.resources);
  if (choice.effects.population && st) st.population = Math.max(0, st.population + choice.effects.population);
  if (choice.effects.morale) faction.morale = Math.max(0, Math.min(100, faction.morale + choice.effects.morale));
  for (const k of Object.keys(faction.resources) as (keyof Resources)[]) {
    if ((faction.resources[k] ?? 0) < 0) faction.resources[k] = 0;
  }
}
