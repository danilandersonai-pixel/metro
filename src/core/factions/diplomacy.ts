// Дипломатия игрока с фракциями: подарки, мир, торговля, союз, дань, война.
import { BALANCE, getFaction } from '../content';
import { addRes } from '../economy/resources';
import { addMessage, relationKey, type GameState } from '../state';
import {
  allianceFlag,
  changeRelation,
  declareWar,
  getRelation,
  relationStatus,
  setRelation,
} from './relations';
import { strengthRatio } from './strength';

const D = BALANCE.diplomacy;

export interface DiplomacyResult {
  ok: boolean;
  text: string;
}

export function tradeFlag(a: string, b: string): string {
  return `trade:${relationKey(a, b)}`;
}

export function hasTradeTreaty(state: GameState, a: string, b: string): boolean {
  return state.flags.includes(tradeFlag(a, b));
}

export function hasAlliance(state: GameState, a: string, b: string): boolean {
  return state.flags.includes(allianceFlag(a, b));
}

/**
 * Насколько фракция `ai` расположена к предложению от `from`:
 * отношения + характер + страх перед силой предлагающего.
 */
export function willingness(state: GameState, ai: string, from: string): number {
  const personality = (D.personalityMod as Record<string, number>)[getFaction(ai).aiPersonality] ?? 0;
  const ratio = strengthRatio(state, from, ai);
  return getRelation(state, ai, from) + personality + (ratio - 1) * D.strengthModPerRatio;
}

function canTalk(state: GameState, from: string, to: string): DiplomacyResult | null {
  if (from === to) return { ok: false, text: 'Это вы сами' };
  if (getFaction(to).noDiplomacy) return { ok: false, text: 'С ними не договориться' };
  if (state.factions[to]?.defeated) return { ok: false, text: 'Фракция разгромлена' };
  return null;
}

/** Подарок патронами: +1 к отношениям за каждые 5 патронов (не больше 15 за раз). */
export function giftAmmo(state: GameState, from: string, to: string, amount: number): DiplomacyResult {
  const bad = canTalk(state, from, to);
  if (bad) return bad;
  const res = state.factions[from].resources;
  if ((res.ammo ?? 0) < amount || amount <= 0) return { ok: false, text: 'Не хватает патронов' };
  addRes(res, { ammo: -amount });
  addRes(state.factions[to].resources, { ammo: amount });
  const points = Math.min(D.giftMaxPoints, Math.floor(amount / D.giftAmmoPerPoint));
  changeRelation(state, from, to, points);
  return { ok: true, text: `${getFaction(to).name} принимает подарок. Отношения +${points}.` };
}

export function proposePeace(state: GameState, from: string, to: string): DiplomacyResult {
  const bad = canTalk(state, from, to);
  if (bad) return bad;
  if (relationStatus(state, from, to) !== 'war') return { ok: false, text: 'Вы и так не воюете' };
  if (willingness(state, to, from) < D.peaceAcceptThreshold) {
    return { ok: false, text: `${getFaction(to).name} отвергает мир.` };
  }
  makePeace(state, from, to);
  return { ok: true, text: `${getFaction(to).name} соглашается на мир.` };
}

export function makePeace(state: GameState, a: string, b: string): void {
  setRelation(state, a, b, Math.max(getRelation(state, a, b), D.peaceRelationValue));
  addMessage(state, `Заключён мир: ${getFaction(a).name} и ${getFaction(b).name}`);
}

export function proposeTrade(state: GameState, from: string, to: string): DiplomacyResult {
  const bad = canTalk(state, from, to);
  if (bad) return bad;
  if (!getFaction(to).canTrade) return { ok: false, text: 'Эта фракция не торгует' };
  if (relationStatus(state, from, to) === 'war') return { ok: false, text: 'Сначала заключите мир' };
  if (hasTradeTreaty(state, from, to)) return { ok: false, text: 'Договор уже действует' };
  if (willingness(state, to, from) < D.tradeAcceptThreshold) return { ok: false, text: `${getFaction(to).name} не доверяет вам.` };
  state.flags.push(tradeFlag(from, to));
  return { ok: true, text: `Торговый договор с ${getFaction(to).name} подписан.` };
}

export function proposeAlliance(state: GameState, from: string, to: string): DiplomacyResult {
  const bad = canTalk(state, from, to);
  if (bad) return bad;
  if (hasAlliance(state, from, to)) return { ok: false, text: 'Вы уже союзники' };
  if (getRelation(state, from, to) <= D.allianceMinRelation) return { ok: false, text: 'Нужны очень хорошие отношения' };
  if (willingness(state, to, from) < D.allianceAcceptThreshold) return { ok: false, text: `${getFaction(to).name} не готова к союзу.` };
  state.flags.push(allianceFlag(from, to));
  addMessage(state, `Союз: ${getFaction(from).name} и ${getFaction(to).name}`);
  return { ok: true, text: `${getFaction(to).name} теперь ваш союзник.` };
}

export function demandTribute(state: GameState, from: string, to: string): DiplomacyResult {
  const bad = canTalk(state, from, to);
  if (bad) return bad;
  const ratio = strengthRatio(state, from, to);
  const theirs = state.factions[to].resources;
  if (ratio >= D.tributeStrengthRatio && (theirs.ammo ?? 0) >= D.tributeAmmo) {
    addRes(theirs, { ammo: -D.tributeAmmo });
    addRes(state.factions[from].resources, { ammo: D.tributeAmmo });
    changeRelation(state, from, to, -D.tributeRelationPenalty);
    return { ok: true, text: `${getFaction(to).name} нехотя платит ${D.tributeAmmo} патронов.` };
  }
  changeRelation(state, from, to, -D.tributeRefusePenalty);
  return { ok: false, text: `${getFaction(to).name} смеётся над вашим требованием.` };
}

/** Объявить войну. Разрыв договоров злит всех остальных. */
export function declareWarOn(state: GameState, from: string, to: string): DiplomacyResult {
  const bad = canTalk(state, from, to);
  if (bad) return bad;
  if (relationStatus(state, from, to) === 'war') return { ok: false, text: 'Вы уже воюете' };
  const broke = hasTradeTreaty(state, from, to) || hasAlliance(state, from, to);
  state.flags = state.flags.filter((f) => f !== tradeFlag(from, to));
  declareWar(state, from, to);
  if (broke) {
    for (const other of Object.keys(state.factions)) {
      if (other !== from && other !== to) changeRelation(state, from, other, -D.treatyBreakPenalty);
    }
  }
  addMessage(state, `${getFaction(from).name} объявляет войну: ${getFaction(to).name}`);
  return { ok: true, text: `Война с ${getFaction(to).name}!${broke ? ' Нарушение договора не забудут.' : ''}` };
}

/** Действие договоров за ход: доход от торговли и рост отношений. */
export function processTreaties(state: GameState): void {
  for (const flag of state.flags) {
    const [kind, pair] = flag.split(':');
    if (kind !== 'trade' && kind !== 'alliance') continue;
    const [a, b] = pair.split('|');
    if (!state.factions[a] || !state.factions[b]) continue;
    if (relationStatus(state, a, b) === 'war') continue;
    changeRelation(state, a, b, D.treatyRelationPerTurn);
    if (kind === 'trade') {
      addRes(state.factions[a].resources, { ammo: D.tradeIncomeAmmo });
      addRes(state.factions[b].resources, { ammo: D.tradeIncomeAmmo });
    }
  }
}
