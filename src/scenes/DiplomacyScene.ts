import Phaser from 'phaser';
import { BALANCE, FACTIONS, getFaction, resourceName } from '../core/content';
import { describeStance } from '../core/factions/ai';
import {
  declareWarOn,
  demandTribute,
  giftAmmo,
  hasAlliance,
  hasTradeTreaty,
  proposeAlliance,
  proposePeace,
  proposeTrade,
  type DiplomacyResult,
} from '../core/factions/diplomacy';
import { getRelation, RELATION_NAMES, relationStatus } from '../core/factions/relations';
import { buy, canTradeWith, prices, sell, TRADE_GOODS } from '../core/factions/trade';
import type { GameState } from '../core/state';
import { requireState } from '../game/session';
import { Button } from '../ui/Button';
import { drawResourceBar } from '../ui/ResourceBar';
import { COLORS, TEXT, textStyle } from '../ui/theme';

const GIFT = 50;

/** Дипломатия и торговля с фракциями. */
export class DiplomacyScene extends Phaser.Scene {
  private state!: GameState;
  private selected: string | null = null;
  private root!: Phaser.GameObjects.Container;
  private resultText = '';
  private resultOk = true;

  constructor() {
    super('DiplomacyScene');
  }

  create(): void {
    this.state = requireState();
    this.root = this.add.container(0, 0);
    this.selected = this.selected && FACTIONS[this.selected] ? this.selected : this.factionList()[0] ?? null;
    this.resultText = '';
    new Button(this, this.scale.width - 110, this.scale.height - 36, 'На карту', () => this.scene.start('MapScene'), 200, 48, 18);
    this.redraw();
  }

  private factionList(): string[] {
    return Object.keys(FACTIONS).filter((id) => id !== this.state.playerFactionId && !this.state.factions[id]?.defeated);
  }

  private redraw(): void {
    this.root.removeAll(true);
    this.root.add(this.add.rectangle(0, 0, this.scale.width, 40, COLORS.panel).setOrigin(0));
    drawResourceBar(this, this.root, this.state, 16, 11);
    this.root.add(this.add.text(16, 50, 'Дипломатия', textStyle(26, TEXT.accent, true)));

    // Список фракций
    let y = 100;
    for (const id of this.factionList()) {
      const f = getFaction(id);
      const status = f.noDiplomacy ? 'враги всем' : RELATION_NAMES[relationStatus(this.state, this.state.playerFactionId, id)];
      const b = new Button(this, 170, y, `${f.name}`, () => {
        this.selected = id;
        this.resultText = '';
        this.redraw();
      }, 300, 40, 14).setPressed(id === this.selected);
      this.root.add(b);
      this.root.add(this.add.rectangle(30, y, 10, 30, parseInt(f.color.slice(1), 16)));
      this.root.add(this.add.text(330, y - 9, status, textStyle(13, TEXT.dim)));
      y += 48;
    }

    if (this.selected) this.drawFaction(this.selected);
  }

  private act(r: DiplomacyResult | string | null): void {
    if (typeof r === 'string') {
      this.resultText = r;
      this.resultOk = false;
    } else if (r === null) {
      this.resultText = 'Сделка заключена';
      this.resultOk = true;
    } else {
      this.resultText = r.text;
      this.resultOk = r.ok;
    }
    this.redraw();
  }

  private drawFaction(id: string): void {
    const f = getFaction(id);
    const p = this.state.playerFactionId;
    const x = 460;
    let y = 90;
    const w = this.scale.width - x - 20;
    this.root.add(this.add.rectangle(x, y, w, 560, COLORS.panel, 0.9).setOrigin(0).setStrokeStyle(1, COLORS.panelBorder));
    const line = (text: string, size = 15, color: string = TEXT.main) => {
      const t = this.add.text(x + 16, y, text, { ...textStyle(size, color), wordWrap: { width: w - 32 } });
      this.root.add(t);
      y += t.height + 6;
    };
    y += 12;
    line(f.name, 22, TEXT.accent);
    line(f.ideology, 14, TEXT.dim);
    if (f.noDiplomacy) {
      line('С мутантами не договориться. Их логова можно только выжечь.', 15);
      return;
    }
    const rel = getRelation(this.state, p, id);
    line(`Отношения: ${rel > 0 ? '+' : ''}${rel} — ${RELATION_NAMES[relationStatus(this.state, p, id)]}`, 16);
    line(describeStance(this.state, id), 14, TEXT.dim);
    const treaties = [hasTradeTreaty(this.state, p, id) ? 'торговый договор' : '', hasAlliance(this.state, p, id) ? 'союз' : ''].filter(Boolean);
    line(`Договоры: ${treaties.length ? treaties.join(', ') : 'нет'}`, 14);

    // Кнопки дипломатии
    y += 6;
    const actions: [string, () => DiplomacyResult][] = [
      [`Подарок (${GIFT})`, () => giftAmmo(this.state, p, id, GIFT)],
      ['Предложить мир', () => proposePeace(this.state, p, id)],
      ['Торговый договор', () => proposeTrade(this.state, p, id)],
      ['Союз', () => proposeAlliance(this.state, p, id)],
      ['Потребовать дань', () => demandTribute(this.state, p, id)],
      ['Объявить войну', () => declareWarOn(this.state, p, id)],
    ];
    actions.forEach(([label, fn], i) => {
      const bx = x + 16 + (i % 3) * 250 + 120;
      const by = y + Math.floor(i / 3) * 46 + 20;
      this.root.add(new Button(this, bx, by, label, () => this.act(fn()), 240, 38, 14));
    });
    y += 100;
    if (this.resultText) line(this.resultText, 15, this.resultOk ? TEXT.good : TEXT.bad);

    // Торговля
    y += 6;
    const trade = canTradeWith(this.state, p, id);
    if (!trade.ok) {
      line(`Торговля: ${trade.reason}`, 14, TEXT.dim);
      return;
    }
    const lot = BALANCE.trade.lot;
    line(`Торговля (партия — ${lot} шт., цена в патронах за штуку):`, 15, TEXT.accent);
    const their = this.state.factions[id].resources;
    for (const good of TRADE_GOODS) {
      const pr = prices(this.state, p, id, good);
      this.root.add(this.add.text(x + 16, y + 4, `${resourceName(good)}`, textStyle(14)));
      this.root.add(this.add.text(x + 150, y + 4, `у них: ${their[good] ?? 0}`, textStyle(13, TEXT.dim)));
      this.root.add(new Button(this, x + 330, y + 12, `Купить ${pr.buy}`, () => this.act(buy(this.state, p, id, good)), 140, 26, 13));
      this.root.add(new Button(this, x + 480, y + 12, `Продать ${pr.sell}`, () => this.act(sell(this.state, p, id, good)), 140, 26, 13));
      y += 32;
    }
  }
}
