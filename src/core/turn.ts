// Конец хода: порядок всех фаз (раздел 3 CLAUDE.md).
// Этап 4: очки движения и лечение. Экономика, события, ИИ и квесты добавляются на следующих этапах.
import { BALANCE } from './content';
import type { GameState } from './state';
import { maxHpOf } from './units/stats';

export interface TurnReport {
  turn: number;
  messages: string[];
}

export function endTurn(state: GameState): TurnReport {
  if (state.pendingBattle) throw new Error('endTurn: сначала проведите бой');
  const messages: string[] = [];

  restoreSquads(state);

  state.turn++;
  return { turn: state.turn, messages };
}

/** Очки движения, лечение на своих станциях, возвращение наёмников в строй. */
function restoreSquads(state: GameState): void {
  for (const sq of state.squads) {
    sq.movePoints = BALANCE.map.squadMovePoints;
    const st = sq.stationId ? state.stations[sq.stationId] : null;
    const atHome = !!st && st.ownerFactionId === sq.factionId;
    for (const u of sq.units) {
      if (u.downedTurns && u.downedTurns > 0) u.downedTurns--;
      if (atHome) {
        const max = maxHpOf(u);
        u.hp = Math.min(max, u.hp + Math.round(max * BALANCE.map.healPerTurnOnOwnStation));
      }
    }
  }
  // Гарнизоны лечатся у себя дома всегда.
  for (const st of Object.values(state.stations)) {
    for (const u of st.garrison) {
      const max = maxHpOf(u);
      u.hp = Math.min(max, u.hp + Math.round(max * BALANCE.map.healPerTurnOnOwnStation));
    }
  }
}
