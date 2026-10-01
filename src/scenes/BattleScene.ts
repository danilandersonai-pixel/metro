import Phaser from 'phaser';
import {
  aiStep,
  applyAction,
  canRetreat,
  collectOutcome,
  createBattle,
  currentActor,
  getAbilityTargets,
  getAttackTargets,
  getHealTargets,
  getMoveSlots,
  hitChance,
  isAbilityReady,
  type BattleAction,
  type BattleOutcome,
  type BattleState,
  type Combatant,
  type CreateBattleInput,
  type Side,
} from '../core/battle';
import { EFFECTS, getAbility } from '../core/content';
import type { Row } from '../core/types';
import { createUnit } from '../core/units/stats';
import presets from '../data/battle_presets.json';
import { Button } from '../ui/Button';
import { COLORS, TEXT, textStyle } from '../ui/theme';

/** Данные для запуска сцены боя. */
export interface BattleSceneData {
  battle?: CreateBattleInput;
  /** Фон боя (ключ из backgrounds) — пока только цвет. */
  background?: number;
  /** Вызывается по нажатию «Продолжить» после конца боя. */
  onFinish?: (outcome: BattleOutcome) => void;
  /** Куда вернуться после боя (по умолчанию — в меню). */
  returnScene?: string;
}

type Mode = { kind: 'basic' } | { kind: 'ability'; abilityId: string };

const AI_DELAY_MS = 450;
const AUTO_DELAY_MS = 120;
const LAYOUT = {
  queueY: 34,
  fieldTop: 100,
  fieldBottom: 560,
  // x-центры шеренг: [сторона][шеренга]
  rowX: [
    [380, 200],
    [900, 1080],
  ],
  cardW: 160,
  logX: 470,
  logW: 340,
  bottomY: 660,
};

export class BattleScene extends Phaser.Scene {
  private state!: BattleState;
  private data_!: BattleSceneData;
  private mode: Mode = { kind: 'basic' };
  private autoBattle = false;
  private aiTimer: Phaser.Time.TimerEvent | null = null;

  private fieldLayer!: Phaser.GameObjects.Container;
  private queueLayer!: Phaser.GameObjects.Container;
  private actionLayer!: Phaser.GameObjects.Container;
  private logText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private autoButton!: Button;

  constructor() {
    super('BattleScene');
  }

  init(data: BattleSceneData): void {
    this.data_ = data ?? {};
    this.mode = { kind: 'basic' };
    this.autoBattle = false;
    this.aiTimer = null;
  }

  create(): void {
    this.state = createBattle(this.data_.battle ?? demoBattle());
    this.cameras.main.setBackgroundColor(this.data_.background ?? 0x14171b);

    // Центральная панель лога
    this.add
      .rectangle(LAYOUT.logX, LAYOUT.fieldTop, LAYOUT.logW, LAYOUT.fieldBottom - LAYOUT.fieldTop, COLORS.panel, 0.85)
      .setOrigin(0)
      .setStrokeStyle(1, COLORS.panelBorder);
    this.logText = this.add
      .text(LAYOUT.logX + 10, LAYOUT.fieldTop + 8, '', {
        ...textStyle(13, TEXT.dim),
        wordWrap: { width: LAYOUT.logW - 20 },
        lineSpacing: 2,
      })
      .setOrigin(0);

    this.add.text(LAYOUT.rowX[0][1] - 80, LAYOUT.fieldTop - 26, this.state.sides[0].name, textStyle(16, TEXT.accent));
    this.add
      .text(LAYOUT.rowX[1][1] + 80, LAYOUT.fieldTop - 26, this.state.sides[1].name, textStyle(16, TEXT.accent))
      .setOrigin(1, 0);

    this.fieldLayer = this.add.container(0, 0);
    this.queueLayer = this.add.container(0, 0);
    this.actionLayer = this.add.container(0, 0);
    this.hintText = this.add.text(640, 590, '', textStyle(16, TEXT.main)).setOrigin(0.5);

    this.autoButton = new Button(this, 1180, LAYOUT.bottomY, 'Автобой: выкл', () => this.toggleAuto(), 170, 44, 16);

    this.refresh();
  }

  // -------------------------------------------------------------------------
  // Перерисовка
  // -------------------------------------------------------------------------

  private refresh(): void {
    this.drawQueue();
    this.drawField();
    this.drawActions();
    this.drawLog();
    this.scheduleAi();
  }

