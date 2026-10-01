import { describe, expect, it } from 'vitest';
import {
  applyAction,
  collectOutcome,
  createBattle,
  currentActor,
  getAttackTargets,
  getAvailableActions,
  getCombatant,
  getMoveSlots,
  runAutoBattle,
  type BattleState,
} from '../src/core/battle';
import { BALANCE } from '../src/core/content';
import type { Row, Unit } from '../src/core/types';
import { createUnit } from '../src/core/units/stats';

function unit(typeId: string, uid: string, row: Row, slot: number, level = 1): Unit {
  const u = createUnit(typeId, level, uid);
  u.position = { row, slot };
  return u;
}

function battle(a: Unit[], b: Unit[], seed = 1): BattleState {
  return createBattle({ sides: [{ name: 'A', units: a }, { name: 'B', units: b }], seed });
}

/** Прокрутить ходы «Защитой», пока не придёт очередь нужного бойца. */
function skipUntil(state: BattleState, uid: string): void {
  let guard = 0;
  while (currentActor(state)?.uid !== uid) {
    if (guard++ > 100) throw new Error('не дождались хода');
    applyAction(state, { type: 'defend' });
  }
}

describe('очерёдность', () => {
  it('ходит сначала боец с большей инициативой', () => {
    // scout — 18, militia — 10, stormtrooper — 9
    const s = battle([unit('militia', 'a1', 0, 0), unit('scout', 'a2', 1, 0)], [unit('stormtrooper', 'b1', 0, 0)]);
    expect(s.queue).toEqual(['a2', 'a1', 'b1']);
    expect(currentActor(s)?.uid).toBe('a2');
  });

  it('ничья по инициативе решается броском и воспроизводится по сиду', () => {
    const make = (seed: number) =>
      battle([unit('militia', 'a1', 0, 0)], [unit('militia', 'b1', 0, 0)], seed).queue.join(',');
    expect(make(5)).toBe(make(5));
    const variants = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(make));
    expect(variants.size).toBe(2);
  });

  it('после хода всех начинается новый раунд', () => {
    const s = battle([unit('militia', 'a1', 0, 0)], [unit('militia', 'b1', 0, 0)]);
    expect(s.round).toBe(1);
    applyAction(s, { type: 'defend' });
    applyAction(s, { type: 'defend' });
    expect(s.round).toBe(2);
  });

  it('«Ожидание» переносит бойца в конец очереди, но только раз за раунд', () => {
    const s = battle([unit('scout', 'a1', 1, 0), unit('militia', 'a2', 0, 0)], [unit('militia', 'b1', 0, 0)]);
    expect(currentActor(s)?.uid).toBe('a1');
    applyAction(s, { type: 'wait' });
    expect(s.queue[s.queue.length - 1]).toBe('a1');
    expect(currentActor(s)?.uid).not.toBe('a1');
    skipUntil(s, 'a1');
    expect(s.round).toBe(1);
    expect(getAvailableActions(s).some((a) => a.type === 'wait')).toBe(false);
  });
});

describe('ближний бой', () => {
  it('ближник бьёт только переднюю шеренгу, пока она не пуста', () => {
    const s = battle(
      [unit('militia', 'a1', 0, 0)],
      [unit('militia', 'b1', 0, 0), unit('rifleman', 'b2', 1, 0)],
    );
    const a1 = getCombatant(s, 'a1');
    expect(getAttackTargets(s, a1).map((t) => t.uid)).toEqual(['b1']);
    getCombatant(s, 'b1').hp = 0;
    expect(getAttackTargets(s, a1).map((t) => t.uid)).toEqual(['b2']);
  });

  it('ближник из задней шеренги атаковать не может', () => {
    const s = battle([unit('militia', 'a1', 1, 0)], [unit('militia', 'b1', 0, 0)]);
    expect(getAttackTargets(s, getCombatant(s, 'a1'))).toEqual([]);
  });

  it('стрелок бьёт любую цель из любой шеренги', () => {
    const s = battle(
      [unit('rifleman', 'a1', 1, 0)],
      [unit('militia', 'b1', 0, 0), unit('rifleman', 'b2', 1, 0)],
    );
    expect(getAttackTargets(s, getCombatant(s, 'a1')).map((t) => t.uid).sort()).toEqual(['b1', 'b2']);
  });
});

