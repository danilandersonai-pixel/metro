import { describe, expect, it } from 'vitest';
import { BALANCE, getBuilding, getUnitType } from '../src/core/content';
import { canBuild, constructionInProgress, repairBuilding, startConstruction } from '../src/core/economy/buildings';
import { factionUnits, forecastEconomy, processEconomy } from '../src/core/economy/turn';
import { canHire, formSquad, hireUnit, moveToGarrison, moveToSquad } from '../src/core/economy/units';
import { stationDefenseModifiers } from '../src/core/map/battles';
import { createNewGame, type GameState } from '../src/core/state';
import { endTurn } from '../src/core/turn';

/** Без случайных событий и ИИ — проверяем только свою механику. */
const QUIET = { events: false, ai: false };
import { maxHpOf } from '../src/core/units/stats';

const P = 'sokolniki_community';

function game(): GameState {
  const s = createNewGame(1);
  for (const t of s.tunnels) t.danger = 0;
  return s;
}

const res = (s: GameState) => s.factions[P].resources;

describe('доход и содержание', () => {
  it('налоги и ферма приносят доход, бойцы и жители его едят', () => {
    const s = game();
    const f = forecastEconomy(s, P);
    // Сокольники: 200 жителей × 0.1 = 20 патронов, ферма = 10 еды
    expect(f.income.ammo).toBe(20);
    expect(f.income.food).toBe(10);
    expect(f.expenses.food).toBeGreaterThan(0);
    const before = { ...res(s) };
    processEconomy(s, P);
    expect(res(s).ammo).toBe(before.ammo! + (f.net.ammo ?? 0));
    expect(res(s).food).toBe(before.food! + (f.net.food ?? 0));
  });

  it('нехватка еды роняет боевой дух, при очень низком духе бойцы дезертируют', () => {
    const s = game();
    res(s).food = 0;
    res(s).ammo = 0;
    s.stations.sokolniki.buildings = [];
    const units = factionUnits(s, P).length;
    for (let i = 0; i < 12; i++) processEconomy(s, P);
    expect(s.factions[P].morale).toBeLessThan(BALANCE.economy.desertionMoraleThreshold);
    expect(factionUnits(s, P).length).toBeLessThan(units);
  });

  it('без еды население убывает, с едой растёт до предела', () => {
    const s = game();
    res(s).food = 1000;
    processEconomy(s, P);
    expect(s.stations.sokolniki.population).toBeGreaterThan(200);
    for (let i = 0; i < 50; i++) processEconomy(s, P);
    expect(s.stations.sokolniki.population).toBeLessThanOrEqual(BALANCE.economy.basePopulationCap);
  });

  it('здание без снабжения простаивает', () => {
    const s = game();
    const st = s.stations.sokolniki;
    st.buildings.push({ typeId: 'workshop', level: 1, turnsLeft: 0, damaged: false });
    res(s).power = 0;
    res(s).scrap = 10;
    const ammoForecast = forecastEconomy(s, P).net.ammo ?? 0;
    const before = res(s).ammo!;
    processEconomy(s, P);
    // мастерская не дала 12 патронов, хлам не потрачен
    expect(res(s).ammo).toBe(before + ammoForecast - 12);
    expect(res(s).scrap).toBe(10);
  });
});

