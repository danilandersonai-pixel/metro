import Phaser from 'phaser';
import { BUILDINGS, getBuilding, getUnitType } from '../core/content';
import {
  canBuild,
  constructionInProgress,
  repairBuilding,
  repairCost,
  startConstruction,
} from '../core/economy/buildings';
import { formatRes, formatResShort } from '../core/economy/resources';
import { canHire, formSquad, hireableTypes, hireUnit, moveToGarrison, moveToSquad, squadsAt } from '../core/economy/units';
import type { GameState } from '../core/state';
import type { Station, Unit } from '../core/types';
import { maxHpOf } from '../core/units/stats';
import { requireState } from '../game/session';
import { Button } from '../ui/Button';
import { drawResourceBar } from '../ui/ResourceBar';
import { COLORS, TEXT, textStyle } from '../ui/theme';

export interface StationSceneData {
  stationId: string;
}

const COL = [16, 446, 876];
const COL_W = 400;
const TOP = 96;

/** Экран станции: здания и стройка, гарнизон и отряды, найм. */
export class StationScene extends Phaser.Scene {
  private state!: GameState;
  private stationId = '';
  private selectedSquadId: string | null = null;
  private root!: Phaser.GameObjects.Container;
  private infoText!: Phaser.GameObjects.Text;
  private errorText!: Phaser.GameObjects.Text;

  constructor() {
    super('StationScene');
  }

  init(data: StationSceneData): void {
    this.stationId = data?.stationId ?? '';
    this.selectedSquadId = null;
  }

  create(): void {
    this.state = requireState();
    if (!this.stationId) {
      const own = Object.values(this.state.stations).find((s) => s.ownerFactionId === this.state.playerFactionId);
      this.stationId = own?.id ?? '';
    }
    this.root = this.add.container(0, 0);
    this.infoText = this.add.text(16, this.scale.height - 66, '', { ...textStyle(14, TEXT.dim), wordWrap: { width: 900 } });
    this.errorText = this.add.text(16, this.scale.height - 40, '', textStyle(15, TEXT.bad));
    new Button(this, this.scale.width - 110, this.scale.height - 36, 'На карту', () => this.scene.start('MapScene'), 200, 48, 18);
    this.redraw();
  }

  private get station(): Station {
    return this.state.stations[this.stationId];
  }

  private redraw(): void {
    this.root.removeAll(true);
    if (!this.station) return;
    const st = this.station;

    this.root.add(this.add.rectangle(0, 0, this.scale.width, 40, COLORS.panel).setOrigin(0));
    drawResourceBar(this, this.root, this.state, 16, 11);
    this.root.add(this.add.text(16, 50, st.name, textStyle(26, TEXT.accent, true)));
    this.root.add(this.add.text(16 + 360, 58, `Население ${st.population}`, textStyle(16, TEXT.dim)));

    this.drawBuildings(COL[0], TOP);
    this.drawGarrison(COL[1], TOP);
    this.drawHire(COL[2], TOP);
  }

  private panel(x: number, y: number, title: string): void {
    this.root.add(this.add.rectangle(x, y, COL_W, this.scale.height - y - 80, COLORS.panel, 0.9).setOrigin(0).setStrokeStyle(1, COLORS.panelBorder));
    this.root.add(this.add.text(x + 12, y + 8, title, textStyle(18, TEXT.accent, true)));
  }

  private showError(err: string | null): void {
    this.errorText.setText(err ?? '');
    if (!err) this.redraw();
  }

  // ---------------- Здания ----------------

