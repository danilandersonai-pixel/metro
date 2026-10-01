// Торговля с торговыми фракциями. Валюта — патроны.
import { BALANCE, getFaction } from '../content';
import { stationEffect } from '../economy/buildings';
import { ownedStations } from '../economy/turn';
import type { GameState } from '../state';
import type { ResourceId } from '../types';
import { changeRelation, getRelation, relationStatus } from './relations';

const T = BALANCE.trade;

export const TRADE_GOODS = Object.keys(T.basePrices) as ResourceId[];

export function canTradeWith(state: GameState, player: string, trader: string): { ok: boolean; reason?: string } {
  const f = getFaction(trader);
  if (!f.canTrade || f.noDiplomacy) return { ok: false, reason: 'Эта фракция не торгует' };
  if (state.factions[trader]?.defeated) return { ok: false, reason: 'Фракция разгромлена' };
  if (relationStatus(state, player, trader) === 'war') return { ok: false, reason: 'С врагами не торгуют' };
  return { ok: true };
}

/** Скидка от Рынков игрока (эффект trade). */
function marketDiscount(state: GameState, factionId: string): number {
  const levels = ownedStations(state, factionId).reduce((s, st) => s + stationEffect(st, 'trade'), 0);
  return Math.min(0.3, levels * T.marketDiscountPerLevel);
}

/** Множитель цены от запасов торговца: мало товара — дороже. */
function stockMod(state: GameState, trader: string, good: ResourceId): number {
  const stock = state.factions[trader].resources[good] ?? 0;
  const k = 1 + ((T.stockTarget - stock) / T.stockTarget) * T.stockInfluence;
  return Math.max(0.75, Math.min(1.5, k));
}

/** Цены за одну единицу товара: сколько патронов игрок платит (buy) и получает (sell). */
export function prices(state: GameState, player: string, trader: string, good: ResourceId): { buy: number; sell: number } {
  const base = (T.basePrices as Record<string, number>)[good];
  const relation = getRelation(state, player, trader);
  const relationMod = 1 - relation / 400;
  const discount = 1 - marketDiscount(state, player);
  const mid = base * stockMod(state, trader, good);
  const buyPrice = Math.max(1, Math.round(mid * (1 + T.spread) * relationMod * discount * 10) / 10);
  // Продажа всегда дешевле покупки — иначе можно бесконечно перепродавать.
  const sellRaw = mid * (1 - T.spread) * (1 + relation / 800);
  const sellPrice = Math.max(0.5, Math.round(Math.min(sellRaw, buyPrice * (1 - T.minMargin)) * 10) / 10);
  return { buy: buyPrice, sell: sellPrice };
}

function tradeRelationBonus(state: GameState, player: string, trader: string): void {
  const key = `tradeRel:${trader}`;
  const used = state.turnCounters[key] ?? 0;
  if (used < T.relationPerTurnCap) {
    changeRelation(state, player, trader, T.relationPerTrade);
    state.turnCounters[key] = used + 1;
  }
}

/** Купить lot единиц товара. Возвращает текст ошибки или null. */
export function buy(state: GameState, player: string, trader: string, good: ResourceId, amount = T.lot): string | null {
  const check = canTradeWith(state, player, trader);
  if (!check.ok) return check.reason!;
  const their = state.factions[trader].resources;
  const mine = state.factions[player].resources;
  if ((their[good] ?? 0) < amount) return 'У торговца нет столько товара';
  const cost = Math.ceil(prices(state, player, trader, good).buy * amount);
  if ((mine.ammo ?? 0) < cost) return 'Не хватает патронов';
  mine.ammo = (mine.ammo ?? 0) - cost;
  their.ammo = (their.ammo ?? 0) + cost;
  their[good] = (their[good] ?? 0) - amount;
  mine[good] = (mine[good] ?? 0) + amount;
  tradeRelationBonus(state, player, trader);
  return null;
}

/** Продать lot единиц товара. */
export function sell(state: GameState, player: string, trader: string, good: ResourceId, amount = T.lot): string | null {
  const check = canTradeWith(state, player, trader);
  if (!check.ok) return check.reason!;
  const their = state.factions[trader].resources;
  const mine = state.factions[player].resources;
  if ((mine[good] ?? 0) < amount) return 'У вас нет столько товара';
  const gain = Math.floor(prices(state, player, trader, good).sell * amount);
  if ((their.ammo ?? 0) < gain) return 'У торговца нет столько патронов';
  mine[good] = (mine[good] ?? 0) - amount;
  their[good] = (their[good] ?? 0) + amount;
  their.ammo = (their.ammo ?? 0) - gain;
  mine.ammo = (mine.ammo ?? 0) + gain;
  tradeRelationBonus(state, player, trader);
  return null;
}
