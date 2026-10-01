// Провести бой без экрана (обе стороны — ИИ). Нужно для боёв ИИ-фракций и тестов.
import { collectOutcome, createBattle, runAutoBattle, type BattleOutcome } from '../battle';
import { queueBattle, type GameState } from '../state';
import { buildBattleInput, type PendingBattle } from './battles';
import { resolveBattle, type MoveResult } from './movement';

/** Провести текущий ожидающий бой силами ИИ. */
export function autoResolvePending(state: GameState): { outcome: BattleOutcome; follow: MoveResult | null } {
  if (!state.pendingBattle) throw new Error('autoResolvePending: нет боя');
  const input = buildBattleInput(state, state.pendingBattle);
  input.sides[0].ai = true;
  input.sides[1].ai = true;
  const battle = createBattle(input);
  runAutoBattle(battle);
  const outcome = collectOutcome(battle);
  const follow = resolveBattle(state, outcome);
  return { outcome, follow };
}

/** Участвует ли игрок в бою (нападает или защищается). */
export function involvesPlayer(state: GameState, b: PendingBattle): boolean {
  return b.attackerFactionId === state.playerFactionId || b.attackerSide === 1;
}

/** Убрать бой из текущего/очереди (если он туда попал). */
export function takeBattle(state: GameState, b: PendingBattle): void {
  if (state.pendingBattle === b) state.pendingBattle = state.battleQueue.shift() ?? null;
  else state.battleQueue = state.battleQueue.filter((x) => x !== b);
}

/**
 * Провести бой ИИ немедленно, не трогая бои игрока в очереди.
 * Если продолжение (например, после засады) привело к бою с игроком — он ставится в очередь игроку.
 */
export function autoResolveBattle(state: GameState, b: PendingBattle, depth = 0): BattleOutcome {
  takeBattle(state, b);
  const savedPending = state.pendingBattle;
  const savedQueue = state.battleQueue;
  state.pendingBattle = b;
  state.battleQueue = [];
  const { outcome } = autoResolvePending(state);
  const followUps = [state.pendingBattle, ...state.battleQueue].filter((x): x is PendingBattle => !!x);
  state.pendingBattle = savedPending;
  state.battleQueue = savedQueue;
  for (const f of followUps) {
    if (involvesPlayer(state, f) || depth > 3) queueBattle(state, f);
    else autoResolveBattle(state, f, depth + 1);
  }
  return outcome;
}
