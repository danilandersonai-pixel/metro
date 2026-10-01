// ИИ фракций на глобальной карте (раздел 8.4 CLAUDE.md):
// оценка угроз → оборона/найм → стройка по характеру → атака слабой соседней станции при перевесе ×1.3.
import { BALANCE, getFaction, getUnitType } from '../content';
import { canBuild, constructionInProgress, hasEffect, startConstruction } from '../economy/buildings';
import { forecastEconomy, ownedStations } from '../economy/turn';
import { canHire, formSquad, hireUnit } from '../economy/units';
import { autoResolveBattle, involvesPlayer } from '../map/autoresolve';
import { findPath, neighbors } from '../map/graph';
import { activeUnits, canMove, moveSquad, negotiateCost, type MoveOptions } from '../map/movement';
import { addMessage, type GameState } from '../state';
import type { Squad } from '../types';
import { maxHpOf } from '../units/stats';
import { declareWarOn, makePeace, willingness } from './diplomacy';
import { getRelation, isAtWar, isFriendly, relationStatus } from './relations';
import { squadPower, stationDefensePower, strengthRatio, unitPower, unitsPower } from './strength';

const AI = BALANCE.factionAi;
const D = BALANCE.diplomacy;

/** Ход одной ИИ-фракции. */
export function runFactionAi(state: GameState, factionId: string): void {
  const faction = getFaction(factionId);
  if (faction.noDiplomacy || factionId === state.playerFactionId || state.factions[factionId].defeated) return;
  aiDiplomacy(state, factionId);
  aiSupply(state, factionId);
  aiHire(state, factionId);
  aiBuild(state, factionId);
  aiFormSquads(state, factionId);
  aiMoveSquads(state, factionId);
}

function ammo(state: GameState, factionId: string): number {
  return state.factions[factionId].resources.ammo ?? 0;
}

