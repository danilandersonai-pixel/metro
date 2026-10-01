import { describe, expect, it } from 'vitest';
import { collectOutcome, createBattle, getCombatant, runAutoBattle } from '../src/core/battle';
import { BALANCE } from '../src/core/content';
import { runFactionAi } from '../src/core/factions/ai';
import {
  declareWarOn,
  giftAmmo,
  hasTradeTreaty,
  processTreaties,
  proposePeace,
  proposeTrade,
} from '../src/core/factions/diplomacy';
import { getRelation, relationStatus, setRelation } from '../src/core/factions/relations';
import { buy, canTradeWith, prices, sell } from '../src/core/factions/trade';
import { applyEventChoice, isRaidTarget, mutantAttackChance, processEvents } from '../src/core/events';
import { createNewGame, newUnit, type GameState } from '../src/core/state';
import { grantXp, unitAbilities, xpToNext } from '../src/core/units/experience';
import { createUnit, maxHpOf } from '../src/core/units/stats';

const P = 'sokolniki_community';
const C = 'krasnoselsk_commune';
const U = 'ring_trade_union';

function game(): GameState {
  const s = createNewGame(1);
  for (const t of s.tunnels) t.danger = 0;
  return s;
}

describe('опыт и уровни', () => {
  it('кривая опыта: 100 × уровень^1.5', () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(4)).toBe(800);
  });

  it('уровень растёт, здоровье прибавляется, лишний опыт сохраняется', () => {
    const u = createUnit('militia', 1, 'x');
    const hp = u.hp;
    expect(grantXp(u, 130)).toBe(1);
    expect(u.level).toBe(2);
    expect(u.xp).toBe(30);
    expect(u.hp).toBe(maxHpOf(u));
    expect(u.hp).toBeGreaterThan(hp);
  });

  it('уровень не выше 20', () => {
    const u = createUnit('militia', 19, 'x');
    grantXp(u, 1e9);
    expect(u.level).toBe(BALANCE.experience.maxLevel);
  });

  it('на нужном уровне открывается способность', () => {
    expect(unitAbilities('rifleman', 1)).not.toContain('aimed_shot');
    expect(unitAbilities('rifleman', 4)).toContain('aimed_shot');
    const u = createUnit('rifleman', 4, 'r');
    const s = createBattle({ sides: [{ name: 'A', units: [u] }, { name: 'B', units: [createUnit('militia', 1, 'm')] }], seed: 1 });
    expect(getCombatant(s, 'r').abilities).toContain('aimed_shot');
  });

  it('после боя выжившие получают опыт, добивший — больше', () => {
    const a = [createUnit('sniper', 10, 'a1'), createUnit('militia', 1, 'a2')];
    const b = [createUnit('rat_swarm', 1, 'b1')];
    const s = createBattle({ sides: [{ name: 'A', units: a, ai: true }, { name: 'B', units: b, ai: true }], seed: 2 });
    runAutoBattle(s);
    const out = collectOutcome(s);
    expect(out.winner).toBe(0);
    const xp = Object.fromEntries(out.sides[0].survivors.map((u) => [u.uid, u.xp]));
    const killer = out.sides[0].kills.a1 > 0 ? 'a1' : 'a2';
    const other = killer === 'a1' ? 'a2' : 'a1';
    expect(xp[killer]).toBeGreaterThan(xp[other]);
    expect(xp[other]).toBeGreaterThan(0);
  });
});

