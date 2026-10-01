import Phaser from 'phaser';
import { Button } from './Button';
import { COLORS, TEXT, textStyle } from './theme';

export interface DialogButton {
  label: string;
  onClick?: () => void;
  enabled?: boolean;
}

/**
 * Модальное окно: затемнение, заголовок, текст и кнопки.
 * Любая кнопка закрывает окно, затем вызывает свой onClick.
 */
export class Dialog extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, title: string, body: string, buttons: DialogButton[], width = 560) {
    super(scene, 0, 0);
    const { width: sw, height: sh } = scene.scale;
    const overlay = scene.add.rectangle(0, 0, sw, sh, 0x000000, 0.6).setOrigin(0).setInteractive();
    this.add(overlay);

    const bodyText = scene.add.text(0, 0, body, {
      ...textStyle(17, TEXT.main),
      wordWrap: { width: width - 48 },
      lineSpacing: 4,
    });
    const btnH = 46;
    const height = 70 + bodyText.height + 30 + btnH + 24;
    const x = sw / 2;
    const y = sh / 2;
    this.add(scene.add.rectangle(x, y, width, height, COLORS.panel).setStrokeStyle(2, COLORS.border));
    this.add(scene.add.text(x, y - height / 2 + 22, title, textStyle(22, TEXT.accent, true)).setOrigin(0.5, 0));
    bodyText.setPosition(x - width / 2 + 24, y - height / 2 + 64);
    this.add(bodyText);

    const gap = 12;
    const bw = Math.min(220, (width - 48 - gap * (buttons.length - 1)) / buttons.length);
    const total = buttons.length * bw + (buttons.length - 1) * gap;
    buttons.forEach((b, i) => {
      const bx = x - total / 2 + bw / 2 + i * (bw + gap);
      const by = y + height / 2 - 24 - btnH / 2;
      const btn = new Button(scene, bx, by, b.label, () => {
        this.destroy();
        b.onClick?.();
      }, bw, btnH, 16);
      btn.setEnabled(b.enabled ?? true);
      this.add(btn);
    });
    this.setDepth(1000);
    scene.add.existing(this);
  }
}
