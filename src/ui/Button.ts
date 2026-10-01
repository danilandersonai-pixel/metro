import Phaser from 'phaser';
import { COLORS, textStyle } from './theme';

// Кнопка: прямоугольник + подпись. Поддерживает выключение и «нажатое» состояние.
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private enabled = true;
  private pressed = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    private onClick: () => void,
    width = 260,
    height = 48,
    fontSize = 20,
  ) {
    super(scene, x, y);
    this.bg = scene.add.rectangle(0, 0, width, height, COLORS.button).setStrokeStyle(2, COLORS.border);
    this.label = scene.add.text(0, 0, text, textStyle(fontSize)).setOrigin(0.5);
    this.add([this.bg, this.label]);
    this.setSize(width, height);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => this.enabled && !this.pressed && this.bg.setFillStyle(COLORS.buttonHover));
    this.on('pointerout', () => this.refresh());
    this.on('pointerup', () => this.enabled && this.onClick());
    scene.add.existing(this);
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    this.refresh();
    return this;
  }

  setPressed(pressed: boolean): this {
    this.pressed = pressed;
    this.refresh();
    return this;
  }

  setText(text: string): this {
    this.label.setText(text);
    return this;
  }

  private refresh(): void {
    this.bg.setFillStyle(!this.enabled ? COLORS.buttonDisabled : this.pressed ? COLORS.buttonActive : COLORS.button);
    this.label.setAlpha(this.enabled ? 1 : 0.4);
  }
}

/** Короткая запись для кнопок без состояния. */
export function createButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  width = 260,
  height = 48,
): Button {
  return new Button(scene, x, y, label, onClick, width, height);
}
