import Phaser from 'phaser';
import type { BattleOutcome } from '../core/battle';
import { getFaction, getUnitType, LINES } from '../core/content';
import { RELATION_NAMES, relationStatus } from '../core/factions/relations';
import { autoResolvePending } from '../core/map/autoresolve';
import { buildBattleInput } from '../core/map/battles';
import { tunnelBetween, visibleStations } from '../core/map/graph';
import {
  activeUnits,
  canMove,
  moveSquad,
  resolveBattle,
  type MoveOptions,
  type MoveResult,
} from '../core/map/movement';
import type { GameState } from '../core/state';
import { endTurn } from '../core/turn';
import type { Squad, Station, StationTag } from '../core/types';
import { maxHpOf } from '../core/units/stats';
import { requireState, session } from '../game/session';
import type { BattleSceneData } from './BattleScene';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { drawResourceBar } from '../ui/ResourceBar';
import { getBuilding, resourceName } from '../core/content';
import { COLORS, TEXT, textStyle } from '../ui/theme';

const TAG_NAMES: Record<StationTag, string> = {
  hub: 'пересадка',
  surface_exit: 'выход на поверхность',
  abandoned: 'заброшена',
  infested: 'логово мутантов',
};

const PANEL_X = 960;
const PANEL_W = 310;
const STATION_R = 14;

type Selection = { kind: 'none' } | { kind: 'station'; id: string } | { kind: 'squad'; id: string };

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

export class MapScene extends Phaser.Scene {
  private state!: GameState;
  private selection: Selection = { kind: 'none' };
  private world!: Phaser.GameObjects.Container;
  private ui!: Phaser.GameObjects.Container;
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;
  private panel!: Phaser.GameObjects.Container;
  private topBar!: Phaser.GameObjects.Container;
  private messagesText!: Phaser.GameObjects.Text;
  private dragging = false;

  constructor() {
    super('MapScene');
  }

  create(): void {
    this.state = requireState();
    this.selection = { kind: 'none' };
    this.world = this.add.container(0, 0);
    this.ui = this.add.container(0, 0);

    // Две камеры: основная — для карты (двигается и масштабируется), вторая — для интерфейса.
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.cameras.main.ignore(this.ui);
    this.uiCamera.ignore(this.world);
    this.setupCameraControls();

    this.buildUi();
    this.redraw();

    // Вернулись из боя — показать, что было дальше.
    const follow = session.followUp;
    session.followUp = null;
    if (follow) this.handleMoveResult(follow, null, {});
  }

  // -------------------------------------------------------------------------
  // Камера
  // -------------------------------------------------------------------------