  private drawBuildings(x: number, y: number): void {
    this.panel(x, y, 'Здания');
    const st = this.station;
    const p = this.state.playerFactionId;
    let cy = y + 40;
    const busy = constructionInProgress(st);

    for (const b of st.buildings) {
      const def = getBuilding(b.typeId);
      const status = b.upgradeTo
        ? `улучшается до ${b.upgradeTo}, ${b.turnsLeft} х.`
        : b.turnsLeft > 0
          ? `строится, ${b.turnsLeft} х.`
          : b.damaged
            ? 'повреждено'
            : 'работает';
      const t = this.add.text(x + 12, cy, `${def.name} ${b.level > 1 ? `ур.${b.level}` : ''} — ${status}`, textStyle(14, b.damaged ? TEXT.bad : TEXT.main));
      this.root.add(t);
      t.setInteractive().on('pointerover', () => this.infoText.setText(def.description));
      if (b.damaged) {
        const btn = new Button(this, x + COL_W - 60, cy + 9, 'Чинить', () => this.showError(repairBuilding(this.state, st.id, b.typeId, p)), 100, 24, 12);
        btn.on('pointerover', () => this.infoText.setText(`Ремонт: ${formatRes(repairCost(b.typeId))}`));
        this.root.add(btn);
      } else if (b.turnsLeft <= 0 && b.level < def.maxLevel) {
        const check = canBuild(this.state, st.id, b.typeId, p);
        const btn = new Button(this, x + COL_W - 60, cy + 9, `Ур. ${b.level + 1}`, () => this.showError(startConstruction(this.state, st.id, b.typeId, p)), 100, 24, 12).setEnabled(check.ok);
        btn.on('pointerover', () => this.infoText.setText(`Улучшение: ${formatRes(check.cost)}${check.reason ? ` — ${check.reason}` : ''}`));
        this.root.add(btn);
      }
      cy += 28;
    }
    if (st.buildings.length === 0) {
      this.root.add(this.add.text(x + 12, cy, 'Пока ничего не построено', textStyle(14, TEXT.dim)));
      cy += 28;
    }

    cy += 8;
    this.root.add(this.add.text(x + 12, cy, busy ? 'Стройка идёт — новая начнётся после неё' : 'Построить:', textStyle(15, TEXT.accent)));
    cy += 26;
    for (const def of Object.values(BUILDINGS)) {
      if (st.buildings.some((b) => b.typeId === def.id)) continue;
      if ((def.requiresTags ?? []).some((tag) => !st.tags.includes(tag))) continue;
      const check = canBuild(this.state, st.id, def.id, p);
      const t = this.add.text(x + 12, cy + 2, def.name, textStyle(14, check.ok ? TEXT.main : TEXT.dim));
      t.setInteractive().on('pointerover', () => this.infoText.setText(`${def.description} Цена: ${formatRes(check.cost)}, ${def.buildTurns} х.`));
      this.root.add(t);
      const btn = new Button(this, x + COL_W - 60, cy + 10, 'Строить', () => this.showError(startConstruction(this.state, st.id, def.id, p)), 100, 24, 12).setEnabled(check.ok);
      btn.on('pointerover', () => this.infoText.setText(`${def.name}: ${formatRes(check.cost)}, ${def.buildTurns} х.${check.reason ? ` — ${check.reason}` : ''}`));
      this.root.add(btn);
      cy += 28;
    }
  }

  // ---------------- Гарнизон и отряды ----------------

  private unitRow(x: number, y: number, u: Unit, onClick: () => void, hint: string): void {
    const t = getUnitType(u.typeId);
    const max = maxHpOf(u);
    const bg = this.add.rectangle(x, y, COL_W - 24, 24, 0x22272e).setOrigin(0).setStrokeStyle(1, COLORS.panelBorder);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerup', onClick);
    bg.on('pointerover', () => this.infoText.setText(`${t.name}: урон ${t.damage}, броня ${t.armor}, инициатива ${t.initiative}. ${hint}`));
    this.root.add(bg);
    this.root.add(this.add.text(x + 8, y + 4, `${t.name} ур.${u.level}`, textStyle(13)));
    this.root.add(this.add.text(x + COL_W - 34, y + 4, `${u.hp}/${max}`, textStyle(13, u.hp < max ? TEXT.accent : TEXT.dim)).setOrigin(1, 0));
  }

