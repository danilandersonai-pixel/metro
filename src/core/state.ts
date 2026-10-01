// Состояние партии на глобальной карте. Создание новой игры из сценария.
import { BALANCE, FACTIONS, SCENARIO, STATION_DEFS, TUNNEL_DEFS } from './content';
import { Rng } from './rng';
import type { BuildingInstance, Resources, Squad, Station, Tunnel, Unit } from './types';
import { createUnit } from './units/stats';
import type { PendingBattle } from './map/battles';

export interface FactionState {
  id: string;
  resources: Resources;
  /** Боевой дух 0..100 (этап 5). */
  morale: number;
  /** Фракция уничтожена (нет станций и отрядов). */
  defeated: boolean;
}

export interface GameState {
  version: number;
  turn: number;
  playerFactionId: string;
  stations: Record<string, Station>;
  tunnels: Tunnel[];
  squads: Squad[];
  factions: Record<string, FactionState>;
  /** Отношения пар фракций: ключ «a|b» (a < b по алфавиту). */
  relations: Record<string, number>;
  flags: string[];
  nextId: number;
  /** Журнал событий для игрока (последние сообщения). */
  messages: { turn: number; text: string }[];
  /** Бой, ожидающий проведения (игроку нужно открыть экран боя). */
  pendingBattle: PendingBattle | null;
  /** Следующие бои с участием игрока (например, несколько атак за один ход). */
  battleQueue: PendingBattle[];
  /** События и предложения, ждущие решения игрока. */
  pendingEvents: PendingEvent[];
  /** Счётчики «за ход» (например, рост отношений от торговли). Сбрасываются в конце хода. */
  turnCounters: Record<string, number>;
  /** Постоянная статистика игрока (победы, найм, стройка) — для целей квестов. */
  stats: Record<string, number>;
  /** Состояние взятых квестов. */
  quests: Record<string, QuestState>;
  /** Наступившая концовка (игра пройдена). */
  endingId: string | null;
  rng: Rng;
}

export interface QuestState {
  /** active — выполняется; branching — ждёт выбора развилки; completed — выполнен. */
  status: 'active' | 'branching' | 'completed';
  stage: number;
  stageStartTurn: number;
  /** Значение счётчика статистики на начало этапа (для целей «победить N раз» и т.п.). */
  baseline: number;
  /** С какого хода станция удерживается без перерыва (цель hold_turns). */
  heldSince?: number;
}

export type PendingEvent =
  | { kind: 'event'; eventId: string; stationId: string }
  | { kind: 'peace_offer'; factionId: string }
  | { kind: 'quest_new'; questId: string }
  | { kind: 'quest_stage'; questId: string }
  | { kind: 'quest_done'; questId: string }
  | { kind: 'quest_branch'; questId: string }
  | { kind: 'ending'; endingId: string };

export const SAVE_VERSION = 2;

export function newId(state: GameState, prefix: string): string {
  return `${prefix}${(state.nextId++).toString(36)}`;
}

export function newUnit(state: GameState, typeId: string, level = 1): Unit {
  return createUnit(typeId, level, newId(state, 'u'));
}

export function addMessage(state: GameState, text: string): void {
  state.messages.push({ turn: state.turn, text });
  if (state.messages.length > 200) state.messages.splice(0, state.messages.length - 200);
}

/** Новая партия по сценарию из scenario.json. */
export function createNewGame(seed: number): GameState {
  const state: GameState = {
    version: SAVE_VERSION,
    turn: 1,
    playerFactionId: SCENARIO.playerFactionId,
    stations: {},
    tunnels: TUNNEL_DEFS.map((t) => ({ ...t, blocked: t.blocked ?? false })),
    squads: [],
    factions: {},
    relations: {},
    flags: [],
    nextId: 1,
    messages: [],
    pendingBattle: null,
    battleQueue: [],
    pendingEvents: [],
    turnCounters: {},
    stats: {},
    quests: {},
    endingId: null,
    rng: new Rng(seed),
  };

  for (const def of STATION_DEFS) {
    const garrison = def.garrison.map((g) => newUnit(state, g.type, g.level ?? 1));
    const buildings: BuildingInstance[] = (def.buildings ?? []).map((b) => ({
      typeId: b.type,
      level: b.level ?? 1,
      turnsLeft: 0,
      damaged: false,
    }));
    state.stations[def.id] = {
      id: def.id,
      name: def.name,
      lineIds: [...def.lineIds],
      x: def.x,
      y: def.y,
      ownerFactionId: def.owner,
      unlocked: def.unlocked ?? true,
      buildings,
      garrison,
      population: def.population,
      defenseBonus: def.defenseBonus,
      tags: [...def.tags],
    };
  }

  for (const id of Object.keys(FACTIONS)) {
    state.factions[id] = {
      id,
      resources: { ...(SCENARIO.resources[id] ?? {}) },
      morale: BALANCE.economy.moraleStart,
      defeated: false,
    };
  }

  for (const r of SCENARIO.relations) {
    state.relations[relationKey(r.a, r.b)] = r.value;
  }

  for (const sq of SCENARIO.squads) {
    state.squads.push({
      id: newId(state, 's'),
      name: sq.name,
      factionId: sq.factionId,
      units: sq.units.map((u) => newUnit(state, u.type, u.level ?? 1)),
      stationId: sq.stationId,
      tunnelPos: null,
      movePoints: BALANCE.map.squadMovePoints,
    });
  }
  return state;
}

export function relationKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Поставить бой в очередь: если сейчас боя нет — он становится текущим. */
export function queueBattle(state: GameState, battle: PendingBattle): void {
  if (!state.pendingBattle) state.pendingBattle = battle;
  else state.battleQueue.push(battle);
}

/** Увеличить счётчик статистики игрока. */
export function bumpStat(state: GameState, key: string, n = 1): void {
  state.stats[key] = (state.stats[key] ?? 0) + n;
}
