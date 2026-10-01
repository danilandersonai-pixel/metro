import Phaser from 'phaser';
import { createButton } from '../ui/Button';

// Заготовка сцены: заголовок, пояснение и кнопка «В меню».
// Настоящее содержимое появится на следующих этапах.
export abstract class PlaceholderScene extends Phaser.Scene {
  protected abstract readonly title: string;
  protected abstract readonly hint: string;

  create(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height * 0.35, this.title, {
        fontFamily: 'sans-serif',
        fontSize: '40px',
        color: '#e6e1d3',
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height * 0.35 + 50, this.hint, {
        fontFamily: 'sans-serif',
        fontSize: '18px',
        color: '#8a929c',
      })
      .setOrigin(0.5);
    createButton(this, width / 2, height * 0.7, 'В меню', () => this.scene.start('MenuScene'));
  }
}
