// Квесты: появление по флагам, проверка целей, награды, развилки и концовки.
import questsJson from '../../data/quests.json';
import { BALANCE, getFaction } from '../content';
import { addRes } from '../economy/resources';
import { ownedStations } from '../economy/turn';
import { getRelation } from '../factions/relations';
import { addMessage, newUnit, type GameState, type QuestState } from '../state';
import type { Ending, Quest, QuestObjective } from '../types';

export const QUESTS = (questsJson as { quests: Quest[]; endings: Ending[] }).quests;
export const ENDINGS = (questsJson as { quests: Quest[]; endings: Ending[] }).endings;

export function getQuest(id: string): Quest {
  const q = QUESTS.find((x) => x.id === id);
  if (!q) throw new Error(`Неизвестный квест: ${id}`);
  return q;
}

export function getEnding(id: string): Ending {
  const e = ENDINGS.find((x) => x.id === id);
  if (!e) throw new Error(`Неизвестная концовка: ${id}`);
  return e;
}

/** Квест можно взять: не взят, флаги и отношения выполнены. */
export function isQuestAvailable(state: GameState, q: Quest): boolean {
  if (state.quests[q.id]) return false;
  if (!q.requires.flags.every((f) => state.flags.includes(f))) return false;
  if ((q.requires.notFlags ?? []).some((f) => state.flags.includes(f))) return false;
  for (const [factionId, min] of Object.entries(q.requires.relation)) {
    if (getRelation(state, state.playerFactionId, factionId) < min) return false;
  }
  return true;
}

/** Ключ счётчика статистики для «счётных» целей. */
function statKey(obj: QuestObjective): string | null {
  switch (obj.type) {
    case 'win_battles':
      return obj.params.factionId ? `wins:${obj.params.factionId}` : 'wins';
    case 'build':
      return obj.params.buildingId ? `built:${obj.params.buildingId}` : 'built';
    case 'hire':
      return 'hired';
    default:
      return null;
  }
}

function startStage(state: GameState, qs: QuestState, q: Quest): void {
  const key = statKey(q.stages[qs.stage].objective);
  qs.baseline = key ? state.stats[key] ?? 0 : 0;
  qs.stageStartTurn = state.turn;
  qs.heldSince = undefined;
}

function startQuest(state: GameState, q: Quest): void {
  const qs: QuestState = { status: 'active', stage: 0, stageStartTurn: state.turn, baseline: 0 };
  state.quests[q.id] = qs;
  startStage(state, qs, q);
  state.pendingEvents.push({ kind: 'quest_new', questId: q.id });
}

/** Прогресс цели: текущее и нужное значение (для журнала). */
export function objectiveProgress(state: GameState, questId: string): { current: number; target: number } {
  const q = getQuest(questId);
  const qs = state.quests[questId];
  if (!qs || qs.status !== 'active') return { current: 0, target: 1 };
  const obj = q.stages[qs.stage].objective;
  const p = obj.params;
  const player = state.playerFactionId;
  const key = statKey(obj);
  switch (obj.type) {
    case 'reach_station':
      return { current: state.squads.some((s) => s.factionId === player && s.stationId === p.stationId) ? 1 : 0, target: 1 };
    case 'capture_station':
      return { current: state.stations[p.stationId!]?.ownerFactionId === player ? 1 : 0, target: 1 };
    case 'win_battles':
    case 'build':
    case 'hire':
      return { current: (state.stats[key!] ?? 0) - qs.baseline, target: p.count ?? 1 };
    case 'deliver_resource':
      return { current: state.factions[player].resources[p.resource!] ?? 0, target: p.amount ?? 0 };
    case 'reach_relation':
      return { current: getRelation(state, player, p.factionId!), target: p.value ?? 0 };
    case 'squad_size':
      return { current: Math.max(0, ...state.squads.filter((s) => s.factionId === player).map((s) => s.units.length)), target: p.size ?? 6 };
    case 'hold_turns':
      return { current: qs.heldSince !== undefined ? state.turn - qs.heldSince : 0, target: p.turns ?? 1 };
  }
}

/** Человеческое описание цели. */
export function objectiveText(state: GameState, questId: string): string {
  const q = getQuest(questId);
  const qs = state.quests[questId];
  if (!qs || qs.status !== 'active') return '';
  const obj = q.stages[qs.stage].objective;
  const p = obj.params;
  const { current, target } = objectiveProgress(state, questId);
  const st = p.stationId ? state.stations[p.stationId]?.name : '';
  switch (obj.type) {
    case 'reach_station':
      return `Привести отряд на станцию ${st}`;
    case 'capture_station':
      return `Захватить станцию ${st}`;
    case 'win_battles':
      return `Победить в боях${p.factionId ? ` (${getFaction(p.factionId).name})` : ''}: ${current}/${target}`;
    case 'build':
      return `Построить или улучшить здания: ${current}/${target}`;
    case 'hire':
      return `Нанять бойцов: ${current}/${target}`;
    case 'deliver_resource':
      return `Собрать ресурс: ${current}/${target}`;
    case 'reach_relation':
      return `Отношения с ${getFaction(p.factionId!).name}: ${current}/${target}`;
    case 'squad_size':
      return `Отряд из ${target} бойцов (сейчас ${current})`;
    case 'hold_turns':
      return `Удерживать станцию ${st}: ${current}/${target} ходов`;
  }
}

