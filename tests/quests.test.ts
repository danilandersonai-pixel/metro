import { describe, expect, it } from 'vitest';
import { setRelation } from '../src/core/factions/relations';
import { autoResolvePending } from '../src/core/map/autoresolve';
import { moveSquad } from '../src/core/map/movement';
import { checkQuests, chooseBranch, objectiveText, QUESTS } from '../src/core/quests/quests';
import { deserialize, SaveError, serialize } from '../src/core/save';
import { createNewGame, newUnit, SAVE_VERSION, type GameState } from '../src/core/state';
import { endTurn } from '../src/core/turn';
import { startConstruction } from '../src/core/economy/buildings';
import { hireUnit, moveToSquad } from '../src/core/economy/units';

const P = 'sokolniki_community';
const QUIET = { events: false, ai: false };

function game(): GameState {
  const s = createNewGame(1);
  for (const t of s.tunnels) t.danger = 0;
  checkQuests(s);
  return s;
}

const squad = (s: GameState) => s.squads.find((q) => q.factionId === P)!;
const status = (s: GameState, id: string) => s.quests[id]?.status;

/** Пройти обучение быстро. */
function finishTutorial(s: GameState): void {
  squad(s).stationId = 'preobrazhenskaya_ploshchad';
  checkQuests(s);
  hireUnit(s, 'sokolniki', 'rifleman', P);
  squad(s).stationId = 'sokolniki';
  moveToSquad(s, 'sokolniki', s.stations.sokolniki.garrison.at(-1)!.uid, squad(s).id);
  checkQuests(s);
  s.stats['wins:mutants'] = (s.stats['wins:mutants'] ?? 0) + 1;
  checkQuests(s);
  s.factions[P].resources.ammo = 1000;
  s.factions[P].resources.scrap = 100;
  startConstruction(s, 'sokolniki', 'checkpoint', P);
  endTurn(s, QUIET);
  endTurn(s, QUIET);
}

