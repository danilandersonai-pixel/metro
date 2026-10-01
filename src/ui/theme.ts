// Цвета и шрифты интерфейса — в одном месте.
export const COLORS = {
  bg: 0x0d0f12,
  panel: 0x1b1f24,
  panelBorder: 0x3a424c,
  button: 0x2a2f36,
  buttonHover: 0x3b424b,
  buttonActive: 0x5a4a22,
  buttonDisabled: 0x1e2226,
  border: 0x6b7785,
  player: 0x3f7fbf,
  enemy: 0xb04a3a,
  neutral: 0x7a7a7a,
  hpGood: 0x4caf50,
  hpMid: 0xd9a441,
  hpLow: 0xc0392b,
  highlight: 0xffd54a,
  heal: 0x7ee08a,
  move: 0x6fb7ff,
};

export const TEXT = {
  main: '#e6e1d3',
  dim: '#8a929c',
  accent: '#d9a441',
  good: '#7ee08a',
  bad: '#ff7a6a',
};

export const FONT = 'sans-serif';

export function textStyle(size: number, color: string = TEXT.main, bold = false): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal' };
}
