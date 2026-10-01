// Движок пошагового боя: создание, очерёдность, действия, эффекты, конец боя.
// Чистая логика — никакого Phaser. Вся случайность — через state.rng.
import { BALANCE, EFFECTS, getAbility, getUnitType } from '../content';
import { Rng } from '../rng';
import type { AbilityDef, EffectApplication, Row, Unit } from '../types';
import { computeStats } from '../units/stats';
import type {
  BattleAction,
  BattleSide,
  BattleSideInput,
  BattleState,
  Combatant,
  Side,
} from './types';

const B = BALANCE.battle;

// ---------------------------------------------------------------------------
// Создание боя
// ---------------------------------------------------------------------------

export interface CreateBattleInput {
  sides: [BattleSideInput, BattleSideInput];
  seed: number;
}

export function createBattle(input: CreateBattleInput): BattleState {
  const rng = new Rng(input.seed);
  const sizes = input.sides.map((s) => s.units.length + (s.summoned?.length ?? 0));
  const maxNormal = B.rows * B.slotsPerRow;
  const slotsPerRow = Math.max(...sizes) > maxNormal ? B.slotsPerRowLarge : B.slotsPerRow;
  const capacity = B.rows * slotsPerRow;

  const combatants: Combatant[] = [];
  input.sides.forEach((sideInput, index) => {
    const side = index as Side;
    const all = [
      ...sideInput.units.map((u) => ({ unit: u, summoned: false })),
      ...(sideInput.summoned ?? []).map((u) => ({ unit: u, summoned: true })),
    ]
      .filter((e) => e.unit.hp > 0 && !(e.unit.downedTurns && e.unit.downedTurns > 0))
      .slice(0, capacity);
    const placed = placeUnits(
      all.map((e) => e.unit),
      slotsPerRow,
    );
    all.forEach((entry, i) => {
      combatants.push(makeCombatant(entry.unit, side, placed[i].row, placed[i].slot, entry.summoned));
    });
  });

  const sides = input.sides.map(
    (s): BattleSide => ({
      name: s.name,
      canRetreat: s.canRetreat ?? true,
      ai: s.ai ?? false,
      modifiers: s.modifiers ?? {},
    }),
  ) as [BattleSide, BattleSide];

  const state: BattleState = {
    sides,
    combatants,
    slotsPerRow,
    round: 0,
    queue: [],
    turnIndex: 0,
    log: [],
    result: null,
    rng,
  };

  log(state, `Бой: ${sides[0].name} против ${sides[1].name}`);
  applyOpeningStrikes(state);
  checkBattleEnd(state);
  if (!state.result) {
    startRound(state);
    activateCurrent(state);
  }
  return state;
}

function makeCombatant(unit: Unit, side: Side, row: Row, slot: number, summoned: boolean): Combatant {
  const type = getUnitType(unit.typeId);
  const stats = computeStats(unit.typeId, unit.level);
  return {
    uid: unit.uid,
    typeId: unit.typeId,
    name: type.name,
    side,
    row,
    slot,
    level: unit.level,
    hp: Math.min(unit.hp, stats.maxHp),
    maxHp: stats.maxHp,
    armor: stats.armor,
    damage: stats.damage,
    heal: stats.heal,
    accuracy: stats.accuracy,
    evasion: stats.evasion,
    initiative: stats.initiative,
    attackType: type.attackType,
    abilities: [...type.abilities],
    passives: [...type.passives],
    effects: unit.effects.map((e) => ({ ...e })),
    cooldowns: {},
    defending: false,
    waited: false,
    turnStarted: false,
    mercenary: !!type.mercenary,
    summoned,
    kills: 0,
    damageDealt: 0,
    source: unit,
  };
}

/**
 * Расстановка: сохраняем позиции юнитов, если они корректны и свободны,
 * остальных ставим в свободные места (ближников — вперёд, остальных — назад).
 */