  private slotY(slot: number): { y: number; h: number } {
    const n = this.state.slotsPerRow;
    const total = LAYOUT.fieldBottom - LAYOUT.fieldTop;
    const step = total / n;
    return { y: LAYOUT.fieldTop + step * slot + step / 2, h: Math.min(120, step - 10) };
  }

  private drawField(): void {
    this.fieldLayer.removeAll(true);
    const actor = currentActor(this.state);
    const playerTurn = !!actor && this.isPlayerControlled(actor.side);
    const targets = playerTurn ? this.currentTargets(actor!) : new Set<string>();
    const moveSlots = playerTurn && this.mode.kind === 'basic' ? getMoveSlots(this.state, actor!) : [];

    // Пустые места: подсвечиваем те, куда можно перейти
    for (const side of [0, 1] as Side[]) {
      for (const row of [0, 1] as Row[]) {
        for (let slot = 0; slot < this.state.slotsPerRow; slot++) {
          const occupied = this.state.combatants.some(
            (c) => c.side === side && c.row === row && c.slot === slot && c.hp > 0,
          );
          if (occupied) continue;
          const { y, h } = this.slotY(slot);
          const x = LAYOUT.rowX[side][row];
          const canMove = side === actor?.side && moveSlots.some((s) => s.row === row && s.slot === slot);
          const rect = this.add
            .rectangle(x, y, LAYOUT.cardW, h, canMove ? COLORS.move : 0x000000, canMove ? 0.15 : 0.12)
            .setStrokeStyle(1, canMove ? COLORS.move : COLORS.panelBorder, canMove ? 0.9 : 0.4);
          if (canMove) {
            rect.setInteractive({ useHandCursor: true });
            rect.on('pointerup', () => this.playerAction({ type: 'move', row, slot }));
          }
          this.fieldLayer.add(rect);
        }
      }
    }

    for (const c of this.state.combatants) {
      if (c.hp <= 0) continue;
      this.fieldLayer.add(this.drawCard(c, c.uid === actor?.uid, targets.has(c.uid)));
    }
  }

  private drawCard(c: Combatant, isActor: boolean, isTarget: boolean): Phaser.GameObjects.Container {
    const { y, h } = this.slotY(c.slot);
    const x = LAYOUT.rowX[c.side][c.row];
    const w = LAYOUT.cardW;
    const compact = h < 90;
    const card = this.add.container(x, y);

    const sideColor = c.side === 0 ? COLORS.player : COLORS.enemy;
    const borderColor = isActor ? COLORS.highlight : isTarget ? this.targetColor(c) : sideColor;
    const bg = this.add
      .rectangle(0, 0, w, h, 0x22272e)
      .setStrokeStyle(isActor || isTarget ? 3 : 2, borderColor);
    card.add(bg);
    card.add(this.add.rectangle(-w / 2 + 4, 0, 6, h - 8, sideColor));

    card.add(this.add.text(-w / 2 + 12, -h / 2 + 6, c.name, textStyle(compact ? 12 : 15, TEXT.main, true)));
    if (!compact) {
      card.add(this.add.text(-w / 2 + 12, -h / 2 + 26, `ур. ${c.level}`, textStyle(12, TEXT.dim)));
    }

    // Полоска HP
    const ratio = c.hp / c.maxHp;
    const barW = w - 24;
    const barY = compact ? 4 : 8;
    card.add(this.add.rectangle(-w / 2 + 12, barY, barW, 8, 0x000000).setOrigin(0, 0.5));
    const hpColor = ratio > 0.6 ? COLORS.hpGood : ratio > 0.3 ? COLORS.hpMid : COLORS.hpLow;
    card.add(this.add.rectangle(-w / 2 + 12, barY, barW * ratio, 8, hpColor).setOrigin(0, 0.5));
    card.add(
      this.add.text(w / 2 - 10, barY - 22, `${c.hp}/${c.maxHp}`, textStyle(11, TEXT.dim)).setOrigin(1, 0),
    );

    // Эффекты и защита
    const tags: string[] = [];
    if (c.defending) tags.push('Защ');
    for (const e of c.effects) tags.push(EFFECTS[e.id].short + (e.stacks > 1 ? `×${e.stacks}` : ''));
    if (tags.length) {
      card.add(
        this.add.text(-w / 2 + 12, barY + 8, tags.join(' '), {
          ...textStyle(11, TEXT.accent),
          wordWrap: { width: w - 20 },
        }),
      );
    }

    // Шанс попадания по врагу при наведении
    if (isTarget) {
      const actor = currentActor(this.state);
      if (actor && c.side !== actor.side) {
        const bonus =
          this.mode.kind === 'ability' ? getAbility(this.mode.abilityId).accuracyBonus ?? 0 : 0;
        const chance = Math.round(hitChance(this.state, actor, c, bonus) * 100);
        card.add(this.add.text(w / 2 - 10, h / 2 - 18, `${chance}%`, textStyle(12, TEXT.accent)).setOrigin(1, 0));
      }
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerup', () => this.onTargetClick(c));
    }

    card.setData('uid', c.uid);
    return card;
  }

