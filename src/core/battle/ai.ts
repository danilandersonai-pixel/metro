// Простой и предсказуемый ИИ боя (раздел 7.7 CLAUDE.md).
import { BALANCE, getAbility } from '../content';
import {
  aliveOf,
  applyAction,
  currentActor,
  getAbilityTargets,
  getAttackTargets,
  getHealTargets,
  getMoveSlots,
  hitChance,
  minExpectedDamage,
} from './engine';
import type { BattleAction, BattleState, Combatant, Side } from './types';

const AI = BALANCE.battleAi;

/** Насколько желанна цель: меньше — лучше. Доля HP минус бонус за приоритетные роли. */
function targetScore(target: Combatant): number {
  const priority = (AI.priorityAttackTypes as string[]).includes(target.attackType) ? AI.priorityTargetBonus : 0;
  return target.hp / target.maxHp - priority;
}

function bestBy<T>(items: T[], score: (item: T) => number): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const item of items) {
    const s = score(item);
    if (s < bestScore) {
      best = item;
      bestScore = s;
    }
  }
  return best;
}

/** Шеренга врага с наибольшим числом живых бойцов (для ударов по шеренге). */
function busiestRowTarget(state: BattleState, enemySide: Side): Combatant | null {
  const enemies = aliveOf(state, enemySide);
  const front = enemies.filter((e) => e.row === 0);
  const back = enemies.filter((e) => e.row === 1);
  const row = front.length >= back.length ? front : back;
  return row[0] ?? enemies[0] ?? null;
}

export function chooseAiAction(state: BattleState): BattleAction {
  const actor = currentActor(state);
  if (!actor) throw new Error('chooseAiAction: бой окончен');
  const enemySide = (1 - actor.side) as Side;
  const attackTargets = getAttackTargets(state, actor);

  // 1. Цель, которую можно убить этим ходом (одиночной атакой или атакующей способностью).
  const kills: { action: BattleAction; target: Combatant; chance: number }[] = [];
  if (actor.attackType !== 'area') {
    for (const t of attackTargets) {
      if (minExpectedDamage(state, actor, t) >= t.hp) {
        kills.push({ action: { type: 'attack', targetUid: t.uid }, target: t, chance: hitChance(state, actor, t) });
      }
    }
  }
  for (const abilityId of actor.abilities) {
    const ability = getAbility(abilityId);
    if (ability.target !== 'enemy' || !ability.damageMult) continue;
    for (const t of getAbilityTargets(state, actor, abilityId)) {
      if (minExpectedDamage(state, actor, t, ability.damageMult) >= t.hp) {
        kills.push({
          action: { type: 'ability', abilityId, targetUid: t.uid },
          target: t,
          chance: hitChance(state, actor, t, ability.accuracyBonus ?? 0),
        });
      }
    }
  }
  const kill = bestBy(kills, (k) => -k.chance + targetScore(k.target) * 0.01);
  if (kill) return kill.action;

  // 2. Лечение союзника ниже порога.
  const wounded = getHealTargets(state, actor).filter((c) => c.hp / c.maxHp < AI.healThreshold);
  const healTarget = bestBy(wounded, (c) => c.hp / c.maxHp);
  if (healTarget) return { type: 'heal', targetUid: healTarget.uid };

  // 4. Ближник в задней шеренге — шагнуть вперёд, если есть место.
  if (actor.attackType === 'melee' && actor.row === 1) {
    const slot = getMoveSlots(state, actor)[0];
    if (slot) return { type: 'move', row: slot.row, slot: slot.slot };
  }

  // Способности, если готовы.
  const abilityAction = chooseAbility(state, actor, enemySide);
  if (abilityAction) return abilityAction;

  // 3. Атака по самой слабой цели с приоритетом стрелков и медиков.
  if (actor.attackType === 'area') {
    const t = busiestRowTarget(state, enemySide);
    if (t) return { type: 'attack', targetUid: t.uid };
  }
  const target = bestBy(attackTargets, targetScore);
  if (target) return { type: 'attack', targetUid: target.uid };

  return { type: 'defend' };
}

function chooseAbility(state: BattleState, actor: Combatant, enemySide: Side): BattleAction | null {
  for (const abilityId of actor.abilities) {
    const ability = getAbility(abilityId);
    const targets = getAbilityTargets(state, actor, abilityId);
    if (targets.length === 0) continue;
    const effectId = ability.effect?.id;
    switch (ability.target) {
      case 'enemy': {
        const t = bestBy(targets, targetScore);
        if (t) return { type: 'ability', abilityId, targetUid: t.uid };
        break;
      }
      case 'enemy_row': {
        const t = busiestRowTarget(state, enemySide);
        if (t) return { type: 'ability', abilityId, targetUid: t.uid };
        break;
      }
      case 'all_enemies':
        return { type: 'ability', abilityId };
      case 'all_allies': {
        // Имеет смысл, если хотя бы двое союзников без этого эффекта.
        const without = targets.length && aliveOf(state, actor.side).filter((c) => !c.effects.some((e) => e.id === effectId));
        if (without && without.length >= 2) return { type: 'ability', abilityId };
        break;
      }
      case 'ally': {
        const candidates = targets.filter((c) => !c.effects.some((e) => e.id === effectId));
        // Укрытие/бафф — тому, кто в передней шеренге и сильнее всего ранен; иначе — себе.
        const t = bestBy(candidates, (c) => (c.row === 0 ? 0 : 1) + c.hp / c.maxHp);
        if (t) return { type: 'ability', abilityId, targetUid: t.uid };
        break;
      }
      case 'self':
        return { type: 'ability', abilityId };
    }
  }
  return null;
}

/** Ход ИИ для текущего бойца. */
export function aiStep(state: BattleState): void {
  applyAction(state, chooseAiAction(state));
}

/** Автобой: обе стороны ходят ИИ до конца боя. */
export function runAutoBattle(state: BattleState, maxSteps = 10000): void {
  let steps = 0;
  while (!state.result) {
    if (steps++ > maxSteps) throw new Error('runAutoBattle: бой не закончился');
    aiStep(state);
  }
}