/** Фракции, с которыми у нас общая граница (соседние станции). */
function neighborFactions(state: GameState, factionId: string): Set<string> {
  const result = new Set<string>();
  for (const st of ownedStations(state, factionId)) {
    for (const n of neighbors(state, st.id)) {
      const owner = state.stations[n.stationId].ownerFactionId;
      if (owner && owner !== factionId && !getFaction(owner).noDiplomacy) result.add(owner);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Дипломатия
// ---------------------------------------------------------------------------

function aiDiplomacy(state: GameState, factionId: string): void {
  const me = getFaction(factionId);
  for (const other of neighborFactions(state, factionId)) {
    const ratio = strengthRatio(state, factionId, other);
    const atWar = isAtWar(state, factionId, other);
    if (!atWar && me.aiPersonality === 'aggressor' && getRelation(state, factionId, other) < D.aiDeclareWarRelation && ratio > D.aiDeclareWarRatio) {
      declareWarOn(state, factionId, other);
      continue;
    }
    if (atWar && ratio < D.aiPeaceOfferRatio && state.rng.chance(D.aiPeaceOfferChance)) {
      if (other === state.playerFactionId) {
        if (!state.pendingEvents.some((e) => e.kind === 'peace_offer' && e.factionId === factionId)) {
          state.pendingEvents.push({ kind: 'peace_offer', factionId });
        }
      } else if (willingness(state, other, factionId) >= D.peaceAcceptThreshold) {
        makePeace(state, factionId, other);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Снабжение: ИИ докупает у караванов то, чего не хватает (дороже рыночной цены)
// ---------------------------------------------------------------------------

function aiSupply(state: GameState, factionId: string): void {
  const res = state.factions[factionId].resources;
  const prices = BALANCE.trade.basePrices as Record<string, number>;
  for (const [good, min] of Object.entries(AI.supplyMinStock as Record<string, number>)) {
    const key = good as keyof typeof res;
    let guard = 0;
    while ((res[key] ?? 0) < min && guard++ < 5) {
      const cost = Math.ceil(prices[good] * AI.supplyPriceMult * AI.supplyBatch);
      if ((res.ammo ?? 0) - cost < AI.reserveAmmo) return;
      res.ammo = (res.ammo ?? 0) - cost;
      res[key] = (res[key] ?? 0) + AI.supplyBatch;
    }
  }
}

/** Прокормим ли ещё одного бойца: еда в плюсе или её запаса хватит надолго. */
function canFeedMore(state: GameState, factionId: string, typeId: string): boolean {
  const extra = getUnitType(typeId).upkeep.food ?? 0;
  const net = (forecastEconomy(state, factionId).net.food ?? 0) - extra;
  const stock = state.factions[factionId].resources.food ?? 0;
  return net >= 0 || stock >= -net * AI.foodStockTurnsPerDeficit;
}

// ---------------------------------------------------------------------------
// Найм и оборона
// ---------------------------------------------------------------------------

/** Угроза станции: сила вражеских отрядов на соседних станциях. */
function threatTo(state: GameState, factionId: string, stationId: string): number {
  let threat = 0;
  for (const n of neighbors(state, stationId)) {
    for (const sq of state.squads) {
      if (sq.stationId === n.stationId && isAtWar(state, factionId, sq.factionId)) threat += squadPower(sq);
    }
  }
  return threat;
}

/** Лучший по соотношению сила/цена тип бойца, который можно нанять здесь. */
function bestHire(state: GameState, factionId: string, stationId: string): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const typeId of getFaction(factionId).unitPool) {
    const check = canHire(state, stationId, typeId, factionId);
    if (!check.ok || !canFeedMore(state, factionId, typeId)) continue;
    const cost = check.cost.ammo ?? 0;
    if (ammo(state, factionId) - cost < AI.reserveAmmo) continue;
    const type = getUnitType(typeId);
    const score = (type.hp * type.damage * type.accuracy) / Math.max(1, cost);
    if (score > bestScore) {
      best = typeId;
      bestScore = score;
    }
  }
  return best;
}

/** Собственная оборона станции: гарнизон + свои отряды на ней. */
function ownDefense(state: GameState, factionId: string, stationId: string): number {
  const st = state.stations[stationId];
  return unitsPower(st.garrison) + state.squads.filter((s) => s.stationId === stationId && s.factionId === factionId).reduce((sum, s) => sum + squadPower(s), 0);
}

function aiHire(state: GameState, factionId: string): void {
  const stations = ownedStations(state, factionId).filter((st) => hasEffect(st, 'recruit'));
  if (stations.length === 0) return;
  // Сначала — станции под угрозой, потом — остальные.
  const ranked = stations
    .map((st) => ({ st, need: threatTo(state, factionId, st.id) * AI.defenseRatio - ownDefense(state, factionId, st.id) }))
    .sort((a, b) => b.need - a.need);
  let hires = 0;
  for (const { st, need } of ranked) {
    // Нанимаем при угрозе или если войск мало для желаемых отрядов.
    const desired = (AI.desiredSquads as Record<string, number>)[getFaction(factionId).aiPersonality] ?? 0;
    const squads = state.squads.filter((s) => s.factionId === factionId).length;
    const wantArmy = squads < desired || st.garrison.length < AI.minGarrison + 2;
    if (need <= 0 && !wantArmy) continue;
    while (hires < 2) {
      const typeId = bestHire(state, factionId, st.id);
      if (!typeId || hireUnit(state, st.id, typeId, factionId)) break;
      hires++;
      if (st.garrison.length >= AI.minGarrison + 4) break;
    }
  }
}

// ---------------------------------------------------------------------------
// Стройка
// ---------------------------------------------------------------------------

function aiBuild(state: GameState, factionId: string): void {
  const personality = getFaction(factionId).aiPersonality;
  const priority = [...((AI.buildPriority as Record<string, string[]>)[personality] ?? [])];
  if ((forecastEconomy(state, factionId).net.food ?? 0) < 0) priority.unshift('mushroom_farm');
  let started = 0;
  const stations = ownedStations(state, factionId).sort((a, b) => b.population - a.population);
  for (const st of stations) {
    if (started >= 2) break;
    if (constructionInProgress(st)) continue;
    for (const buildingId of priority) {
      const check = canBuild(state, st.id, buildingId, factionId);
      if (!check.ok) continue;
      if (ammo(state, factionId) - (check.cost.ammo ?? 0) < AI.reserveAmmo) continue;
      // Улучшаем только фермы, а остальное — когда фракция богата.
      if (check.targetLevel > 1 && buildingId !== 'mushroom_farm' && ammo(state, factionId) < AI.richAmmo) continue;
      if (!startConstruction(state, st.id, buildingId, factionId)) {
        started++;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Отряды
// ---------------------------------------------------------------------------

function aiFormSquads(state: GameState, factionId: string): void {
  const desired = (AI.desiredSquads as Record<string, number>)[getFaction(factionId).aiPersonality] ?? 0;
  let squads = state.squads.filter((s) => s.factionId === factionId).length;
  for (const st of ownedStations(state, factionId)) {
    if (squads >= desired) return;
    const spare = st.garrison.length - AI.minGarrison;
    if (spare < 3) continue;
    const strongest = [...st.garrison].sort((a, b) => unitPower(b) - unitPower(a)).slice(0, Math.min(BALANCE.map.maxSquadSize, spare));
    const r = formSquad(state, st.id, strongest.map((u) => u.uid));
    if (typeof r !== 'string') squads++;
  }
}

function squadHealth(sq: Squad): number {
  const max = sq.units.reduce((s, u) => s + maxHpOf(u), 0);
  return max > 0 ? sq.units.reduce((s, u) => s + u.hp, 0) / max : 0;
}

/** Цель для атаки: подходящая станция и опции хода. */
interface Target {
  stationId: string;
  opts: MoveOptions;
  defense: number;
}

function evaluateTarget(state: GameState, sq: Squad, stationId: string): Target | null {
  const st = state.stations[stationId];
  if (!st.unlocked) return null;
  const owner = st.ownerFactionId;
  const me = sq.factionId;
  const personality = getFaction(me).aiPersonality;
  if (owner === me || (owner && isFriendly(state, owner, me))) return null;
  // Чужие отряды на станции, с которыми мы не воюем — не трогаем.
  if (state.squads.some((o) => o.stationId === stationId && o.factionId !== me && !isAtWar(state, me, o.factionId))) return null;
  const opts: MoveOptions = {};
  // Первые ходы ИИ не трогает игрока — дать освоиться.
  const playerThere = owner === state.playerFactionId || state.squads.some((o) => o.stationId === stationId && o.factionId === state.playerFactionId);
  if (playerThere && state.turn <= AI.gracePeriodTurns) return null;
  if (owner) {
    if (!isAtWar(state, me, owner)) return null;
  } else if (st.population > 0) {
    if (personality === 'isolationist') return null;
    const cost = negotiateCost(state, stationId).ammo ?? 0;
    opts.neutralChoice = personality === 'trader' && ammo(state, me) - cost >= AI.reserveAmmo ? 'negotiate' : 'force';
    if (opts.neutralChoice === 'force' && personality !== 'aggressor') return null;
  }
  const defense = opts.neutralChoice === 'negotiate' ? 0 : stationDefensePower(state, stationId, me);
  return { stationId, opts, defense };
}

function aiMoveSquads(state: GameState, factionId: string): void {
  const personality = getFaction(factionId).aiPersonality;
  for (const sq of [...state.squads]) {
    if (sq.factionId !== factionId || !state.squads.includes(sq)) continue;
    let guard = 0;
    while (sq.movePoints > 0 && activeUnits(sq).length > 0 && state.squads.includes(sq) && guard++ < 4) {
      if (!aiSquadStep(state, sq, personality)) break;
    }
  }
}

/** Один шаг отряда ИИ. Возвращает false, если отряд решил стоять. */
function aiSquadStep(state: GameState, sq: Squad, personality: string): boolean {
  const me = sq.factionId;
  // В тоннеле — идём дальше.
  if (sq.tunnelPos) return doMove(state, sq, sq.tunnelPos.to, {});
  const here = sq.stationId!;

  // Сильно потрёпан — домой лечиться.
  if (squadHealth(sq) < AI.retreatHpFraction) {
    if (state.stations[here].ownerFactionId === me) return false;
    const home = nearestOwn(state, sq);
    if (!home) return false;
    return doMove(state, sq, home, {});
  }

  // Соседние цели с перевесом сил.
  const power = squadPower(sq);
  const targets = neighbors(state, here)
    .map((n) => (canMove(state, sq, n.stationId) ? evaluateTarget(state, sq, n.stationId) : null))
    .filter((t): t is Target => !!t && power >= t.defense * AI.attackRatio)
    .sort((a, b) => a.defense - b.defense);
  if (targets.length > 0) return doMove(state, sq, targets[0].stationId, targets[0].opts);

  // Агрессор идёт к ближайшей цели через свои/пустые станции.
  if (personality !== 'aggressor') return false;
  const goal = nearestTarget(state, sq);
  if (!goal) return false;
  const path = findPath(state, here, goal, (id) => {
    const o = state.stations[id].ownerFactionId;
    return (o === me || (o !== null && isFriendly(state, o, me))) && state.stations[id].unlocked;
  });
  if (!path || path.length < 2) return false;
  return doMove(state, sq, path[0], {});
}

function nearestOwn(state: GameState, sq: Squad): string | null {
  let best: string | null = null;
  let bestLen = Infinity;
  for (const st of ownedStations(state, sq.factionId)) {
    const path = findPath(state, sq.stationId!, st.id);
    if (path && path.length < bestLen) {
      best = path[0] ?? null;
      bestLen = path.length;
    }
  }
  return best;
}

function nearestTarget(state: GameState, sq: Squad): string | null {
  let best: string | null = null;
  let bestLen = Infinity;
  for (const st of Object.values(state.stations)) {
    if (!evaluateTarget(state, sq, st.id)) continue;
    const path = findPath(state, sq.stationId!, st.id);
    if (path && path.length < bestLen) {
      best = st.id;
      bestLen = path.length;
    }
  }
  return best;
}

/** Ход с обработкой боя: бой без игрока проводится сразу, с игроком — ставится в очередь. */
function doMove(state: GameState, sq: Squad, to: string, opts: MoveOptions): boolean {
  const r = moveSquad(state, sq.id, to, opts);
  if (r.kind === 'battle') {
    if (involvesPlayer(state, r.battle)) {
      const st = state.stations[r.battle.targetStationId];
      addMessage(state, `${getFaction(sq.factionId).name} атакует станцию ${st.name}!`);
      return false;
    }
    autoResolveBattle(state, r.battle);
    return false;
  }
  return r.kind === 'moved' || r.kind === 'captured' || r.kind === 'in_tunnel';
}

/** Для интерфейса: краткая оценка намерений фракции. */
export function describeStance(state: GameState, factionId: string): string {
  const status = relationStatus(state, state.playerFactionId, factionId);
  const ratio = strengthRatio(state, factionId, state.playerFactionId);
  const power = ratio > 1.5 ? 'намного сильнее вас' : ratio > 1.1 ? 'сильнее вас' : ratio > 0.9 ? 'равны по силе' : ratio > 0.6 ? 'слабее вас' : 'намного слабее вас';
  return `${status === 'war' ? 'Воюет с вами' : 'Не воюет с вами'}, ${power}`;
}