export function placeUnits(units: Unit[], slotsPerRow: number): { row: Row; slot: number }[] {
  const taken = new Set<string>();
  const key = (row: number, slot: number) => `${row}:${slot}`;
  const result: ({ row: Row; slot: number } | null)[] = units.map((u) => {
    const { row, slot } = u.position;
    if ((row === 0 || row === 1) && slot >= 0 && slot < slotsPerRow && !taken.has(key(row, slot))) {
      taken.add(key(row, slot));
      return { row, slot };
    }
    return null;
  });
  units.forEach((u, i) => {
    if (result[i]) return;
    const preferred: Row = getUnitType(u.typeId).attackType === 'melee' ? 0 : 1;
    for (const row of [preferred, (1 - preferred) as Row]) {
      for (let slot = 0; slot < slotsPerRow; slot++) {
        if (!taken.has(key(row, slot))) {
          taken.add(key(row, slot));
          result[i] = { row, slot };
          return;
        }
      }
    }
    throw new Error('placeUnits: нет свободных мест');
  });
  return result as { row: Row; slot: number }[];
}

function applyOpeningStrikes(state: BattleState): void {
  state.sides.forEach((side, index) => {
    const strike = side.modifiers.openingStrike;
    if (!strike) return;
    const enemySide = (1 - index) as Side;
    for (let i = 0; i < strike.hits; i++) {
      const targets = aliveOf(state, enemySide);
      if (targets.length === 0) return;
      const target = state.rng.pick(targets);
      const dmg = Math.max(B.minDamage, Math.round(strike.damage * armorFactor(target.armor)));
      log(state, `Укрепления (${side.name}) бьют по ${target.name}: −${dmg}`);
      dealDamage(state, null, target, dmg);
    }
  });
}

// ---------------------------------------------------------------------------
// Вспомогательные запросы
// ---------------------------------------------------------------------------

export function getCombatant(state: BattleState, uid: string): Combatant {
  const c = state.combatants.find((x) => x.uid === uid);
  if (!c) throw new Error(`Нет бойца ${uid}`);
  return c;
}

export function isAlive(c: Combatant): boolean {
  return c.hp > 0;
}

export function aliveOf(state: BattleState, side: Side): Combatant[] {
  return state.combatants.filter((c) => c.side === side && isAlive(c));
}

export function currentActor(state: BattleState): Combatant | null {
  if (state.result) return null;
  const uid = state.queue[state.turnIndex];
  return uid ? getCombatant(state, uid) : null;
}

export function occupantAt(state: BattleState, side: Side, row: Row, slot: number): Combatant | null {
  return (
    state.combatants.find((c) => c.side === side && isAlive(c) && c.row === row && c.slot === slot) ??
    null
  );
}

function log(state: BattleState, text: string): void {
  state.log.push({ round: state.round, text });
}

