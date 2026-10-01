import { describe, expect, it } from 'vitest';
import { getRelation, relationStatus } from '../src/core/factions/relations';
import { autoResolvePending } from '../src/core/map/autoresolve';
import { buildBattleInput } from '../src/core/map/battles';
import { findPath, neighbors, visibleStations } from '../src/core/map/graph';
import { moveSquad } from '../src/core/map/movement';
import { createNewGame, newUnit, type GameState } from '../src/core/state';
import { endTurn } from '../src/core/turn';
import { BALANCE } from '../src/core/content';

const PLAYER = 'sokolniki_community';

function game(seed = 1): GameState {
  const s = createNewGame(seed);
  // В тестах убираем случайные засады, кроме специальных проверок.
  for (const t of s.tunnels) t.danger = 0;
  return s;
}

function playerSquad(s: GameState) {
  return s.squads.find((q) => q.factionId === PLAYER)!;
}

/** Усилить отряд игрока, чтобы бой гарантированно выигрывался. */
function makeStrong(s: GameState): void {
  const sq = playerSquad(s);
  sq.units = ['stormtrooper', 'stormtrooper', 'stormtrooper', 'sniper', 'sniper', 'medic'].map((t) => newUnit(s, t, 15));
  sq.units.forEach((u, i) => (u.position = { row: i < 3 ? 0 : 1, slot: i % 3 }));
}

describe('новая игра', () => {
  it('создаёт 12 станций, отряды и отношения из сценария', () => {
    const s = game();
    expect(Object.keys(s.stations).length).toBe(12);
    expect(playerSquad(s).stationId).toBe('sokolniki');
    expect(relationStatus(s, PLAYER, 'krasnoselsk_commune')).toBe('war');
    expect(relationStatus(s, PLAYER, 'ring_trade_union')).toBe('neutral');
    expect(relationStatus(s, PLAYER, 'mutants')).toBe('war');
  });

  it('одинаковый сид — одинаковая партия', () => {
    expect(JSON.stringify(createNewGame(5).stations)).toBe(JSON.stringify(createNewGame(5).stations));
  });
});

describe('граф и туман', () => {
  it('соседи и кратчайший путь', () => {
    const s = game();
    expect(neighbors(s, 'sokolniki').map((n) => n.stationId).sort()).toEqual(['krasnoselskaya', 'preobrazhenskaya_ploshchad']);
    expect(findPath(s, 'sokolniki', 'komsomolskaya')).toEqual(['krasnoselskaya', 'komsomolskaya']);
  });

  it('видны свои станции и соседние', () => {
    const s = game();
    expect([...visibleStations(s, PLAYER)].sort()).toEqual(['krasnoselskaya', 'preobrazhenskaya_ploshchad', 'sokolniki']);
  });
});

