import Phaser from 'phaser';
import { RESOURCES } from '../core/content';
import { forecastEconomy } from '../core/economy/turn';
import type { GameState } from '../core/state';
import { TEXT, textStyle } from './theme';

/** Строка ресурсов игрока с изменением за ход: «Патроны 200 (+10)». */
export function drawResourceBar(scene: Phaser.Scene, container: Phaser.GameObjects.Container, state: GameState, x: number, y: number): void {
  const res = state.factions[state.playerFactionId].resources;
  const net = forecastEconomy(state, state.playerFactionId).net;
  let cx = x;
  for (const r of RESOURCES) {
    const v = res[r.id] ?? 0;
    const d = net[r.id] ?? 0;
    const label = scene.add.text(cx, y, `${r.short} ${v}`, textStyle(15));
    container.add(label);
    cx += label.width + 3;
    if (d !== 0) {
      const delta = scene.add.text(cx, y + 1, d > 0 ? `+${d}` : `${d}`, textStyle(13, d > 0 ? TEXT.good : TEXT.bad));
      container.add(delta);
      cx += delta.width;
    }
    cx += 16;
  }
  const morale = state.factions[state.playerFactionId].morale;
  container.add(scene.add.text(cx, y, `Дух ${morale}`, textStyle(15, morale < 50 ? TEXT.bad : TEXT.main)));
}