  private drawGarrison(x: number, y: number): void {
    const st = this.station;
    const squads = squadsAt(this.state, st.id, this.state.playerFactionId);
    if (!this.selectedSquadId || !squads.some((s) => s.id === this.selectedSquadId)) this.selectedSquadId = squads[0]?.id ?? null;
    this.panel(x, y, `Гарнизон (${st.garrison.length})`);
    let cy = y + 40;
    for (const u of st.garrison) {
      this.unitRow(x + 12, cy, u, () => {
        if (this.selectedSquadId) this.showError(moveToSquad(this.state, st.id, u.uid, this.selectedSquadId));
        else {
          const r = formSquad(this.state, st.id, [u.uid]);
          this.showError(typeof r === 'string' ? r : null);
        }
      }, this.selectedSquadId ? 'Нажмите — в отряд.' : 'Нажмите — создать отряд.');
      cy += 28;
    }
    if (st.garrison.length === 0) {
      this.root.add(this.add.text(x + 12, cy, 'Пусто', textStyle(14, TEXT.dim)));
      cy += 28;
    }

    cy += 10;
    this.root.add(this.add.text(x + 12, cy, 'Отряды на станции:', textStyle(15, TEXT.accent)));
    cy += 26;
    if (squads.length === 0) {
      this.root.add(this.add.text(x + 12, cy, 'Нет. Нажмите на бойца гарнизона, чтобы создать отряд.', { ...textStyle(13, TEXT.dim), wordWrap: { width: COL_W - 24 } }));
      return;
    }
    // Вкладки отрядов
    let tx = x + 12;
    for (const sq of squads) {
      const b = new Button(this, tx + 60, cy + 12, `${sq.name} (${sq.units.length})`, () => {
        this.selectedSquadId = sq.id;
        this.redraw();
      }, 120, 26, 12).setPressed(sq.id === this.selectedSquadId);
      this.root.add(b);
      tx += 126;
    }
    if (st.garrison.length > 0) {
      const nb = new Button(this, tx + 50, cy + 12, '+ Новый', () => {
        const r = formSquad(this.state, st.id, [st.garrison[0].uid]);
        if (typeof r !== 'string') this.selectedSquadId = r.id;
        this.showError(typeof r === 'string' ? r : null);
      }, 100, 26, 12);
      this.root.add(nb);
    }
    cy += 34;
    const sq = squads.find((s) => s.id === this.selectedSquadId)!;
    for (const u of sq.units) {
      this.unitRow(x + 12, cy, u, () => this.showError(moveToGarrison(this.state, st.id, sq.id, u.uid)), 'Нажмите — в гарнизон.');
      cy += 28;
    }
  }

  // ---------------- Найм ----------------

  private drawHire(x: number, y: number): void {
    this.panel(x, y, 'Найм бойцов');
    const st = this.station;
    const p = this.state.playerFactionId;
    let cy = y + 40;
    for (const typeId of hireableTypes(p)) {
      const t = getUnitType(typeId);
      const check = canHire(this.state, st.id, typeId, p);
      const label = this.add.text(x + 12, cy + 2, t.name, textStyle(14, check.ok ? TEXT.main : TEXT.dim));
      label.setInteractive().on('pointerover', () =>
        this.infoText.setText(`${t.name}: здоровье ${t.hp}, урон ${t.damage}, броня ${t.armor}. Цена: ${formatRes(t.cost)}. Содержание в ход: ${formatRes(t.upkeep)}.`),
      );
      this.root.add(label);
      this.root.add(this.add.text(x + 140, cy + 4, formatResShort(t.cost), textStyle(12, TEXT.dim)));
      const btn = new Button(this, x + COL_W - 50, cy + 10, 'Нанять', () => this.showError(hireUnit(this.state, st.id, typeId, p)), 80, 24, 12).setEnabled(check.ok);
      btn.on('pointerover', () => this.infoText.setText(check.reason ?? `Нанять: ${formatRes(t.cost)}`));
      this.root.add(btn);
      cy += 30;
    }
  }
}
