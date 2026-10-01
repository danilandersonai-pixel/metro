// Операции с наборами ресурсов.
import { RESOURCES, RESOURCE_IDS, resourceName } from '../content';
import type { Resources } from '../types';

export function addRes(target: Resources, add: Resources, mult = 1): void {
  for (const id of RESOURCE_IDS) {
    const v = add[id];
    if (v) target[id] = (target[id] ?? 0) + v * mult;
  }
}

export function scaleRes(res: Resources, mult: number): Resources {
  const out: Resources = {};
  for (const id of RESOURCE_IDS) {
    const v = res[id];
    if (v) out[id] = Math.round(v * mult);
  }
  return out;
}

export function canAfford(have: Resources, cost: Resources): boolean {
  return RESOURCE_IDS.every((id) => (have[id] ?? 0) >= (cost[id] ?? 0));
}

/** Списать ресурсы. Возвращает false и ничего не меняет, если не хватает. */
export function pay(have: Resources, cost: Resources): boolean {
  if (!canAfford(have, cost)) return false;
  addRes(have, cost, -1);
  return true;
}

export function formatRes(res: Resources): string {
  const parts = RESOURCE_IDS.filter((id) => res[id]).map((id) => `${resourceName(id)} ${res[id]}`);
  return parts.length ? parts.join(', ') : 'бесплатно';
}

/** Короткая запись: «Патр. 30, Еда 5». */
export function formatResShort(res: Resources): string {
  const parts = RESOURCES.filter((r) => res[r.id]).map((r) => `${r.short} ${res[r.id]}`);
  return parts.length ? parts.join(', ') : '—';
}