function isObjectiveDone(state: GameState, questId: string): boolean {
  const q = getQuest(questId);
  const qs = state.quests[questId];
  const obj = q.stages[qs.stage].objective;
  const { current, target } = objectiveProgress(state, questId);
  return obj.type === 'reach_relation' || obj.type === 'deliver_resource' ? current >= target : current >= target && target > 0;
}

/** Обновить цели «удерживать N ходов». */
function updateHold(state: GameState, q: Quest, qs: QuestState): void {
  const obj = q.stages[qs.stage].objective;
  if (obj.type !== 'hold_turns') return;
  const owned = state.stations[obj.params.stationId!]?.ownerFactionId === state.playerFactionId;
  if (!owned) qs.heldSince = undefined;
  else if (qs.heldSince === undefined) qs.heldSince = state.turn;
}

function completeStage(state: GameState, q: Quest, qs: QuestState): void {
  const stage = q.stages[qs.stage];
  const obj = stage.objective;
  if (obj.type === 'deliver_resource') {
    addRes(state.factions[state.playerFactionId].resources, { [obj.params.resource!]: -(obj.params.amount ?? 0) });
  }
  const c = stage.onComplete;
  for (const f of c.setFlags ?? []) if (!state.flags.includes(f)) state.flags.push(f);
  if (c.rewards) addRes(state.factions[state.playerFactionId].resources, c.rewards);
  for (const id of c.unlockStations ?? []) {
    if (state.stations[id]) {
      state.stations[id].unlocked = true;
      addMessage(state, `Открыт путь на станцию ${state.stations[id].name}`);
    }
  }
  if (c.rewardUnits?.length) {
    const home = ownedStations(state, state.playerFactionId)[0];
    for (const ru of c.rewardUnits) {
      const unit = newUnit(state, ru.type, ru.level ?? 1);
      if (home && home.garrison.length < BALANCE.economy.maxGarrison) home.garrison.push(unit);
      else {
        const sq = state.squads.find((s) => s.factionId === state.playerFactionId && s.units.length < BALANCE.map.maxSquadSize);
        if (sq) sq.units.push(unit);
      }
    }
  }

  if (qs.stage + 1 < q.stages.length) {
    qs.stage++;
    startStage(state, qs, q);
    state.pendingEvents.push({ kind: 'quest_stage', questId: q.id });
    return;
  }
  if (q.branches?.length) {
    qs.status = 'branching';
    state.pendingEvents.push({ kind: 'quest_branch', questId: q.id });
    return;
  }
  finishQuest(state, q, qs);
}

function finishQuest(state: GameState, q: Quest, qs: QuestState): void {
  qs.status = 'completed';
  state.pendingEvents.push({ kind: 'quest_done', questId: q.id });
  if (q.ending && !state.endingId) {
    state.endingId = q.ending;
    state.pendingEvents.push({ kind: 'ending', endingId: q.ending });
  }
}

/** Выбор развилки после квеста. */
export function chooseBranch(state: GameState, questId: string, index: number): void {
  const q = getQuest(questId);
  const qs = state.quests[questId];
  if (!qs || qs.status !== 'branching' || !q.branches) return;
  const b = q.branches[index];
  for (const f of b.setFlags) if (!state.flags.includes(f)) state.flags.push(f);
  finishQuest(state, q, qs);
  checkQuests(state);
}

/**
 * Проверка квестов: выдать новые, засчитать выполненные цели.
 * Вызывать после действий игрока и в конце хода.
 */
export function checkQuests(state: GameState): void {
  if (state.endingId) return;
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const q of QUESTS) {
      if (isQuestAvailable(state, q)) {
        startQuest(state, q);
        changed = true;
      }
    }
    for (const q of QUESTS) {
      const qs = state.quests[q.id];
      if (!qs || qs.status !== 'active') continue;
      updateHold(state, q, qs);
      if (isObjectiveDone(state, q.id)) {
        completeStage(state, q, qs);
        changed = true;
      }
    }
    if (!changed) break;
  }
}

export function activeQuests(state: GameState): Quest[] {
  return QUESTS.filter((q) => state.quests[q.id]?.status === 'active' || state.quests[q.id]?.status === 'branching');
}

export function completedQuests(state: GameState): Quest[] {
  return QUESTS.filter((q) => state.quests[q.id]?.status === 'completed');
}

/** Текущий текст квеста (этап). */
export function stageText(state: GameState, questId: string): string {
  const q = getQuest(questId);
  const qs = state.quests[questId];
  return q.stages[Math.min(qs?.stage ?? 0, q.stages.length - 1)].text;
}