describe('перемещение между шеренгами', () => {
  it('можно перейти только в соседнюю шеренгу на свободное место', () => {
    const s = battle(
      [unit('scout', 'a1', 1, 0), unit('militia', 'a2', 0, 0), unit('militia', 'a3', 0, 1)],
      [unit('militia', 'b1', 0, 0)],
    );
    const slots = getMoveSlots(s, getCombatant(s, 'a1'));
    expect(slots).toEqual([{ row: 0, slot: 2 }]);
    expect(() => applyAction(s, { type: 'move', row: 0, slot: 0 })).toThrow();
    applyAction(s, { type: 'move', row: 0, slot: 2 });
    expect(getCombatant(s, 'a1')).toMatchObject({ row: 0, slot: 2 });
  });

  it('если соседняя шеренга заполнена — перейти нельзя', () => {
    const s = battle(
      [unit('scout', 'a1', 1, 0), unit('militia', 'a2', 0, 0), unit('militia', 'a3', 0, 1), unit('militia', 'a4', 0, 2)],
      [unit('militia', 'b1', 0, 0)],
    );
    expect(getMoveSlots(s, getCombatant(s, 'a1'))).toEqual([]);
  });
});

describe('защита и урон', () => {
  it('защита снижает средний урон примерно вдвое', () => {
    const avg = (defend: boolean) => {
      let total = 0;
      let hits = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const s = battle([unit('scout', 'a1', 1, 0)], [unit('stormtrooper', 'b1', 0, 0)], seed);
        getCombatant(s, 'b1').defending = defend;
        const before = getCombatant(s, 'b1').hp;
        applyAction(s, { type: 'attack', targetUid: 'b1' });
        const lost = before - getCombatant(s, 'b1').hp;
        if (lost > 0) {
          total += lost;
          hits++;
        }
      }
      return total / hits;
    };
    const ratio = avg(true) / avg(false);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it('шанс попадания ограничен 5%..95%', async () => {
    const { hitChance } = await import('../src/core/battle');
    const s = battle([unit('scout', 'a1', 1, 0)], [unit('militia', 'b1', 0, 0)]);
    const a = getCombatant(s, 'a1');
    const b = getCombatant(s, 'b1');
    b.evasion = 5;
    expect(hitChance(s, a, b)).toBe(BALANCE.battle.hitChanceMin);
    b.evasion = -5;
    expect(hitChance(s, a, b)).toBe(BALANCE.battle.hitChanceMax);
  });

  it('площадная атака бьёт всю шеренгу цели', () => {
    let hitBoth = false;
    for (let seed = 1; seed <= 20 && !hitBoth; seed++) {
      const s = battle(
        [unit('grenadier', 'a1', 1, 0)],
        [unit('militia', 'b1', 0, 0), unit('militia', 'b2', 0, 1), unit('rifleman', 'b3', 1, 0)],
        seed,
      );
      skipUntil(s, 'a1');
      const full = getCombatant(s, 'b3').hp;
      applyAction(s, { type: 'attack', targetUid: 'b1' });
      expect(getCombatant(s, 'b3').hp).toBe(full);
      const b1 = getCombatant(s, 'b1');
      const b2 = getCombatant(s, 'b2');
      hitBoth = b1.hp < b1.maxHp && b2.hp < b2.maxHp;
    }
    expect(hitBoth).toBe(true);
  });

  it('лечение не поднимает HP выше максимума', () => {
    const s = battle([unit('medic', 'a1', 1, 0), unit('militia', 'a2', 0, 0)], [unit('militia', 'b1', 0, 0)]);
    skipUntil(s, 'a1');
    const a2 = getCombatant(s, 'a2');
    a2.hp = a2.maxHp - 3;
    applyAction(s, { type: 'heal', targetUid: 'a2' });
    expect(a2.hp).toBe(a2.maxHp);
  });
});

describe('эффекты', () => {
  it('кровотечение наносит урон в начале хода и истекает', () => {
    const s = battle([unit('militia', 'a1', 0, 0)], [unit('militia', 'b1', 0, 0)]);
    const b1 = getCombatant(s, 'b1');
    b1.effects.push({ id: 'bleeding', turns: 1, stacks: 2 });
    const before = b1.hp;
    skipUntil(s, 'b1');
    expect(b1.hp).toBe(before - 8); // 4 урона × 2 стака
    expect(b1.effects).toEqual([]);
  });

  it('оглушённый пропускает ход', () => {
    const s = battle([unit('scout', 'a1', 1, 0)], [unit('militia', 'b1', 0, 0)]);
    getCombatant(s, 'b1').effects.push({ id: 'stunned', turns: 1, stacks: 1 });
    applyAction(s, { type: 'defend' }); // ход a1 → b1 оглушён → снова a1 в новом раунде
    expect(currentActor(s)?.uid).toBe('a1');
    expect(s.round).toBe(2);
    expect(getCombatant(s, 'b1').effects).toEqual([]);
  });

  it('смерть от эффекта завершает бой', () => {
    const s = battle([unit('scout', 'a1', 1, 0)], [unit('rat_swarm', 'b1', 0, 0)]);
    const b1 = getCombatant(s, 'b1');
    b1.hp = 3;
    b1.effects.push({ id: 'burning', turns: 2, stacks: 1 });
    // Крыса быстрее не будет: у разведчика 18, у стаи 16 — ход a1, потом тик у b1
    applyAction(s, { type: 'defend' });
    expect(s.result?.winner).toBe(0);
  });
});

describe('конец боя', () => {
  it('победа, когда у врага не осталось живых', () => {
    const s = battle([unit('sniper', 'a1', 1, 0)], [unit('rat_swarm', 'b1', 0, 0)]);
    getCombatant(s, 'b1').hp = 1;
    let guard = 0;
    while (!s.result && guard++ < 50) {
      const actor = currentActor(s)!;
      if (actor.uid === 'a1') applyAction(s, { type: 'attack', targetUid: 'b1' });
      else applyAction(s, { type: 'defend' });
    }
    expect(s.result?.winner).toBe(0);
    expect(() => applyAction(s, { type: 'defend' })).toThrow();
  });

  it('отступление доступно только со 2-го раунда', () => {
    const s = battle([unit('militia', 'a1', 0, 0)], [unit('militia', 'b1', 0, 0)]);
    expect(getAvailableActions(s).some((a) => a.type === 'retreat')).toBe(false);
    applyAction(s, { type: 'defend' });
    applyAction(s, { type: 'defend' });
    expect(s.round).toBe(2);
    const side = currentActor(s)!.side;
    applyAction(s, { type: 'retreat' });
    expect(s.result).toMatchObject({ winner: 1 - side, retreatedSide: side });
  });

  it('итоги боя: погибшие удаляются, выжившие сохраняют HP', () => {
    const s = battle([unit('sniper', 'a1', 1, 0, 5)], [unit('rat_swarm', 'b1', 0, 0)], 3);
    runAutoBattle(s);
    const out = collectOutcome(s);
    const loser = (1 - out.winner) as 0 | 1;
    expect(out.sides[loser].survivors.length).toBe(0);
    expect(out.sides[out.winner].survivors.length).toBe(1);
    expect(out.loot.ammo).toBeGreaterThan(0);
  });
});

describe('автобой 6×6', () => {
  const squadA = () => [
    unit('stormtrooper', 'a1', 0, 0),
    unit('militia', 'a2', 0, 1),
    unit('stormtrooper', 'a3', 0, 2),
    unit('rifleman', 'a4', 1, 0),
    unit('medic', 'a5', 1, 1),
    unit('sniper', 'a6', 1, 2),
  ];
  const squadB = () => [
    unit('tunnel_crawler', 'b1', 0, 0),
    unit('night_hunter', 'b2', 0, 1),
    unit('rat_swarm', 'b3', 0, 2),
    unit('spitter', 'b4', 1, 0),
    unit('spitter', 'b5', 1, 1),
    unit('rat_swarm', 'b6', 1, 2),
  ];
  const run = (seed: number) => {
    const s = createBattle({
      sides: [
        { name: 'Люди', units: squadA(), ai: true },
        { name: 'Мутанты', units: squadB(), ai: true },
      ],
      seed,
    });
    runAutoBattle(s);
    return s;
  };

  it('заканчивается победой одной из сторон', () => {
    const s = run(42);
    expect(s.result).not.toBeNull();
    expect([0, 1]).toContain(s.result!.winner);
    expect(s.round).toBeLessThanOrEqual(BALANCE.battle.maxRounds);
  });

  it('с одинаковым сидом бой полностью повторяется', () => {
    expect(run(7).log).toEqual(run(7).log);
  });

  it('на разных сидах побеждают обе стороны хотя бы иногда (баланс не перекошен намертво)', () => {
    const winners = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) winners.add(run(seed).result!.winner!);
    expect(winners.size).toBe(2);
  });

  it('бой 12 на 12 расставляет по 6 мест в шеренге', () => {
    const many = (p: string, t: string) =>
      Array.from({ length: 12 }, (_, i) => unit(t, `${p}${i}`, (i < 6 ? 0 : 1) as Row, i % 6));
    const s = createBattle({
      sides: [
        { name: 'A', units: many('a', 'militia'), ai: true },
        { name: 'B', units: many('b', 'rifleman'), ai: true },
      ],
      seed: 1,
    });
    expect(s.slotsPerRow).toBe(BALANCE.battle.slotsPerRowLarge);
    expect(s.combatants.length).toBe(24);
    runAutoBattle(s);
    expect(s.result).not.toBeNull();
  });
});