  private targetColor(c: Combatant): number {
    const actor = currentActor(this.state);
    return actor && c.side === actor.side ? COLORS.heal : COLORS.highlight;
  }

  private drawQueue(): void {
    this.queueLayer.removeAll(true);
    const s = this.state;
    const upcoming = s.queue.slice(s.turnIndex).map((uid) => s.combatants.find((c) => c.uid === uid)!);
    const alive = upcoming.filter((c) => c.hp > 0).slice(0, 12);
    this.queueLayer.add(this.add.text(16, LAYOUT.queueY - 9, `Раунд ${s.round}`, textStyle(16, TEXT.accent)));
    alive.forEach((c, i) => {
      const x = 110 + i * 96;
      const box = this.add
        .rectangle(x, LAYOUT.queueY, 90, 34, i === 0 ? 0x3a3320 : 0x22272e)
        .setOrigin(0, 0.5)
        .setStrokeStyle(2, c.side === 0 ? COLORS.player : COLORS.enemy);
      const label = this.add.text(x + 6, LAYOUT.queueY, c.name, {
        ...textStyle(11, TEXT.main),
        fixedWidth: 80,
      }).setOrigin(0, 0.5);
      this.queueLayer.add([box, label]);
    });
  }

  private drawActions(): void {
    this.actionLayer.removeAll(true);
    const actor = currentActor(this.state);

    if (this.state.result) {
      const won = this.state.result.winner === 0;
      this.hintText.setText(won ? 'Победа!' : 'Поражение').setColor(won ? TEXT.good : TEXT.bad);
      this.actionLayer.add(new Button(this, 640, LAYOUT.bottomY, 'Продолжить', () => this.finish(), 240, 48));
      return;
    }
    if (!actor) return;

    if (!this.isPlayerControlled(actor.side)) {
      this.hintText.setText(`Ходит: ${actor.name} (${this.state.sides[actor.side].name})`).setColor(TEXT.dim);
      return;
    }

    const hint =
      this.mode.kind === 'ability'
        ? `«${getAbility(this.mode.abilityId).name}»: выберите цель`
        : actor.attackType === 'melee' && actor.row === 1
          ? `${actor.name}: ближник бьёт только из передней шеренги — шагните вперёд`
          : `${actor.name}: выберите цель или действие`;
    this.hintText.setText(hint).setColor(TEXT.main);

    const buttons: Button[] = [];
    const w = 150;
    let x = 100;
    const add = (label: string, onClick: () => void, enabled = true, active = false) => {
      const b = new Button(this, x, LAYOUT.bottomY, label, onClick, w, 44, 15).setEnabled(enabled).setPressed(active);
      buttons.push(b);
      x += w + 10;
    };

    add('Атака', () => this.setMode({ kind: 'basic' }), true, this.mode.kind === 'basic');
    for (const abilityId of actor.abilities) {
      const ability = getAbility(abilityId);
      const cd = actor.cooldowns[abilityId] ?? 0;
      const ready = isAbilityReady(actor, abilityId) && getAbilityTargets(this.state, actor, abilityId).length > 0;
      const active = this.mode.kind === 'ability' && this.mode.abilityId === abilityId;
      add(cd > 0 ? `${ability.name} (${cd})` : ability.name, () => this.onAbilityButton(abilityId), ready, active);
    }
    add('Защита', () => this.playerAction({ type: 'defend' }));
    add('Ожидание', () => this.playerAction({ type: 'wait' }), !actor.waited);
    add('Отступить', () => this.playerAction({ type: 'retreat' }), canRetreat(this.state, actor));
    this.actionLayer.add(buttons);
  }

  private drawLog(): void {
    const lines = this.state.log.slice(-26).map((l) => l.text);
    this.logText.setText(lines.join('\n'));
  }

  // -------------------------------------------------------------------------
  // Ввод игрока
  // -------------------------------------------------------------------------

