import Phaser from 'phaser';

// Простая текстовая кнопка: прямоугольник + подпись + подсветка при наведении.
export function createButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  width = 260,
  height = 48,
): Phaser.GameObjects.Container {
  const bg = scene.add
    .rectangle(0, 0, width, height, 0x2a2f36)
    .setStrokeStyle(2, 0x6b7785);
  const text = scene.add
    .text(0, 0, label, { fontFamily: 'sans-serif', fontSize: '20px', color: '#e6e1d3' })
    .setOrigin(0.5);

  const container = scene.add.container(x, y, [bg, text]);
  container.setSize(width, height);
  container.setInteractive({ useHandCursor: true });
  container.on('pointerover', () => bg.setFillStyle(0x3b424b));
  container.on('pointerout', () => bg.setFillStyle(0x2a2f36));
  container.on('pointerup', onClick);
  return container;
}
