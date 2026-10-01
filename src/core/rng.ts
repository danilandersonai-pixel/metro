// Сидируемый генератор случайных чисел (mulberry32).
// Вся случайность в игре идёт только через него, чтобы бои воспроизводились в тестах.

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Текущее внутреннее состояние — для сохранения игры. */
  getState(): number {
    return this.state;
  }

  /** Восстановить состояние из сохранения. */
  setState(state: number): void {
    this.state = state >>> 0;
  }

  /** Число в диапазоне [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Целое число в диапазоне [min, max] включительно. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Дробное число в диапазоне [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** true с вероятностью p (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Случайный элемент массива. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: пустой массив');
    return items[this.int(0, items.length - 1)];
  }

  /** Перемешанная копия массива (Фишер–Йетс). */
  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}
