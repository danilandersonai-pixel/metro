import Phaser from 'phaser';
import { SaveError } from '../core/save';
import { loadGame, startNewGame } from '../game/session';
import { AUTOSAVE_SLOT, hasAnySave, loadFromSlot, MANUAL_SLOTS, slotInfo } from '../game/storage';
import { createButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { TEXT, textStyle } from '../ui/theme';

// Главное меню.
export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    this.add.text(cx, height * 0.2, 'ТОННЕЛИ', textStyle(64, TEXT.accent, true)).setOrigin(0.5);
    this.add.text(cx, height * 0.2 + 56, 'пошаговая стратегия о выживании в метро', textStyle(18, TEXT.dim)).setOrigin(0.5);

    let y = height * 0.44;
    if (slotInfo(AUTOSAVE_SLOT)) {
      createButton(this, cx, y, 'Продолжить', () => this.loadSlot(AUTOSAVE_SLOT));
      y += 64;
    }
    createButton(this, cx, y, 'Новая игра', () => {
      startNewGame();
      this.scene.start('MapScene');
    });
    y += 64;
    if (hasAnySave()) {
      createButton(this, cx, y, 'Загрузить', () => this.showLoad());
      y += 64;
    }
    createButton(this, cx, y, 'Тестовый бой', () => this.scene.start('BattleScene'));

    // На телефоне — во весь экран по первому касанию (браузер разрешает это только после жеста).
    if (this.sys.game.device.input.touch && !this.scale.isFullscreen) {
      this.input.once('pointerup', () => {
        try {
          this.scale.startFullscreen();
        } catch {
          /* полноэкранный режим недоступен — играем как есть */
        }
      });
    }
  }

  private loadSlot(slot: string): void {
    try {
      const state = loadFromSlot(slot);
      if (!state) return;
      loadGame(state);
      this.scene.start('MapScene');
    } catch (e) {
      const text = e instanceof SaveError ? e.message : 'Не удалось загрузить сохранение';
      new Dialog(this, 'Ошибка', text, [{ label: 'Понятно' }]);
    }
  }

  private showLoad(): void {
    const slots = [AUTOSAVE_SLOT, ...MANUAL_SLOTS].filter((s) => slotInfo(s));
    new Dialog(
      this,
      'Загрузить игру',
      'Выберите сохранение.',
      [
        ...slots.map((slot) => {
          const info = slotInfo(slot)!;
          return { label: `${slot === AUTOSAVE_SLOT ? 'Авто' : `Слот ${slot}`}: ход ${info.turn}`, onClick: () => this.loadSlot(slot) };
        }),
        { label: 'Отмена' },
      ],
      760,
    );
  }
}