describe('стройка', () => {
  it('стройка списывает цену, идёт buildTurns ходов и потом работает', () => {
    const s = game();
    res(s).ammo = 500;
    res(s).scrap = 100;
    const ammo = res(s).ammo!;
    expect(startConstruction(s, 'sokolniki', 'checkpoint', P)).toBeNull();
    expect(res(s).ammo).toBe(ammo - getBuilding('checkpoint').cost.ammo!);
    // Вторая стройка одновременно невозможна
    expect(canBuild(s, 'sokolniki', 'fuel_depot', P).ok).toBe(false);
    expect(stationDefenseModifiers(s, 'sokolniki').accuracyBonus ?? 0).toBe(0);
    for (let i = 0; i < getBuilding('checkpoint').buildTurns; i++) endTurn(s, QUIET);
    expect(constructionInProgress(s.stations.sokolniki)).toBeNull();
    expect(stationDefenseModifiers(s, 'sokolniki').accuracyBonus).toBeCloseTo(0.05);
  });

  it('улучшение повышает уровень и производство', () => {
    const s = game();
    res(s).ammo = 1000;
    res(s).scrap = 100;
    const before = forecastEconomy(s, P).income.food!;
    expect(canBuild(s, 'sokolniki', 'mushroom_farm', P).targetLevel).toBe(2);
    startConstruction(s, 'sokolniki', 'mushroom_farm', P);
    endTurn(s, QUIET);
    endTurn(s, QUIET);
    expect(forecastEconomy(s, P).income.food).toBe(before + 10);
  });

  it('пост сталкеров — только у выхода на поверхность', () => {
    const s = game();
    res(s).ammo = 1000;
    res(s).food = 1000;
    s.stations.krasnoselskaya.ownerFactionId = P;
    s.stations.krasnoselskaya.buildings = [];
    expect(canBuild(s, 'krasnoselskaya', 'stalker_post', P).ok).toBe(false);
    expect(canBuild(s, 'sokolniki', 'stalker_post', P).ok).toBe(true);
  });

  it('чужая станция и нехватка ресурсов запрещают стройку', () => {
    const s = game();
    expect(canBuild(s, 'krasnoselskaya', 'checkpoint', P).ok).toBe(false);
    res(s).ammo = 0;
    expect(canBuild(s, 'sokolniki', 'checkpoint', P).reason).toBe('Не хватает ресурсов');
  });

  it('повреждённое здание не работает, ремонт его чинит', () => {
    const s = game();
    const farm = s.stations.sokolniki.buildings.find((b) => b.typeId === 'mushroom_farm')!;
    farm.damaged = true;
    expect(forecastEconomy(s, P).income.food ?? 0).toBe(0);
    expect(repairBuilding(s, 'sokolniki', 'mushroom_farm', P)).toBeNull();
    expect(forecastEconomy(s, P).income.food).toBe(10);
  });
});

describe('найм и отряды', () => {
  it('найм в гарнизон за ресурсы при наличии вербовочного пункта', () => {
    const s = game();
    const g = s.stations.sokolniki.garrison.length;
    const ammo = res(s).ammo!;
    expect(hireUnit(s, 'sokolniki', 'rifleman', P)).toBeNull();
    expect(s.stations.sokolniki.garrison.length).toBe(g + 1);
    expect(res(s).ammo).toBe(ammo - getUnitType('rifleman').cost.ammo!);
  });

  it('без вербовочного пункта и для чужих типов найм запрещён', () => {
    const s = game();
    expect(canHire(s, 'sokolniki', 'machinegunner', P).ok).toBe(false);
    s.stations.sokolniki.buildings = [];
    expect(canHire(s, 'sokolniki', 'rifleman', P).reason).toBe('Нужен Вербовочный пункт');
  });

  it('перевод бойцов между гарнизоном и отрядом, новый отряд из гарнизона', () => {
    const s = game();
    const st = s.stations.sokolniki;
    const sq = s.squads.find((q) => q.factionId === P)!;
    const uid = st.garrison[0].uid;
    expect(moveToSquad(s, 'sokolniki', uid, sq.id)).toBeNull();
    expect(sq.units.some((u) => u.uid === uid)).toBe(true);
    // отряд полон (6) — больше нельзя
    expect(moveToSquad(s, 'sokolniki', st.garrison[0].uid, sq.id)).toBe('В отряде нет места');
    const created = formSquad(s, 'sokolniki', [st.garrison[0].uid]);
    expect(typeof created).toBe('object');
    // расформирование: перевели единственного бойца назад — отряд исчез
    if (typeof created === 'object') {
      moveToGarrison(s, 'sokolniki', created.id, created.units[0].uid);
      expect(s.squads.find((q) => q.id === created.id)).toBeUndefined();
    }
  });

  it('лазарет ускоряет лечение гарнизона', () => {
    const s = game();
    const st = s.stations.sokolniki;
    const u = st.garrison[0];
    u.hp = 1;
    endTurn(s, QUIET);
    const plain = u.hp - 1;
    u.hp = 1;
    st.buildings.push({ typeId: 'infirmary', level: 1, turnsLeft: 0, damaged: false });
    res(s).power = 100;
    endTurn(s, QUIET);
    expect(u.hp - 1).toBeGreaterThan(plain);
    expect(u.hp).toBeLessThanOrEqual(maxHpOf(u));
  });
});

describe('улучшение без простоя', () => {
  it('во время улучшения здание работает на старом уровне', () => {
    const s = game();
    res(s).ammo = 1000;
    res(s).scrap = 100;
    const before = forecastEconomy(s, P).income.food!;
    startConstruction(s, 'sokolniki', 'mushroom_farm', P);
    expect(forecastEconomy(s, P).income.food).toBe(before);
  });
});