describe('движение и захват', () => {
  it('нейтральная пустая станция захватывается сразу', () => {
    const s = game();
    const sq = playerSquad(s);
    sq.stationId = 'preobrazhenskaya_ploshchad';
    const r = moveSquad(s, sq.id, 'cherkizovskaya');
    expect(r.kind).toBe('captured');
    expect(s.stations.cherkizovskaya.ownerFactionId).toBe(PLAYER);
    expect(sq.movePoints).toBe(BALANCE.map.squadMovePoints - 1);
  });

  it('без очков движения ходить нельзя, после конца хода очки возвращаются', () => {
    const s = game();
    const sq = playerSquad(s);
    sq.movePoints = 0;
    expect(moveSquad(s, sq.id, 'preobrazhenskaya_ploshchad').kind).toBe('invalid');
    endTurn(s);
    expect(sq.movePoints).toBe(BALANCE.map.squadMovePoints);
  });

  it('вход на станцию врага начинает бой; победа — станция переходит игроку', () => {
    const s = game();
    makeStrong(s);
    const sq = playerSquad(s);
    const r = moveSquad(s, sq.id, 'krasnoselskaya');
    expect(r.kind).toBe('battle');
    expect(s.pendingBattle).not.toBeNull();
    // В бою участвует гарнизон станции и отряд коммуны
    const input = buildBattleInput(s, s.pendingBattle!);
    expect(input.sides[1].units.length + (input.sides[1].summoned?.length ?? 0)).toBe(7);
    const { outcome } = autoResolvePending(s);
    expect(outcome.winner).toBe(0);
    expect(s.stations.krasnoselskaya.ownerFactionId).toBe(PLAYER);
    expect(sq.stationId).toBe('krasnoselskaya');
    expect(s.factions[PLAYER].resources.ammo).toBeGreaterThan(200);
  });

  it('проигравший нападающий остаётся у исходной станции (или гибнет)', () => {
    const s = game();
    const sq = playerSquad(s);
    sq.units = [newUnit(s, 'militia')];
    moveSquad(s, sq.id, 'krasnoselskaya');
    autoResolvePending(s);
    expect(s.stations.krasnoselskaya.ownerFactionId).toBe('krasnoselsk_commune');
    const still = s.squads.find((q) => q.id === sq.id);
    if (still) expect(still.stationId).toBe('sokolniki');
  });

  it('нападение на нейтральную фракцию требует объявить войну', () => {
    const s = game();
    makeStrong(s);
    const sq = playerSquad(s);
    s.stations.krasnoselskaya.ownerFactionId = PLAYER;
    s.stations.krasnoselskaya.garrison = [];
    s.squads = s.squads.filter((q) => q.factionId === PLAYER);
    sq.stationId = 'krasnoselskaya';
    const r = moveSquad(s, sq.id, 'komsomolskaya');
    expect(r).toEqual({ kind: 'war_warning', factionId: 'ring_trade_union' });
    expect(sq.stationId).toBe('krasnoselskaya');
    const r2 = moveSquad(s, sq.id, 'komsomolskaya', { declareWar: true });
    expect(r2.kind).toBe('battle');
    expect(relationStatus(s, PLAYER, 'ring_trade_union')).toBe('war');
  });

  it('независимую станцию с жителями можно присоединить за патроны', () => {
    const s = game();
    const sq = playerSquad(s);
    const r = moveSquad(s, sq.id, 'preobrazhenskaya_ploshchad');
    expect(r.kind).toBe('neutral_choice');
    const ammo = s.factions[PLAYER].resources.ammo!;
    const r2 = moveSquad(s, sq.id, 'preobrazhenskaya_ploshchad', { neutralChoice: 'negotiate' });
    expect(r2.kind).toBe('captured');
    expect(s.factions[PLAYER].resources.ammo).toBe(ammo - 120);
    expect(s.stations.preobrazhenskaya_ploshchad.garrison.length).toBe(2); // ополчение переходит к игроку
  });

  it('захват силой портит отношения со всеми и ведёт к бою с ополчением', () => {
    const s = game();
    makeStrong(s);
    const sq = playerSquad(s);
    const before = getRelation(s, PLAYER, 'ring_trade_union');
    const r = moveSquad(s, sq.id, 'preobrazhenskaya_ploshchad', { neutralChoice: 'force' });
    expect(r.kind).toBe('battle');
    expect(getRelation(s, PLAYER, 'ring_trade_union')).toBeLessThan(before);
    autoResolvePending(s);
    expect(s.stations.preobrazhenskaya_ploshchad.ownerFactionId).toBe(PLAYER);
  });

  it('длинный тоннель проходится за несколько ходов', () => {
    const s = game();
    const sq = playerSquad(s);
    s.stations.chistye_prudy.ownerFactionId = PLAYER;
    s.stations.chistye_prudy.garrison = [];
    sq.stationId = 'chistye_prudy';
    sq.movePoints = 1;
    expect(moveSquad(s, sq.id, 'lubyanka').kind).toBe('in_tunnel');
    expect(sq.tunnelPos).toEqual({ from: 'chistye_prudy', to: 'lubyanka', progress: 1 });
    endTurn(s);
    expect(moveSquad(s, sq.id, 'lubyanka').kind).toBe('captured');
    expect(sq.stationId).toBe('lubyanka');
  });

  it('закрытая станция недоступна', () => {
    const s = game();
    const sq = playerSquad(s);
    sq.stationId = 'biblioteka_lenina';
    expect(moveSquad(s, sq.id, 'kropotkinskaya').kind).toBe('invalid');
  });

  it('в опасном тоннеле бывают засады мутантов', () => {
    let ambushes = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = createNewGame(seed);
      makeStrong(s);
      const sq = playerSquad(s);
      s.stations.cherkizovskaya.ownerFactionId = PLAYER;
      sq.stationId = 'cherkizovskaya';
      const r = moveSquad(s, sq.id, 'preobrazhenskaya_ploshchad', { neutralChoice: 'negotiate' });
      if (r.kind === 'battle' && r.battle.kind === 'ambush') {
        ambushes++;
        const { follow } = autoResolvePending(s);
        // Сильный отряд отбивается и доходит до станции
        expect(follow?.kind).toBe('captured');
        expect(sq.stationId).toBe('preobrazhenskaya_ploshchad');
      }
    }
    expect(ambushes).toBeGreaterThan(3);
  });

  it('стоянка на своей станции лечит', () => {
    const s = game();
    const sq = playerSquad(s);
    const u = sq.units[0];
    u.hp = 10;
    endTurn(s);
    expect(u.hp).toBeGreaterThan(10);
  });
});
