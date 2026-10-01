// Типы тактического боя.
import type { Rng } from '../rng';
import type { AttackType, Effect, Row, Unit } from '../types';

/** Сторона боя: 0 — нападающие (обычно игрок), 1 — защитники. */
export type Side = 0 | 1;

/** Боец внутри боя: копия Unit с посчитанными характеристиками и боевым состоянием. */
export interface Combatant {
  uid: string;
  typeId: string;
  name: string;
  side: Side;
  row: Row;
  slot: number;
  level: number;
  hp: number;
  maxHp: number;
  armor: number;
  damage: number;
  heal: number;
  accuracy: number;
  evasion: number;
  initiative: number;
  attackType: AttackType;
  abilities: string[];
  passives: string[];
  effects: Effect[];
  cooldowns: Record<string, number>;
  /** Защита: до начала своего следующего хода урон снижен. */
  defending: boolean;
  /** Уже использовал «Ожидание» в этом раунде. */
  waited: boolean;
  /** Начало хода (тик эффектов) уже обработано в этом раунде. */
  turnStarted: boolean;
  mercenary: boolean;
  /** Боец «призван на один бой» (гарнизон, союзник) — не входит в отряд. */
  summoned: boolean;
  kills: number;
  damageDealt: number;
  /** Исходный юнит — чтобы вернуть изменения обратно в отряд. */
  source: Unit;
}

export type BattleAction =
  | { type: 'attack'; targetUid: string }
  | { type: 'heal'; targetUid: string }
  | { type: 'ability'; abilityId: string; targetUid?: string }
  | { type: 'move'; row: Row; slot: number }
  | { type: 'defend' }
  | { type: 'wait' }
  | { type: 'retreat' };

/** Модификаторы стороны от зданий станции и т.п. */
export interface SideModifiers {
  /** Множитель урона, получаемого передней шеренгой (баррикада). */
  frontDamageTakenMult?: number;
  /** Добавка к точности всех бойцов стороны. */
  accuracyBonus?: number;
  /** Урон по случайным врагам в начале боя (пулемётное гнездо). */
  openingStrike?: { hits: number; damage: number };
}

export interface BattleSideInput {
  name: string;
  units: Unit[];
  /** Призванные на один бой (гарнизон/союзники) — добавляются к отряду. */
  summoned?: Unit[];
  canRetreat?: boolean;
  /** Сторона управляется ИИ. */
  ai?: boolean;
  modifiers?: SideModifiers;
}

export interface BattleSide {
  name: string;
  canRetreat: boolean;
  ai: boolean;
  modifiers: SideModifiers;
}

export interface BattleLogEntry {
  round: number;
  text: string;
}

export interface BattleResult {
  /** Победившая сторона; null — ничья (не используется, при лимите раундов побеждает защитник). */
  winner: Side | null;
  retreatedSide: Side | null;
  rounds: number;
}

export interface BattleState {
  sides: [BattleSide, BattleSide];
  combatants: Combatant[];
  slotsPerRow: number;
  round: number;
  /** Порядок ходов текущего раунда (uid). */
  queue: string[];
  turnIndex: number;
  log: BattleLogEntry[];
  result: BattleResult | null;
  rng: Rng;
}
