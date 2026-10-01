import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';

describe('Rng', () => {
  it('один и тот же сид даёт одинаковую последовательность', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('разные сиды дают разные последовательности', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('next() всегда в [0, 1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() покрывает обе границы и не выходит за них', () => {
    const rng = new Rng(123);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('состояние можно сохранить и восстановить', () => {
    const rng = new Rng(99);
    rng.next();
    const saved = rng.getState();
    const expected = [rng.next(), rng.next(), rng.next()];
    const restored = new Rng(0);
    restored.setState(saved);
    expect([restored.next(), restored.next(), restored.next()]).toEqual(expected);
  });

  it('shuffle() сохраняет элементы и не меняет исходный массив', () => {
    const rng = new Rng(5);
    const source = [1, 2, 3, 4, 5, 6];
    const shuffled = rng.shuffle(source);
    expect(source).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...shuffled].sort()).toEqual(source);
  });

  it('pick() на пустом массиве бросает ошибку', () => {
    expect(() => new Rng(1).pick([])).toThrow();
  });
});
