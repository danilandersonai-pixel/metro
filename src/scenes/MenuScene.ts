import Phaser from 'phaser';
import { createButton } from '../ui/Button';
import { startNewGame } from '../game/session';

// Главное меню.
export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    this.add
      .text(cx, height * 0.22, 'ТОННЕЛИ', {
        fontFamily: 'sans-serif',
        fontSize: '56px',
        color: '#d9a441',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(cx, height * 0.22 + 52, 'пошаговая стратегия о выживании в метро', {
        fontFamily: 'sans-serif',
        fontSize: '18px',
        color: '#8a929c',
      })
      .setOrigin(0.5);

    const startY = height * 0.48;
    createButton(this, cx, startY, 'Новая игра', () => {
      startNewGame();
      this.scene.start('MapScene');
    });
    createButton(this, cx, startY + 64, 'Тестовый бой', () => this.scene.start('BattleScene'));
    createButton(this, cx, startY + 128, 'Станция', () => this.scene.start('StationScene'));
    createButton(this, cx, startY + 192, 'Диалог квеста', () =>
      this.scene.start('QuestDialogScene'),
    );
  }
}