describe('квесты', () => {
  it('все квесты ссылаются на существующие станции, фракции и следующие квесты', () => {
    const s = createNewGame(1);
    const ids = new Set(QUESTS.map((q) => q.id));
    for (const q of QUESTS) {
      expect(s.stations[q.giverStationId]).toBeDefined();
      for (const st of q.stages) {
        const p = st.objective.params;
        if (p.stationId) expect(s.stations[p.stationId]).toBeDefined();
        if (p.factionId) expect(s.factions[p.factionId]).toBeDefined();
      }
      for (const b of q.branches ?? []) expect(ids.has(b.nextQuestId)).toBe(true);
    }
  });

  it('в начале игры выдаётся первое обучающее задание', () => {
    const s = game();
    expect(status(s, 'tut_move')).toBe('active');
    expect(s.pendingEvents).toContainEqual({ kind: 'quest_new', questId: 'tut_move' });
    expect(objectiveText(s, 'tut_move')).toContain('Преображенская площадь');
  });

  it('выход на соседнюю станцию выполняет задание и даёт награду', () => {
    const s = game();
    const ammo = s.factions[P].resources.ammo!;
    moveSquad(s, squad(s).id, 'preobrazhenskaya_ploshchad', { neutralChoice: 'negotiate' });
    checkQuests(s);
    expect(status(s, 'tut_move')).toBe('completed');
    expect(s.factions[P].resources.ammo).toBe(ammo - 120 + 30);
    expect(status(s, 'tut_squad')).toBe('active');
  });

  it('обучение ведёт к сюжетному заданию', () => {
    const s = game();
    finishTutorial(s);
    for (const id of ['tut_move', 'tut_squad', 'tut_fight', 'tut_build']) expect(status(s, id)).toBe('completed');
    expect(status(s, 'story_noise')).toBe('active');
  });

  it('победа над мутантами в бою засчитывается заданию «Первая кровь»', () => {
    const s = game();
    s.quests = {};
    s.flags.push('tut_squad_done');
    checkQuests(s);
    expect(status(s, 'tut_fight')).toBe('active');
    const sq = squad(s);
    sq.units = ['stormtrooper', 'stormtrooper', 'sniper', 'sniper', 'medic', 'stormtrooper'].map((t) => newUnit(s, t, 10));
    s.stations.cherkizovskaya.ownerFactionId = P;
    sq.stationId = 'cherkizovskaya';
    moveSquad(s, sq.id, 'bulvar_rokossovskogo');
    autoResolvePending(s);
    checkQuests(s);
    expect(status(s, 'tut_fight')).toBe('completed');
  });

  function toVoice(s: GameState, branch: number): void {
    finishTutorial(s);
    squad(s).stationId = 'chistye_prudy';
    checkQuests(s);
    expect(status(s, 'story_noise')).toBe('branching');
    chooseBranch(s, 'story_noise', 0);
    expect(status(s, 'story_trade')).toBe('active');
    setRelation(s, P, 'ring_trade_union', 30);
    checkQuests(s);
    expect(status(s, 'story_trade')).toBe('completed');
    expect(s.stations.sokolniki.garrison.some((u) => u.typeId === 'veteran')).toBe(true);
    expect(s.stations.kropotkinskaya.unlocked).toBe(false);
    s.stations.biblioteka_lenina.ownerFactionId = P;
    checkQuests(s);
    expect(s.stations.kropotkinskaya.unlocked).toBe(true);
    squad(s).stationId = 'kropotkinskaya';
    checkQuests(s);
    expect(status(s, 'story_voice')).toBe('branching');
    s.factions[P].resources.scrap = 0;
    chooseBranch(s, 'story_voice', branch);
  }

  it('сюжет: путь торговцев и концовка «Общая вода»', () => {
    const s = game();
    toVoice(s, 0);
    expect(status(s, 'story_council')).toBe('active');
    s.factions[P].resources.scrap = 70;
    checkQuests(s);
    expect(s.factions[P].resources.scrap).toBe(10);
    expect(s.quests.story_council.stage).toBe(1);
    setRelation(s, P, 'ring_trade_union', 55);
    checkQuests(s);
    expect(s.endingId).toBe('ending_light');
    expect(s.pendingEvents.some((e) => e.kind === 'ending')).toBe(true);
  });

  it('сюжет: захват насосной и концовка «Железная рука» после 6 ходов удержания', () => {
    const s = game();
    toVoice(s, 1);
    expect(status(s, 'story_hold')).toBe('active');
    s.stations.kropotkinskaya.ownerFactionId = P;
    checkQuests(s);
    for (let i = 0; i < 5; i++) endTurn(s, QUIET);
    expect(s.endingId).toBeNull();
    endTurn(s, QUIET);
    expect(s.endingId).toBe('ending_iron');
  });

  it('потеря станции сбрасывает отсчёт удержания', () => {
    const s = game();
    toVoice(s, 1);
    s.stations.kropotkinskaya.ownerFactionId = P;
    checkQuests(s);
    for (let i = 0; i < 4; i++) endTurn(s, QUIET);
    s.stations.kropotkinskaya.ownerFactionId = 'krasnoselsk_commune';
    endTurn(s, QUIET);
    s.stations.kropotkinskaya.ownerFactionId = P;
    for (let i = 0; i < 4; i++) endTurn(s, QUIET);
    expect(s.endingId).toBeNull();
  });
});

describe('сохранения', () => {
  it('сохранение и загрузка дают ту же партию, и случайность продолжается так же', () => {
    const s = game();
    endTurn(s, QUIET);
    const json = serialize(s);
    const loaded = deserialize(json);
    expect(serialize(loaded)).toBe(json.replace(/"savedAt":"[^"]+"/, `"savedAt":"${JSON.parse(serialize(loaded)).savedAt}"`));
    expect(loaded.rng.next()).toBe(s.rng.next());
    expect(loaded.version).toBe(SAVE_VERSION);
  });

  it('загруженная партия играется дальше', () => {
    const s = game();
    const loaded = deserialize(serialize(s));
    expect(() => {
      for (let i = 0; i < 5; i++) {
        while (loaded.pendingBattle) autoResolvePending(loaded);
        endTurn(loaded);
      }
    }).not.toThrow();
  });

  it('старое сохранение версии 1 обновляется миграцией', () => {
    const s = game();
    const file = JSON.parse(serialize(s));
    file.version = 1;
    for (const k of ['battleQueue', 'pendingEvents', 'turnCounters', 'stats', 'quests', 'endingId']) delete file.data[k];
    const loaded = deserialize(JSON.stringify(file));
    expect(loaded.quests).toEqual({});
    expect(loaded.stats).toEqual({});
    expect(loaded.battleQueue).toEqual([]);
    expect(loaded.endingId).toBeNull();
  });

  it('мусор и сохранения из будущей версии отклоняются понятной ошибкой', () => {
    expect(() => deserialize('не json')).toThrow(SaveError);
    expect(() => deserialize('{"foo":1}')).toThrow(SaveError);
    const s = game();
    const file = JSON.parse(serialize(s));
    file.version = SAVE_VERSION + 1;
    expect(() => deserialize(JSON.stringify(file))).toThrow(SaveError);
  });
});
