// Провести ожидающий бой без экрана (обе стороны — ИИ). Нужно для боёв ИИ-фракций и тестов.
import { collectOutcome, createBattle, runAutoBattle, type BattleOutcome } from '../battle';
import type { GameState } from '../state';
import { buildBattleInput } from './battles';
import { resolveBattle, type MoveResult } from './movement';

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