function armorFactor(armor: number): number {
  return 1 - armor / (armor + B.armorConstant);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Сумма модификатора точности от эффектов бойца. */
function effectAccuracy(c: Combatant): number {
  return c.effects.reduce((sum, e) => sum + (EFFECTS[e.id].accuracy ?? 0), 0);
}

function effectDamageMult(c: Combatant): number {
  return c.effects.reduce((m, e) => m * (EFFECTS[e.id].damageMult ?? 1), 1);
}

function effectDamageTakenMult(c: Combatant): number {
  return c.effects.reduce((m, e) => m * (EFFECTS[e.id].damageTakenMult ?? 1), 1);
}

/** Аура: максимальная добавка точности от живых союзников с пассивкой. */
function auraAccuracy(state: BattleState, side: Side): number {
  let best = 0;
  for (const ally of aliveOf(state, side)) {
    for (const p of ally.passives) best = Math.max(best, getAbility(p).auraAccuracy ?? 0);
  }
  return best;
}

export function hitChance(
  state: BattleState,
  attacker: Combatant,
  target: Combatant,
  accuracyBonus = 0,
): number {
  const raw =
    B.baseHitBonus +
    attacker.accuracy +
    effectAccuracy(attacker) +
    auraAccuracy(state, attacker.side) +
    (state.sides[attacker.side].modifiers.accuracyBonus ?? 0) +
    accuracyBonus -
    target.evasion;
  return clamp(raw, B.hitChanceMin, B.hitChanceMax);
}

/** Множитель урона без случайности и крита (для расчётов ИИ и самой атаки). */
function damageMultiplier(state: BattleState, attacker: Combatant, target: Combatant, mult: number): number {
  let m = mult * armorFactor(target.armor) * effectDamageMult(attacker) * effectDamageTakenMult(target);
  if (target.defending) m *= B.defendDamageMultiplier;
  if (target.row === 0) m *= state.sides[target.side].modifiers.frontDamageTakenMult ?? 1;
  return m;
}

/** Минимально гарантированный урон при попадании (без крита). Нужен ИИ для поиска «добиваний». */
export function minExpectedDamage(
  state: BattleState,
  attacker: Combatant,
  target: Combatant,
  mult = 1,
): number {
  const base = attacker.damage * baseAttackMult(attacker) * mult;
  return Math.max(
    B.minDamage,
    Math.round(base * B.damageRandomMin * damageMultiplier(state, attacker, target, 1)),
  );
}

function baseAttackMult(attacker: Combatant): number {
  return attacker.attackType === 'support' ? B.supportAttackMultiplier : 1;
}

// ---------------------------------------------------------------------------
// Правила целей и ходов
// ---------------------------------------------------------------------------

/** Цели обычной атаки текущего бойца. Для area — по одной цели на шеренгу не нужно: любая цель задаёт шеренгу. */
export function getAttackTargets(state: BattleState, actor: Combatant): Combatant[] {
  return targetsByReach(state, actor, actor.attackType === 'melee' ? 'melee' : 'ranged');
}

function targetsByReach(state: BattleState, actor: Combatant, reach: 'melee' | 'ranged'): Combatant[] {
  const enemies = aliveOf(state, (1 - actor.side) as Side);
  if (reach === 'ranged') return enemies;
  // Ближний бой: только из передней шеренги и только по передней шеренге врага (если она не пуста).
  if (actor.row !== 0) return [];
  const front = enemies.filter((e) => e.row === 0);
  return front.length > 0 ? front : enemies;
}

/** Свободные места в соседней шеренге, куда можно перейти. */
export function getMoveSlots(state: BattleState, actor: Combatant): { row: Row; slot: number }[] {
  const row = (1 - actor.row) as Row;
  const slots: { row: Row; slot: number }[] = [];
  for (let slot = 0; slot < state.slotsPerRow; slot++) {
    if (!occupantAt(state, actor.side, row, slot)) slots.push({ row, slot });
  }
  return slots;
}

export function getHealTargets(state: BattleState, actor: Combatant): Combatant[] {
  if (actor.attackType !== 'support' || actor.heal <= 0) return [];
  return aliveOf(state, actor.side).filter((c) => c.hp < c.maxHp);
}

export function isAbilityReady(actor: Combatant, abilityId: string): boolean {
  return (actor.cooldowns[abilityId] ?? 0) <= 0;
}

/** Цели способности. Пустой массив — способность сейчас применить нельзя. */
export function getAbilityTargets(state: BattleState, actor: Combatant, abilityId: string): Combatant[] {
  const ability = getAbility(abilityId);
  if (ability.kind !== 'active' || !actor.abilities.includes(abilityId)) return [];
  if (!isAbilityReady(actor, abilityId)) return [];
  const enemySide = (1 - actor.side) as Side;
  switch (ability.target) {
    case 'enemy':
      return targetsByReach(state, actor, ability.reach ?? 'ranged');
    case 'enemy_row':
    case 'all_enemies':
      return aliveOf(state, enemySide);
    case 'ally':
      return aliveOf(state, actor.side);
    case 'all_allies':
    case 'self':
      return [actor];
    default:
      return [];
  }
}

export function canRetreat(state: BattleState, actor: Combatant): boolean {
  return state.sides[actor.side].canRetreat && state.round >= B.retreatFromRound;
}

/** Все допустимые действия текущего бойца. */
export function getAvailableActions(state: BattleState): BattleAction[] {
  const actor = currentActor(state);
  if (!actor) return [];
  const actions: BattleAction[] = [];
  for (const t of getAttackTargets(state, actor)) actions.push({ type: 'attack', targetUid: t.uid });
  for (const t of getHealTargets(state, actor)) actions.push({ type: 'heal', targetUid: t.uid });
  for (const abilityId of actor.abilities) {
    for (const t of getAbilityTargets(state, actor, abilityId)) {
      actions.push({ type: 'ability', abilityId, targetUid: t.uid });
    }
  }
  for (const s of getMoveSlots(state, actor)) actions.push({ type: 'move', row: s.row, slot: s.slot });
  actions.push({ type: 'defend' });
  if (!actor.waited) actions.push({ type: 'wait' });
  if (canRetreat(state, actor)) actions.push({ type: 'retreat' });
  return actions;
}

export function isActionValid(state: BattleState, action: BattleAction): boolean {
  const actor = currentActor(state);
  if (!actor) return false;
  switch (action.type) {
    case 'attack':
      return getAttackTargets(state, actor).some((t) => t.uid === action.targetUid);
    case 'heal':
      return getHealTargets(state, actor).some((t) => t.uid === action.targetUid);
    case 'ability': {
      const targets = getAbilityTargets(state, actor, action.abilityId);
      if (targets.length === 0) return false;
      const ability = getAbility(action.abilityId);
      if (ability.target === 'self' || ability.target === 'all_allies' || ability.target === 'all_enemies') {
        return true;
      }
      return targets.some((t) => t.uid === action.targetUid);
    }
    case 'move':
      return getMoveSlots(state, actor).some((s) => s.row === action.row && s.slot === action.slot);
    case 'defend':
      return true;
    case 'wait':
      return !actor.waited;
    case 'retreat':
      return canRetreat(state, actor);
  }
}

// ---------------------------------------------------------------------------
// Выполнение действий
// ---------------------------------------------------------------------------

/** Применить действие текущего бойца. Бросает ошибку, если действие недопустимо. */
export function applyAction(state: BattleState, action: BattleAction): void {
  if (state.result) throw new Error('Бой уже окончен');
  if (!isActionValid(state, action)) throw new Error(`Недопустимое действие: ${JSON.stringify(action)}`);
  const actor = currentActor(state)!;

  switch (action.type) {
    case 'attack':
      doAttack(state, actor, getCombatant(state, action.targetUid));
      break;
    case 'heal':
      doHeal(state, actor, getCombatant(state, action.targetUid), actor.heal);
      break;
    case 'ability':
      doAbility(state, actor, getAbility(action.abilityId), action.targetUid);
      break;
    case 'move':
      log(state, `${actor.name} переходит в ${action.row === 0 ? 'переднюю' : 'заднюю'} шеренгу`);
      actor.row = action.row;
      actor.slot = action.slot;
      break;
    case 'defend':
      actor.defending = true;
      log(state, `${actor.name} занимает оборону`);
      break;
    case 'wait':
      actor.waited = true;
      state.queue.splice(state.turnIndex, 1);
      state.queue.push(actor.uid);
      log(state, `${actor.name} ждёт`);
      activateCurrent(state);
      return;
    case 'retreat':
      doRetreat(state, actor.side);
      return;
  }

  checkBattleEnd(state);
  state.turnIndex++;
  activateCurrent(state);
}

function doAttack(state: BattleState, actor: Combatant, target: Combatant): void {
  const onHit = getUnitType(actor.typeId).onHitEffect;
  if (actor.attackType === 'area') {
    const row = target.row;
    const victims = aliveOf(state, target.side).filter((c) => c.row === row);
    log(state, `${actor.name} бьёт по ${row === 0 ? 'передней' : 'задней'} шеренге`);
    for (const v of victims) strike(state, actor, v, { mult: 1, effect: onHit });
  } else {
    strike(state, actor, target, { mult: baseAttackMult(actor), effect: onHit });
  }
}

interface StrikeOptions {
  mult: number;
  accuracyBonus?: number;
  effect?: EffectApplication;
}

/** Одиночный удар: бросок попадания, урон, крит, наложение эффекта. */
function strike(state: BattleState, attacker: Combatant, target: Combatant, opts: StrikeOptions): void {
  if (!isAlive(target)) return;
  const chance = hitChance(state, attacker, target, opts.accuracyBonus ?? 0);
  if (!state.rng.chance(chance)) {
    log(state, `${attacker.name} промахивается по ${target.name}`);
    return;
  }
  const random = state.rng.range(B.damageRandomMin, B.damageRandomMax);
  const crit = state.rng.chance(B.critChance);
  let dmg = attacker.damage * opts.mult * random * damageMultiplier(state, attacker, target, 1);
  if (crit) dmg *= B.critMultiplier;
  const final = Math.max(B.minDamage, Math.round(dmg));
  log(state, `${attacker.name} → ${target.name}: −${final}${crit ? ' (крит!)' : ''}`);
  dealDamage(state, attacker, target, final);
  if (opts.effect && isAlive(target) && state.rng.chance(opts.effect.chance)) {
    addEffect(state, target, opts.effect);
  }
}

function dealDamage(state: BattleState, attacker: Combatant | null, target: Combatant, amount: number): void {
  const dealt = Math.min(target.hp, amount);
  target.hp -= dealt;
  if (attacker) attacker.damageDealt += dealt;
  if (target.hp <= 0) {
    target.hp = 0;
    target.effects = [];
    if (attacker) attacker.kills++;
    log(state, `${target.name} выбывает из боя`);
  }
}

function doHeal(state: BattleState, actor: Combatant, target: Combatant, amount: number): void {
  const healed = Math.min(target.maxHp - target.hp, Math.round(amount));
  target.hp += healed;
  if (healed > 0) log(state, `${actor.name} лечит ${target.name}: +${healed}`);
}

export function addEffect(state: BattleState, target: Combatant, app: EffectApplication): void {
  const def = EFFECTS[app.id];
  const existing = target.effects.find((e) => e.id === app.id);
  if (existing) {
    existing.stacks = Math.min(def.maxStacks, existing.stacks + 1);
    existing.turns = Math.max(existing.turns, app.turns);
  } else {
    target.effects.push({ id: app.id, turns: app.turns, stacks: 1 });
  }
  log(state, `${target.name}: ${def.name.toLowerCase()}`);
}

function doAbility(state: BattleState, actor: Combatant, ability: AbilityDef, targetUid?: string): void {
  log(state, `${actor.name} применяет «${ability.name}»`);
  actor.cooldowns[ability.id] = ability.cooldown ?? 0;
  const enemySide = (1 - actor.side) as Side;
  let targets: Combatant[];
  switch (ability.target) {
    case 'enemy':
    case 'ally':
      targets = [getCombatant(state, targetUid!)];
      break;
    case 'enemy_row': {
      const row = getCombatant(state, targetUid!).row;
      targets = aliveOf(state, enemySide).filter((c) => c.row === row);
      break;
    }
    case 'all_enemies':
      targets = aliveOf(state, enemySide);
      break;
    case 'all_allies':
      targets = aliveOf(state, actor.side);
      break;
    default:
      targets = [actor];
  }

  const hostile = ability.target === 'enemy' || ability.target === 'enemy_row' || ability.target === 'all_enemies';
  for (const t of targets) {
    if (hostile) {
      strike(state, actor, t, {
        mult: ability.damageMult ?? 0,
        accuracyBonus: ability.accuracyBonus,
        effect: ability.effect,
      });
    } else {
      if (ability.heal) doHeal(state, actor, t, ability.heal);
      if (ability.effect && state.rng.chance(ability.effect.chance)) addEffect(state, t, ability.effect);
    }
  }
}

function doRetreat(state: BattleState, side: Side): void {
  log(state, `${state.sides[side].name} отступает!`);
  for (const c of aliveOf(state, side)) {
    if (state.rng.chance(B.retreatDamageChance)) {
      const dmg = Math.min(c.hp - 1, Math.round(c.maxHp * B.retreatDamageFraction));
      if (dmg > 0) {
        c.hp -= dmg;
        log(state, `${c.name} ранен при отступлении: −${dmg}`);
      }
    }
  }
  finish(state, (1 - side) as Side, side);
}

// ---------------------------------------------------------------------------
// Раунды и начало хода
// ---------------------------------------------------------------------------

function startRound(state: BattleState): void {
  state.round++;
  const alive = state.combatants.filter(isAlive);
  for (const c of alive) {
    c.waited = false;
    c.turnStarted = false;
  }
  // Сортировка по инициативе, ничья — случайный бросок.
  const keyed = alive.map((c) => ({ c, tie: state.rng.next() }));
  keyed.sort((a, b) => b.c.initiative - a.c.initiative || b.tie - a.tie);
  state.queue = keyed.map((k) => k.c.uid);
  state.turnIndex = 0;
  log(state, `— Раунд ${state.round} —`);
}

/** Пропускает мёртвых и оглушённых, обрабатывает начало хода, пока не найдёт бойца, который может действовать. */
function activateCurrent(state: BattleState): void {
  while (!state.result) {
    if (state.turnIndex >= state.queue.length) {
      if (state.round >= B.maxRounds) {
        log(state, 'Время вышло — защитники удержали позицию');
        finish(state, 1, null);
        return;
      }
      startRound(state);
      continue;
    }
    const actor = getCombatant(state, state.queue[state.turnIndex]);
    if (!isAlive(actor)) {
      state.turnIndex++;
      continue;
    }
    if (!actor.turnStarted) {
      actor.turnStarted = true;
      const skip = beginTurn(state, actor);
      checkBattleEnd(state);
      if (state.result) return;
      if (!isAlive(actor) || skip) {
        state.turnIndex++;
        continue;
      }
    }
    return;
  }
}

/** Начало хода бойца: снятие защиты, перезарядки, регенерация, тик эффектов. Возвращает true, если ход пропускается. */
function beginTurn(state: BattleState, actor: Combatant): boolean {
  actor.defending = false;
  for (const id of Object.keys(actor.cooldowns)) {
    actor.cooldowns[id] = Math.max(0, actor.cooldowns[id] - 1);
  }
  for (const p of actor.passives) {
    const regen = getAbility(p).regen ?? 0;
    if (regen > 0 && actor.hp < actor.maxHp) {
      actor.hp = Math.min(actor.maxHp, actor.hp + regen);
    }
  }
  let skip = false;
  for (const effect of [...actor.effects]) {
    const def = EFFECTS[effect.id];
    if (def.tickDamage) {
      const dmg = def.tickDamage * effect.stacks;
      log(state, `${actor.name}: ${def.name.toLowerCase()} −${dmg}`);
      dealDamage(state, null, actor, dmg);
      if (!isAlive(actor)) return true;
    }
    if (def.skipTurn) {
      skip = true;
      log(state, `${actor.name} пропускает ход (${def.name.toLowerCase()})`);
    }
    effect.turns--;
  }
  actor.effects = actor.effects.filter((e) => e.turns > 0);
  return skip;
}

export function checkBattleEnd(state: BattleState): void {
  if (state.result) return;
  const alive0 = aliveOf(state, 0).length;
  const alive1 = aliveOf(state, 1).length;
  if (alive0 === 0 && alive1 === 0) finish(state, 1, null);
  else if (alive1 === 0) finish(state, 0, null);
  else if (alive0 === 0) finish(state, 1, null);
}

function finish(state: BattleState, winner: Side, retreatedSide: Side | null): void {
  state.result = { winner, retreatedSide, rounds: state.round };
  log(state, `Победа: ${state.sides[winner].name}`);
}
