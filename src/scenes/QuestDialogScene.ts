import Phaser from 'phaser';
import { activeQuests, completedQuests, objectiveText, stageText } from '../core/quests/quests';
import { requireState } from '../game/session';
import { Button } from '../ui/Button';
import { COLORS, TEXT, textStyle } from '../ui/theme';

/** Журнал заданий: текущие задания с целями и список выполненных. */
export class QuestDialogScene extends Phaser.Scene {
  constructor() {
    super('QuestDialogScene');
  }

  create(): void {
    const state = requireState();
    const w = this.scale.width;
    this.add.text(16, 16, 'Журнал заданий', textStyle(28, TEXT.accent, true));
    this.add.rectangle(16, 64, w - 32, 560, COLORS.panel, 0.9).setOrigin(0).setStrokeStyle(1, COLORS.panelBorder);

    let y = 80;
    const line = (text: string, size: number, color: string, bold = false, indent = 0) => {
      const t = this.add.text(32 + indent, y, text, { ...textStyle(size, color, bold), wordWrap: { width: w - 80 - indent } });
      y += t.height + 6;
    };

    const active = activeQuests(state);
    if (active.length === 0) line('Активных заданий нет.', 16, TEXT.dim);
    for (const q of active) {
      line(q.title, 19, TEXT.accent, true);
      line(stageText(state, q.id), 14, TEXT.main, false, 12);
      const obj = objectiveText(state, q.id);
      if (obj) line(`Цель: ${obj}`, 15, TEXT.good, false, 12);
      y += 8;
    }

    const done = completedQuests(state);
    if (done.length) {
      y += 6;
      line('Выполнено:', 17, TEXT.accent);
      line(done.map((q) => q.title).join(' · '), 14, TEXT.dim, false, 12);
    }

    new Button(this, w - 110, this.scale.height - 36, 'На карту', () => this.scene.start('MapScene'), 200, 48, 18);
  }
}
