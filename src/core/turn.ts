// Конец хода: порядок всех фаз (раздел 3 CLAUDE.md).
import { BALANCE } from './content';
import { stationEffect } from './economy/buildings';
import { ownedStations, processEconomy, factionUnits } from './economy/turn';
import { activeUnits } from './map/movement';
import type { GameState } from './state';
import { maxHpOf } from './units/stats';

export interface TurnReport {
  turn: number;
  messages: string[];
}

export function endTurn(state: GameState): TurnReport {
  if (state.pendingBattle) throw new Error('endTurn: сначала проведите бой');
  const firstMessage = state.messages.length;

  // Экономика всех фракций: доход → содержание → стройка
  for (const factionId of Object.keys(state.factions)) processEconomy(state, factionId);

  restoreSquads(state);
  updateDefeated(state);

  state.turn++;
  return { turn: state.turn, messages: state.messages.slice(firstMessage).map((m) => m.text) };
}

/** Очки движения, лечение на своих станциях, возвращение наёмников в строй. */
function restoreSquads(state: GameState): void {
  for (const sq of state.squads) {
    sq.movePoints = BALANCE.map.squadMovePoints;
    const st = sq.stationId ? state.stations[sq.stationId] : null;
    const atHome = !!st && st.ownerFactionId === sq.factionId;
    const heal = atHome ? BALANCE.map.healPerTurnOnOwnStation + stationEffect(st!, 'heal') : 0;
    for (const u of sq.units) {
      if (u.downedTurns && u.downedTurns > 0) u.downedTurns--;
      if (heal > 0) {
        const max = maxHpOf(u);
        u.hp = Math.min(max, u.hp + Math.round(max * heal));
      }
    }
  }
  // Гарнизоны лечатся у себя дома всегда.
  for (const st of Object.values(state.stations)) {
    const heal = BALANCE.map.healPerTurnOnOwnStation + stationEffect(st, 'heal');
    for (const u of st.garrison) {
      const max = maxHpOf(u);
      u.hp = Math.min(max, u.hp + Math.round(max * heal));
    }
  }
}

/** Фракция без станций и отрядов выбывает из игры. */
function updateDefeated(state: GameState): void {
  for (const f of Object.values(state.factions)) {
    if (f.defeated) continue;
    const alive =
      ownedStations(state, f.id).length > 0 ||
      state.squads.some((s) => s.factionId === f.id && activeUnits(s).length > 0) ||
      factionUnits(state, f.id).length > 0;
    if (!alive) f.defeated = true;
  }
}