  private setupCameraControls(): void {
    const cam = this.cameras.main;
    const xs = Object.values(this.state.stations).map((s) => s.x);
    const ys = Object.values(this.state.stations).map((s) => s.y);
    const pad = 200;
    cam.setBounds(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2 + PANEL_W, Math.max(...ys) - Math.min(...ys) + pad * 2);
    const own = Object.values(this.state.stations).find((s) => s.ownerFactionId === this.state.playerFactionId);
    if (own) cam.centerOn(own.x + PANEL_W / 2, own.y);

    let start: { x: number; y: number; sx: number; sy: number } | null = null;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      start = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY };
      this.dragging = false;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!start || !p.isDown) return;
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 8) this.dragging = true;
      if (this.dragging) cam.setScroll(start.sx - dx / cam.zoom, start.sy - dy / cam.zoom);
    });
    this.input.on('pointerup', () => {
      start = null;
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.4, 2.5));
    });
  }

  // -------------------------------------------------------------------------
  // Интерфейс
  // -------------------------------------------------------------------------

  private addUi<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.ui.add(obj);
    return obj;
  }

  private buildUi(): void {
    this.addUi(this.add.rectangle(0, 0, this.scale.width, 44, COLORS.panel, 0.95).setOrigin(0));
    this.topBar = this.addUi(this.add.container(0, 0));
    this.addUi(
      this.add.rectangle(PANEL_X, 44, PANEL_W + 20, this.scale.height - 44, COLORS.panel, 0.92).setOrigin(0).setStrokeStyle(1, COLORS.panelBorder),
    );
    this.panel = this.addUi(this.add.container(PANEL_X + 12, 56));
    this.addUi(this.add.rectangle(0, this.scale.height - 100, PANEL_X, 100, COLORS.panel, 0.85).setOrigin(0));
    this.messagesText = this.addUi(
      this.add.text(12, this.scale.height - 92, '', { ...textStyle(13, TEXT.dim), wordWrap: { width: PANEL_X - 30 }, lineSpacing: 2 }),
    );
    this.addUi(new Button(this, PANEL_X + PANEL_W / 2 + 4, this.scale.height - 36, 'Конец хода', () => this.onEndTurn(), PANEL_W - 10, 48, 20));
    this.addUi(new Button(this, 60, 22, 'Меню', () => this.scene.start('MenuScene'), 100, 32, 15));
  }

  private redraw(): void {
    this.drawWorld();
    this.drawTopBar();
    this.drawPanel();
    const msgs = this.state.messages.slice(-4).map((m) => `[${m.turn}] ${m.text}`);
    this.messagesText.setText(msgs.join('\n'));
  }

  private drawTopBar(): void {
    this.topBar.removeAll(true);
    this.topBar.add(this.add.text(126, 12, `Ход ${this.state.turn}`, textStyle(18, TEXT.accent, true)));
    drawResourceBar(this, this.topBar, this.state, 210, 13);
  }

  // -------------------------------------------------------------------------
  // Карта
  // -------------------------------------------------------------------------

  private drawWorld(): void {
    this.world.removeAll(true);
    const visible = visibleStations(this.state, this.state.playerFactionId);
    const selectedSquad = this.selection.kind === 'squad' ? this.state.squads.find((s) => s.id === (this.selection as { id: string }).id) : null;

    // Тоннели
    const g = this.add.graphics();
    this.world.add(g);
    for (const t of this.state.tunnels) {
      const a = this.state.stations[t.from];
      const b = this.state.stations[t.to];
      const line = a.lineIds.find((l) => b.lineIds.includes(l));
      const color = line ? hexToNumber(LINES[line].color) : 0x888888;
      g.lineStyle(line ? 7 : 4, color, t.blocked ? 0.25 : 0.85);
      g.lineBetween(a.x, a.y, b.x, b.y);
      if (t.danger > 0 && (visible.has(t.from) || visible.has(t.to))) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        this.world.add(this.add.text(mx - 6, my - 26, '!'.repeat(t.danger), textStyle(14, TEXT.bad, true)).setOrigin(1, 0));
      }
      if (t.length > 1) {
        this.world.add(this.add.text((a.x + b.x) / 2 - 18, (a.y + b.y) / 2 + 4, `${t.length}`, textStyle(12, TEXT.dim)));
      }
    }

    // Станции
    for (const st of Object.values(this.state.stations)) {
      const isVisible = visible.has(st.id);
      const reachable = !!selectedSquad && canMove(this.state, selectedSquad, st.id);
      this.drawStation(st, isVisible, reachable);
    }

    // Отряды
    const byPlace = new Map<string, Squad[]>();
    for (const sq of this.state.squads) {
      const key = sq.stationId ?? `${sq.tunnelPos!.from}>${sq.tunnelPos!.to}>${sq.tunnelPos!.progress}`;
      const seen = sq.stationId ? visible.has(sq.stationId) : visible.has(sq.tunnelPos!.from) || visible.has(sq.tunnelPos!.to);
      if (!seen) continue;
      if (!byPlace.has(key)) byPlace.set(key, []);
      byPlace.get(key)!.push(sq);
    }
    for (const squads of byPlace.values()) {
      squads.forEach((sq, i) => this.drawSquad(sq, i));
    }
  }

  private drawStation(st: Station, isVisible: boolean, reachable: boolean): void {
    const selected = this.selection.kind === 'station' && this.selection.id === st.id;
    const fill = !isVisible
      ? 0x2a2e33
      : st.ownerFactionId
        ? hexToNumber(getFaction(st.ownerFactionId).color)
        : COLORS.neutral;
    const circle = this.add.circle(st.x, st.y, STATION_R, fill).setStrokeStyle(selected ? 4 : 2, selected ? 0xffffff : 0x111111);
    if (!st.unlocked) circle.setAlpha(0.4);
    this.world.add(circle);
    if (reachable) {
      this.world.add(this.add.circle(st.x, st.y, STATION_R + 7).setStrokeStyle(3, COLORS.highlight));
    }
    if (isVisible && st.tags.includes('hub')) {
      this.world.add(this.add.circle(st.x, st.y, 5, 0xffffff));
    }
    const label = this.add
      .text(st.x, st.y + STATION_R + 4, st.unlocked ? st.name : `${st.name} (закрыта)`, textStyle(13, isVisible ? TEXT.main : TEXT.dim))
      .setOrigin(0.5, 0);
    this.world.add(label);

    circle.setInteractive(new Phaser.Geom.Circle(STATION_R, STATION_R, STATION_R + 8), Phaser.Geom.Circle.Contains);
    circle.on('pointerup', () => {
      if (this.dragging) return;
      this.onStationClick(st.id);
    });
  }

  private squadPosition(sq: Squad): { x: number; y: number } {
    if (sq.stationId) {
      const st = this.state.stations[sq.stationId];
      return { x: st.x, y: st.y };
    }
    const tp = sq.tunnelPos!;
    const a = this.state.stations[tp.from];
    const b = this.state.stations[tp.to];
    const len = tunnelBetween(this.state, tp.from, tp.to)!.length;
    const k = tp.progress / len;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }

  private drawSquad(sq: Squad, index: number): void {
    const pos = this.squadPosition(sq);
    const x = pos.x - 34 - index * 30;
    const y = pos.y - 20;
    const selected = this.selection.kind === 'squad' && this.selection.id === sq.id;
    const color = hexToNumber(getFaction(sq.factionId).color);
    const box = this.add.rectangle(x, y, 26, 22, color).setStrokeStyle(selected ? 3 : 1, selected ? 0xffffff : 0x000000);
    const label = this.add.text(x, y, `${sq.units.length}`, textStyle(13, '#ffffff', true)).setOrigin(0.5);
    this.world.add([box, label]);
    if (sq.factionId === this.state.playerFactionId && sq.movePoints > 0) {
      this.world.add(this.add.circle(x + 12, y - 10, 4, COLORS.hpGood));
    }
    box.setInteractive({ useHandCursor: true });
    box.on('pointerup', () => {
      if (this.dragging) return;
      this.onSquadClick(sq.id);
    });
  }

  // -------------------------------------------------------------------------
  // Панель справа
  // -------------------------------------------------------------------------

  private drawPanel(): void {
    this.panel.removeAll(true);
    const w = PANEL_W - 14;
    let y = 0;
    const line = (text: string, size = 14, color: string = TEXT.main, bold = false) => {
      const t = this.add.text(0, y, text, { ...textStyle(size, color, bold), wordWrap: { width: w } });
      this.panel.add(t);
      y += t.height + 4;
    };

    if (this.selection.kind === 'none') {
      line('Карта метро', 20, TEXT.accent, true);
      line('Нажмите на свой отряд (цветной квадрат с числом бойцов), затем на подсвеченную соседнюю станцию, чтобы пойти туда.', 14, TEXT.dim);
      line('Нажмите на станцию, чтобы узнать о ней.', 14, TEXT.dim);
      line('Карту можно двигать мышью и масштабировать колесом.', 14, TEXT.dim);
      y += 8;
      line('Ваши отряды:', 16, TEXT.accent);
      for (const sq of this.state.squads.filter((s) => s.factionId === this.state.playerFactionId)) {
        const where = sq.stationId ? this.state.stations[sq.stationId].name : 'в тоннеле';
        const b = new Button(this, w / 2, y + 18, `${sq.name} — ${where}`, () => this.onSquadClick(sq.id), w, 34, 13);
        this.panel.add(b);
        y += 40;
      }
      return;
    }

    if (this.selection.kind === 'squad') {
      const sq = this.state.squads.find((s) => s.id === (this.selection as { id: string }).id);
      if (!sq) {
        this.selection = { kind: 'none' };
        this.drawPanel();
        return;
      }
      const mine = sq.factionId === this.state.playerFactionId;
      line(sq.name, 20, TEXT.accent, true);
      line(getFaction(sq.factionId).name, 14, TEXT.dim);
      if (mine) line(`Очки движения: ${sq.movePoints}`, 14);
      line(sq.stationId ? `Станция: ${this.state.stations[sq.stationId].name}` : 'В тоннеле', 14);
      y += 6;
      for (const u of sq.units) {
        const t = getUnitType(u.typeId);
        const downed = u.downedTurns && u.downedTurns > 0 ? ` (выбыл на ${u.downedTurns} х.)` : '';
        line(`${t.name} ур.${u.level} — ${u.hp}/${maxHpOf(u)}${downed}`, 13, downed ? TEXT.dim : TEXT.main);
      }
      if (mine) {
        y += 6;
        line(sq.movePoints > 0 ? 'Нажмите на подсвеченную станцию, чтобы пойти.' : 'Очки движения кончились — завершите ход.', 13, TEXT.dim);
      }
      return;
    }

    const st = this.state.stations[this.selection.id];
    const visible = visibleStations(this.state, this.state.playerFactionId).has(st.id);
    line(st.name, 20, TEXT.accent, true);
    if (!st.unlocked) line('Станция закрыта — путь откроется по ходу сюжета.', 13, TEXT.dim);
    if (!visible) {
      line('Неизвестно, что там. Подойдите ближе.', 14, TEXT.dim);
      return;
    }
    if (st.ownerFactionId) {
      const f = getFaction(st.ownerFactionId);
      const isPlayer = st.ownerFactionId === this.state.playerFactionId;
      line(`Владелец: ${f.name}`, 14);
      if (!isPlayer) line(`Отношения: ${RELATION_NAMES[relationStatus(this.state, this.state.playerFactionId, f.id)]}`, 14);
    } else {
      line(st.population > 0 ? 'Независимая станция' : 'Ничья станция', 14);
    }
    line(`Население: ${st.population}`, 14);
    if (st.tags.length) line(`Особенности: ${st.tags.map((t) => TAG_NAMES[t]).join(', ')}`, 13, TEXT.dim);
    if (st.buildings.length) {
      line(`Здания: ${st.buildings.map((b) => getBuilding(b.typeId).name + (b.level > 1 ? ` ${b.level}` : '') + (b.turnsLeft > 0 ? ' (стр.)' : b.damaged ? ' (повр.)' : '')).join(', ')}`, 13);
    }
    if (st.ownerFactionId === this.state.playerFactionId) {
      y += 4;
      this.panel.add(new Button(this, w / 2, y + 20, 'Управлять станцией', () => this.scene.start('StationScene', { stationId: st.id }), w, 40, 16));
      y += 48;
    }
    y += 6;
    line(`Гарнизон: ${st.garrison.length ? '' : 'нет'}`, 14, TEXT.accent);
    const counts = new Map<string, number>();
    for (const u of st.garrison) counts.set(getUnitType(u.typeId).name, (counts.get(getUnitType(u.typeId).name) ?? 0) + 1);
    for (const [name, n] of counts) line(`  ${name} ×${n}`, 13);
    const squadsHere = this.state.squads.filter((s) => s.stationId === st.id);
    if (squadsHere.length) {
      y += 4;
      line('Отряды:', 14, TEXT.accent);
      for (const sq of squadsHere) line(`  ${sq.name} (${getFaction(sq.factionId).name}), ${sq.units.length} бойц.`, 13);
    }
  }

  // -------------------------------------------------------------------------
  // Действия игрока
  // -------------------------------------------------------------------------

  private onSquadClick(squadId: string): void {
    this.selection = { kind: 'squad', id: squadId };
    this.redraw();
  }

  private onStationClick(stationId: string): void {
    if (this.selection.kind === 'squad') {
      const sq = this.state.squads.find((s) => s.id === (this.selection as { id: string }).id);
      if (sq && sq.factionId === this.state.playerFactionId && canMove(this.state, sq, stationId)) {
        this.tryMove(sq.id, stationId, {});
        return;
      }
    }
    this.selection = { kind: 'station', id: stationId };
    this.redraw();
  }

  private tryMove(squadId: string, stationId: string, opts: MoveOptions): void {
    const result = moveSquad(this.state, squadId, stationId, opts);
    this.handleMoveResult(result, { squadId, stationId }, opts);
  }

  private handleMoveResult(result: MoveResult, move: { squadId: string; stationId: string } | null, opts: MoveOptions): void {
    this.redraw();
    switch (result.kind) {
      case 'invalid':
        this.addUi(new Dialog(this, 'Нельзя', result.reason, [{ label: 'Понятно' }]));
        break;
      case 'war_warning': {
        if (!move) break;
        const f = getFaction(result.factionId);
        this.addUi(
          new Dialog(this, 'Объявить войну?', `Станция под защитой фракции «${f.name}». Нападение означает войну с ней. Все узнают об этом.`, [
            { label: 'Напасть', onClick: () => this.tryMove(move.squadId, move.stationId, { ...opts, declareWar: true }) },
            { label: 'Отмена' },
          ]),
        );
        break;
      }
      case 'neutral_choice': {
        if (!move) break;
        const st = this.state.stations[result.stationId];
        const cost = result.negotiateCost.ammo ?? 0;
        const have = this.state.factions[this.state.playerFactionId].resources.ammo ?? 0;
        this.addUi(
          new Dialog(
            this,
            st.name,
            `Станция независима, здесь живут ${st.population} человек. Можно договориться о присоединении за ${cost} патронов или взять станцию силой — это испортит отношения со всеми фракциями.`,
            [
              { label: `Договориться (${cost})`, enabled: have >= cost, onClick: () => this.tryMove(move.squadId, move.stationId, { ...opts, neutralChoice: 'negotiate' }) },
              { label: 'Силой', onClick: () => this.tryMove(move.squadId, move.stationId, { ...opts, neutralChoice: 'force' }) },
              { label: 'Отмена' },
            ],
            620,
          ),
        );
        break;
      }
      case 'battle': {
        const b = result.battle;
        const text =
          b.kind === 'ambush'
            ? 'В тоннеле на отряд напали мутанты!'
            : `Бой за станцию ${this.state.stations[b.targetStationId].name}.`;
        this.addUi(
          new Dialog(this, 'Бой!', text, [
            { label: 'В бой', onClick: () => this.startBattle() },
            { label: 'Быстрый бой', onClick: () => this.quickBattle() },
          ]),
        );
        break;
      }
      case 'captured':
        this.addUi(new Dialog(this, 'Станция наша', `${this.state.stations[result.stationId].name} теперь под вашим контролем.`, [{ label: 'Отлично' }]));
        break;
      default:
        break;
    }
  }

  private startBattle(): void {
    const pending = this.state.pendingBattle;
    if (!pending) return;
    const input = buildBattleInput(this.state, pending);
    const data: BattleSceneData = {
      battle: input,
      returnScene: 'MapScene',
      onFinish: (outcome: BattleOutcome) => {
        session.followUp = resolveBattle(this.state, outcome);
        const won = outcome.winner === pending.attackerSide;
        if (!won && pending.attackerFactionId === this.state.playerFactionId) {
          session.followUp = { kind: 'invalid', reason: 'Отряд не смог прорваться и отошёл назад.' };
        }
      },
    };
    this.scene.start('BattleScene', data);
  }

  /** Бой без экрана: обе стороны под управлением ИИ, сразу итог. */
  private quickBattle(): void {
    const pending = this.state.pendingBattle;
    if (!pending) return;
    const { outcome, follow } = autoResolvePending(this.state);
    const won = outcome.winner === pending.attackerSide;
    const lost = outcome.sides[pending.attackerSide].dead.length;
    const lootText = Object.entries(outcome.loot).map(([k, v]) => `${resourceName(k)}: +${v}`).join(', ');
    this.redraw();
    this.addUi(
      new Dialog(
        this,
        won ? 'Победа' : 'Поражение',
        `Бой длился ${outcome.rounds} раунд(ов). Потери: ${lost}.${won && lootText ? `\nТрофеи: ${lootText}` : ''}`,
        [{ label: 'Дальше', onClick: () => follow && follow.kind !== 'captured' && this.handleMoveResult(follow, null, {}) }],
      ),
    );
  }

  private onEndTurn(): void {
    if (this.state.pendingBattle) {
      this.startBattle();
      return;
    }
    const report = endTurn(this.state);
    this.selection = { kind: 'none' };
    this.redraw();
    if (report.messages.length) {
      this.addUi(new Dialog(this, `Ход ${report.turn}`, report.messages.join('\n'), [{ label: 'Дальше' }]));
    }
    this.checkGameOver();
  }

  private checkGameOver(): void {
    const p = this.state.playerFactionId;
    const hasStations = Object.values(this.state.stations).some((s) => s.ownerFactionId === p);
    const hasSquads = this.state.squads.some((s) => s.factionId === p && activeUnits(s).length > 0);
    if (!hasStations && !hasSquads) {
      this.addUi(new Dialog(this, 'Поражение', 'У вас не осталось ни станций, ни отрядов.', [{ label: 'В меню', onClick: () => this.scene.start('MenuScene') }]));
    }
  }
}