describe('дипломатия', () => {
  it('подарок улучшает отношения', () => {
    const s = game();
    const before = getRelation(s, P, U);
    expect(giftAmmo(s, P, U, 50).ok).toBe(true);
    expect(getRelation(s, P, U)).toBe(before + 10);
  });

  it('враг отвергает мир, пока силён, и принимает, когда игрок заметно сильнее', () => {
    const s = game();
    setRelation(s, P, C, -60);
    expect(proposePeace(s, P, C).ok).toBe(false);
    const sq = s.squads.find((q) => q.factionId === P)!;
    sq.units = ['stormtrooper', 'stormtrooper', 'sniper', 'sniper', 'medic', 'stormtrooper'].map((t) => newUnit(s, t, 10));
    expect(proposePeace(s, P, C).ok).toBe(true);
    expect(relationStatus(s, P, C)).not.toBe('war');
  });

  it('подарки сами по себе могут вывести из войны (война — отношения ниже −50)', () => {
    const s = game();
    setRelation(s, P, C, -60);
    giftAmmo(s, P, C, 75);
    expect(relationStatus(s, P, C)).toBe('neutral');
  });

  it('торговый договор приносит патроны и отношения каждый ход', () => {
    const s = game();
    setRelation(s, P, U, 30);
    expect(proposeTrade(s, P, U).ok).toBe(true);
    expect(hasTradeTreaty(s, P, U)).toBe(true);
    const ammo = s.factions[P].resources.ammo!;
    processTreaties(s);
    expect(s.factions[P].resources.ammo).toBe(ammo + BALANCE.diplomacy.tradeIncomeAmmo);
    expect(getRelation(s, P, U)).toBe(31);
  });

  it('объявление войны с нарушением договора портит отношения со всеми', () => {
    const s = game();
    setRelation(s, P, U, 30);
    proposeTrade(s, P, U);
    const commune = getRelation(s, P, C);
    declareWarOn(s, P, U);
    expect(relationStatus(s, P, U)).toBe('war');
    expect(hasTradeTreaty(s, P, U)).toBe(false);
    expect(getRelation(s, P, C)).toBe(commune - BALANCE.diplomacy.treatyBreakPenalty);
  });

  it('с мутантами переговоров нет', () => {
    const s = game();
    expect(giftAmmo(s, P, 'mutants', 10).ok).toBe(false);
  });
});

describe('торговля', () => {
  it('чем лучше отношения, тем дешевле покупка', () => {
    const s = game();
    setRelation(s, P, U, -40);
    const bad = prices(s, P, U, 'meds').buy;
    setRelation(s, P, U, 80);
    const good = prices(s, P, U, 'meds').buy;
    expect(good).toBeLessThan(bad);
    expect(prices(s, P, U, 'meds').sell).toBeLessThan(good);
  });

  it('продать дороже, чем купить, нельзя ни при каких отношениях', () => {
    const s = game();
    for (const r of [-50, 0, 50, 100]) {
      setRelation(s, P, U, r);
      for (const g of ['food', 'fuel', 'power', 'meds', 'scrap'] as const) {
        const p = prices(s, P, U, g);
        expect(p.sell).toBeLessThan(p.buy);
      }
    }
  });

  it('покупка и продажа меняют запасы обеих сторон', () => {
    const s = game();
    const mine = s.factions[P].resources;
    const their = s.factions[U].resources;
    const meds = mine.meds!;
    const ammo = mine.ammo!;
    expect(buy(s, P, U, 'meds')).toBeNull();
    expect(mine.meds).toBe(meds + 5);
    expect(mine.ammo).toBeLessThan(ammo);
    expect(sell(s, P, U, 'scrap')).toBeNull();
    expect(their.scrap).toBe(35);
  });

  it('с врагами и неторговыми фракциями торговать нельзя', () => {
    const s = game();
    expect(canTradeWith(s, P, C).ok).toBe(false);
    declareWarOn(s, P, U);
    expect(buy(s, P, U, 'food')).not.toBeNull();
  });
});

