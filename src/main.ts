import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { MapScene } from './scenes/MapScene';
import { StationScene } from './scenes/StationScene';
import { BattleScene } from './scenes/BattleScene';
import { QuestDialogScene } from './scenes/QuestDialogScene';

// Точка входа: создаём игру Phaser и регистрируем сцены.
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0d0f12',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  scene: [BootScene, MenuScene, MapScene, StationScene, BattleScene, QuestDialogScene],
});
