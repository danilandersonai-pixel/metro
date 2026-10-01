// Экономика в конце хода: доход → здания → содержание → боевой дух → население → стройка.
import { BALANCE, getBuilding, getUnitType, RESOURCE_IDS } from '../content';
import { addMessage, type GameState } from '../state';
import type { Resources, Unit } from '../types';
import { advanceConstruction, stationEffect, workingBuildings } from './buildings';
import { addRes, canAfford, pay, scaleRes } from './resources';

const E = BALANCE.economy;

export interface EconomyForecast {
  income: Resources;
  expenses: Resources;
  net: Resources;
}

/** Все бойцы фракции: в отрядах и в гарнизонах её станций. */
export function factionUnits(state: GameState, factionId: string): Unit[] {
  const units: Unit[] = [];
  for (const sq of state.squads) if (sq.factionId === factionId) units.push(...sq.units);
  for (const st of Object.values(state.stations)) if (st.ownerFactionId === factionId) units.push(...st.garrison);
  return units;
}

export function ownedStations(state: GameState, factionId: string) {
  return Object.values(state.stations).filter((s) => s.ownerFactionId === factionId);
}

function unitUpkeep(units: Unit[]): Resources {
  const total: Resources = {};
  for (const u of units) addRes(total, getUnitType(u.typeId).upkeep);
  return total;
}

function populationFood(state: GameState, factionId: string): number {
  const pop = ownedStations(state, factionId).reduce((s, st) => s + st.population, 0);
  return Math.round((pop * E.foodPer100Population) / 100);
}

/** Прогноз на ход (без случайностей): сколько придёт и сколько уйдёт. */
export function forecastEconomy(state: GameState, factionId: string): EconomyForecast {
  const income: Resources = {};
  const expenses: Resources = {};
  for (const st of ownedStations(state, factionId)) {
    addRes(income, { ammo: Math.round(st.population * E.taxAmmoPerPopulation) });
    for (const b of workingBuildings(st)) {
      const def = getBuilding(b.typeId);
      addRes(expenses, scaleRes(def.upkeep, b.level));
      for (const e of def.effects) if (e.type === 'produce' && e.resource) addRes(income, { [e.resource]: e.value * b.level });
    }
  }
  addRes(expenses, unitUpkeep(factionUnits(state, factionId)));
  addRes(expenses, { food: populationFood(state, factionId) });
  const net: Resources = {};
  for (const id of RESOURCE_IDS) {
    const v = (income[id] ?? 0) - (expenses[id] ?? 0);
    if (v) net[id] = v;
  }
  return { income, expenses, net };
}

/** Обработать экономику фракции за ход. Сообщения игроку пишутся в state.messages. */
export function processEconomy(state: GameState, factionId: string): void {
  const faction = state.factions[factionId];
  if (!faction || faction.defeated) return;
  const isPlayer = factionId === state.playerFactionId;
  const say = (text: string) => isPlayer && addMessage(state, text);
  const res = faction.resources;
  const stations = ownedStations(state, factionId);

  // 1. Налоги
  for (const st of stations) addRes(res, { ammo: Math.round(st.population * E.taxAmmoPerPopulation) });

  // 2. Здания: сначала топливо и энергия (order), содержание платится перед производством.
  const jobs = stations.flatMap((st) => workingBuildings(st).map((b) => ({ st, b, def: getBuilding(b.typeId) })));
  jobs.sort((a, b) => a.def.order - b.def.order);
  const idle: string[] = [];
  for (const { st, b, def } of jobs) {
    const upkeep = scaleRes(def.upkeep, b.level);
    if (!canAfford(res, upkeep)) {
      idle.push(`${def.name} (${st.name})`);
      continue;
    }
    pay(res, upkeep);
    const risk = def.effects.find((e) => e.type === 'risk');
    if (risk && state.rng.chance(risk.value)) {
      st.population = Math.max(0, st.population - E.stalkerLossPopulation);
      say(`${st.name}: вылазка сталкеров закончилась потерями`);
      continue;
    }
    for (const e of def.effects) {
      if (e.type === 'produce' && e.resource) addRes(res, { [e.resource]: e.value * b.level });
    }
  }
  if (idle.length) say(`Простаивают без снабжения: ${idle.join(', ')}`);

  // 3. Содержание бойцов и население
  const need = unitUpkeep(factionUnits(state, factionId));
  addRes(need, { food: populationFood(state, factionId) });
  const short: string[] = [];
  for (const id of RESOURCE_IDS) {
    const n = need[id] ?? 0;
    if (n <= 0) continue;
    const have = res[id] ?? 0;
    if (have >= n) res[id] = have - n;
    else {
      res[id] = 0;
      short.push(id);
    }
  }

  // 4. Боевой дух и дезертирство
  const moraleBonus = stations.reduce((s, st) => s + stationEffect(st, 'morale'), 0);
  if (short.length) {
    faction.morale = Math.max(0, faction.morale - E.moraleLossOnShortage);
    say(`Не хватает: ${short.map((id) => (id === 'food' ? 'еды' : id === 'ammo' ? 'патронов' : id)).join(', ')}. Боевой дух падает (${faction.morale}).`);
  } else {
    faction.morale = Math.min(100, faction.morale + E.moraleRecovery + moraleBonus);
  }
  if (faction.morale < E.desertionMoraleThreshold && state.rng.chance(E.desertionChance)) {
    desert(state, factionId);
  }

  // 5. Население
  const foodShort = short.includes('food');
  for (const st of stations) {
    if (st.population <= 0) continue;
    const cap = E.basePopulationCap + stationEffect(st, 'housing');
    const delta = Math.max(1, Math.round(st.population * E.populationGrowth));
    st.population = foodShort ? Math.max(0, st.population - delta) : Math.min(cap, st.population + delta);
  }

  // 6. Стройка
  advanceConstruction(state, factionId);

  // Защита от отрицательных значений
  for (const id of RESOURCE_IDS) if ((res[id] ?? 0) < 0) res[id] = 0;
}

/** Один случайный боец (не наёмник) покидает фракцию. */
function desert(state: GameState, factionId: string): void {
  const pools: Unit[][] = [];
  for (const sq of state.squads) if (sq.factionId === factionId) pools.push(sq.units);
  for (const st of Object.values(state.stations)) if (st.ownerFactionId === factionId) pools.push(st.garrison);
  const candidates = pools.flatMap((pool) => pool.filter((u) => !getUnitType(u.typeId).mercenary).map((u) => ({ pool, u })));
  if (candidates.length === 0) return;
  const { pool, u } = state.rng.pick(candidates);
  pool.splice(pool.indexOf(u), 1);
  if (factionId === state.playerFactionId) addMessage(state, `${getUnitType(u.typeId).name} дезертировал из-за низкого боевого духа`);
  state.squads = state.squads.filter((s) => s.units.length > 0);
}
