import Phaser from 'phaser';

// Загрузка ресурсов. Пока графики нет — сразу переходим в меню.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    this.scene.start('MenuScene');
  }
}
