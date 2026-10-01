// Граф метро: соседи, тоннели, туман войны.
import type { GameState } from '../state';
import type { Tunnel } from '../types';

export function tunnelBetween(state: GameState, a: string, b: string): Tunnel | null {
  return state.tunnels.find((t) => (t.from === a && t.to === b) || (t.from === b && t.to === a)) ?? null;
}

export function neighbors(state: GameState, stationId: string): { stationId: string; tunnel: Tunnel }[] {
  const result: { stationId: string; tunnel: Tunnel }[] = [];
  for (const t of state.tunnels) {
    if (t.from === stationId) result.push({ stationId: t.to, tunnel: t });
    else if (t.to === stationId) result.push({ stationId: t.from, tunnel: t });
  }
  return result;
}

export function stationsOf(state: GameState, factionId: string): string[] {
  return Object.values(state.stations)
    .filter((s) => s.ownerFactionId === factionId)
    .map((s) => s.id);
}

/**
 * Видимые станции: свои, где стоят свои отряды, и соседние с ними на `range` тоннелей.
 * range увеличивает «Сигнальная система» (этап 5).
 */
export function visibleStations(state: GameState, factionId: string, range = 1): Set<string> {
  const seeds = new Set<string>(stationsOf(state, factionId));
  for (const sq of state.squads) {
    if (sq.factionId !== factionId) continue;
    if (sq.stationId) seeds.add(sq.stationId);
    if (sq.tunnelPos) {
      seeds.add(sq.tunnelPos.from);
      seeds.add(sq.tunnelPos.to);
    }
  }
  const visible = new Set(seeds);
  let frontier = [...seeds];
  for (let i = 0; i < range; i++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of neighbors(state, id)) {
        if (!visible.has(n.stationId)) {
          visible.add(n.stationId);
          next.push(n.stationId);
        }
      }
    }
    frontier = next;
  }
  return visible;
}

/** Кратчайший путь по длине тоннелей (Дейкстра). Возвращает список станций без стартовой. */
export function findPath(state: GameState, from: string, to: string, canPass?: (id: string) => boolean): string[] | null {
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([from]);
  while (open.size > 0) {
    let current = '';
    let best = Infinity;
    for (const id of open) {
      const d = dist.get(id)!;
      if (d < best) {
        best = d;
        current = id;
      }
    }
    open.delete(current);
    if (current === to) break;
    for (const n of neighbors(state, current)) {
      if (n.tunnel.blocked) continue;
      if (n.stationId !== to && canPass && !canPass(n.stationId)) continue;
      const nd = best + n.tunnel.length;
      if (nd < (dist.get(n.stationId) ?? Infinity)) {
        dist.set(n.stationId, nd);
        prev.set(n.stationId, current);
        open.add(n.stationId);
      }
    }
  }
  if (!dist.has(to)) return null;
  const path: string[] = [];
  let cur = to;
  while (cur !== from) {
    path.unshift(cur);
    cur = prev.get(cur)!;
  }
  return path;
}