describe('события', () => {
  it('шанс набега растёт со временем, но ограничен', () => {
    expect(mutantAttackChance(50)).toBeGreaterThan(mutantAttackChance(1));
    expect(mutantAttackChance(10000)).toBe(BALANCE.events.mutantAttackMax);
  });

  it('станции у выхода наверх или у логова — цели набегов', () => {
    const s = game();
    expect(isRaidTarget(s, 'sokolniki')).toBe(true);
    expect(isRaidTarget(s, 'krasnoselskaya')).toBe(false);
  });

  it('набег на станцию игрока ставит бой в очередь', () => {
    let found = false;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const s = createNewGame(seed);
      s.turn = 60;
      processEvents(s);
      if (s.pendingBattle?.kind === 'raid') {
        found = true;
        expect(s.pendingBattle.attackerSide).toBe(1);
      }
    }
    expect(found).toBe(true);
  });

  it('выбор в событии меняет ресурсы, население и дух', () => {
    const s = game();
    const food = s.factions[P].resources.food!;
    applyEventChoice(s, 'refugees', 'sokolniki', 0);
    expect(s.stations.sokolniki.population).toBe(230);
    expect(s.factions[P].resources.food).toBe(food - 15);
  });
});

describe('ИИ фракций', () => {
  it('нападает на слабую соседнюю станцию врага при перевесе сил', () => {
    const s = game();
    s.turn = 50;
    // Коммуна в войне с союзом; сильный отряд коммуны рядом со слабой станцией союза
    declareWarOn(s, C, U);
    const sq = s.squads.find((q) => q.factionId === C)!;
    sq.units = ['stormtrooper', 'stormtrooper', 'stormtrooper', 'machinegunner', 'medic', 'rifleman'].map((t) => newUnit(s, t, 8));
    s.stations.komsomolskaya.garrison = [newUnit(s, 'militia')];
    s.squads = s.squads.filter((q) => q.factionId !== U);
    runFactionAi(s, C);
    expect(s.stations.komsomolskaya.ownerFactionId).toBe(C);
  });

  it('не нападает на соседа, с которым нет войны', () => {
    const s = game();
    s.turn = 50;
    const sq = s.squads.find((q) => q.factionId === C)!;
    sq.units = ['stormtrooper', 'stormtrooper', 'stormtrooper'].map((t) => newUnit(s, t, 8));
    s.stations.komsomolskaya.garrison = [];
    s.squads = s.squads.filter((q) => q.factionId !== U);
    setRelation(s, C, U, 50);
    runFactionAi(s, C);
    expect(s.stations.komsomolskaya.ownerFactionId).toBe(U);
  });

  it('атака на игрока ставится игроку в очередь, а не решается сама', () => {
    const s = game();
    s.turn = 50;
    const sq = s.squads.find((q) => q.factionId === C)!;
    sq.units = ['stormtrooper', 'stormtrooper', 'stormtrooper', 'machinegunner', 'medic', 'rifleman'].map((t) => newUnit(s, t, 8));
    s.squads = s.squads.filter((q) => q.factionId !== P);
    runFactionAi(s, C);
    expect(s.pendingBattle?.kind).toBe('station');
    expect(s.pendingBattle?.attackerSide).toBe(1);
    expect(s.stations.sokolniki.ownerFactionId).toBe(P);
  });

  it('в первые ходы ИИ игрока не трогает', () => {
    const s = game();
    const sq = s.squads.find((q) => q.factionId === C)!;
    sq.units = ['stormtrooper', 'stormtrooper', 'stormtrooper'].map((t) => newUnit(s, t, 8));
    s.squads = s.squads.filter((q) => q.factionId !== P);
    runFactionAi(s, C);
    expect(s.pendingBattle).toBeNull();
  });

  it('ИИ нанимает бойцов, когда есть деньги', () => {
    const s = game();
    s.factions[C].resources.ammo = 500;
    s.factions[C].resources.food = 200;
    const before = s.stations.krasnoselskaya.garrison.length;
    runFactionAi(s, C);
    const after = s.stations.krasnoselskaya.garrison.length + s.squads.filter((q) => q.factionId === C).reduce((n, q) => n + q.units.length, 0);
    expect(after).toBeGreaterThan(before + 4);
  });
});
