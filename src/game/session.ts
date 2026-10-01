// Текущая партия — общая для всех сцен (карта, станция, бой).
import type { MoveResult } from '../core/map/movement';
import { createNewGame, type GameState } from '../core/state';

export const session: {
  state: GameState | null;
  /** Результат, который карта должна показать после возвращения из боя. */
  followUp: MoveResult | null;
} = {
  state: null,
  followUp: null,
};

export function startNewGame(seed = Date.now() % 1_000_000_000): GameState {
  session.state = createNewGame(seed);
  session.followUp = null;
  return session.state;
}

export function requireState(): GameState {
  if (!session.state) throw new Error('Нет активной партии');
  return session.state;
}