  private isPlayerControlled(side: Side): boolean {
    return !this.autoBattle && !this.state.sides[side].ai;
  }

  /** uid бойцов, по которым можно кликнуть в текущем режиме. */
  private currentTargets(actor: Combatant): Set<string> {
    if (this.mode.kind === 'ability') {
      return new Set(getAbilityTargets(this.state, actor, this.mode.abilityId).map((c) => c.uid));
    }
    return new Set([
      ...getAttackTargets(this.state, actor).map((c) => c.uid),
      ...getHealTargets(this.state, actor).map((c) => c.uid),
    ]);
  }

  private onTargetClick(target: Combatant): void {
    const actor = currentActor(this.state);
    if (!actor) return;
    if (this.mode.kind === 'ability') {
      this.playerAction({ type: 'ability', abilityId: this.mode.abilityId, targetUid: target.uid });
    } else if (target.side === actor.side) {
      this.playerAction({ type: 'heal', targetUid: target.uid });
    } else {
      this.playerAction({ type: 'attack', targetUid: target.uid });
    }
  }

  private onAbilityButton(abilityId: string): void {
    const target = getAbility(abilityId).target;
    // Способности без выбора цели применяются сразу.
    if (target === 'self' || target === 'all_allies' || target === 'all_enemies') {
      this.playerAction({ type: 'ability', abilityId });
    } else {
      this.setMode({ kind: 'ability', abilityId });
    }
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.refresh();
  }

  private playerAction(action: BattleAction): void {
    this.performAction(() => applyAction(this.state, action));
  }

  /** Выполнить действие, показать всплывающие цифры урона/лечения и перерисовать. */
  private performAction(run: () => void): void {
    const before = new Map(this.state.combatants.map((c) => [c.uid, c.hp]));
    try {
      run();
    } catch (err) {
      console.warn(err);
      return;
    }
    this.mode = { kind: 'basic' };
    for (const c of this.state.combatants) {
      const diff = c.hp - (before.get(c.uid) ?? c.hp);
      if (diff !== 0) this.floatText(c, diff);
    }
    this.refresh();
  }

  private floatText(c: Combatant, diff: number): void {
    const { y } = this.slotY(c.slot);
    const x = LAYOUT.rowX[c.side][c.row];
    const t = this.add
      .text(x, y - 20, diff > 0 ? `+${diff}` : `${diff}`, textStyle(22, diff > 0 ? TEXT.good : TEXT.bad, true))
      .setOrigin(0.5)
      .setDepth(10);
    this.tweens.add({ targets: t, y: y - 70, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  // -------------------------------------------------------------------------
  // ИИ и автобой
  // -------------------------------------------------------------------------

  private toggleAuto(): void {
    this.autoBattle = !this.autoBattle;
    this.autoButton.setText(`Автобой: ${this.autoBattle ? 'вкл' : 'выкл'}`).setPressed(this.autoBattle);
    this.mode = { kind: 'basic' };
    this.refresh();
  }

  private scheduleAi(): void {
    if (this.aiTimer || this.state.result) return;
    const actor = currentActor(this.state);
    if (!actor || this.isPlayerControlled(actor.side)) return;
    this.aiTimer = this.time.delayedCall(this.autoBattle ? AUTO_DELAY_MS : AI_DELAY_MS, () => {
      this.aiTimer = null;
      if (this.state.result) return;
      const a = currentActor(this.state);
      if (!a || this.isPlayerControlled(a.side)) return;
      this.performAction(() => aiStep(this.state));
    });
  }

  private finish(): void {
    const outcome = collectOutcome(this.state);
    this.data_.onFinish?.(outcome);
    this.scene.start(this.data_.returnScene ?? 'MenuScene');
  }
}

/** Тестовый бой из меню: отряд игрока против мутантов (составы — в battle_presets.json). */
function demoBattle(): CreateBattleInput {
  const build = (list: { type: string; row: number; slot: number }[], prefix: string) =>
    list.map((e, i) => {
      const u = createUnit(e.type, 1, `${prefix}${i}`);
      u.position = { row: e.row as Row, slot: e.slot };
      return u;
    });
  return {
    seed: Date.now() % 100000,
    sides: [
      { name: presets.demo.player.name, units: build(presets.demo.player.units, 'p') },
      { name: presets.demo.enemy.name, units: build(presets.demo.enemy.units, 'e'), ai: true, canRetreat: false },
    ],
  };
}
