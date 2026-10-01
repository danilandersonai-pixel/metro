// Сохранение партии в JSON с номером версии и миграциями старых форматов.
import { Rng } from './rng';
import { SAVE_VERSION, type GameState } from './state';

/** Формат файла сохранения. */
export interface SaveFile {
  version: number;
  savedAt: string;
  /** Краткое описание для списка слотов. */
  summary: { turn: number; stations: number; title: string };
  /** Состояние без объекта ГСЧ. */
  data: Omit<GameState, 'rng'>;
  rngState: number;
}

type RawData = Record<string, unknown>;

/**
 * Миграции: ключ — версия, ИЗ которой обновляем. Каждая функция приводит данные к версии +1.
 * При изменении формата GameState: поднять SAVE_VERSION и добавить сюда шаг.
 */
const MIGRATIONS: Record<number, (d: RawData) => RawData> = {
  // v1 → v2: появились квесты, статистика, концовка, очередь боёв, события.
  1: (d) => ({
    ...d,
    battleQueue: d.battleQueue ?? [],
    pendingEvents: d.pendingEvents ?? [],
    turnCounters: d.turnCounters ?? {},
    stats: d.stats ?? {},
    quests: d.quests ?? {},
    endingId: d.endingId ?? null,
  }),
};

export function serialize(state: GameState): string {
  const { rng, ...data } = state;
  const file: SaveFile = {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    summary: {
      turn: state.turn,
      stations: Object.values(state.stations).filter((s) => s.ownerFactionId === state.playerFactionId).length,
      title: `Ход ${state.turn}`,
    },
    data: { ...data, version: SAVE_VERSION },
    rngState: rng.getState(),
  };
  return JSON.stringify(file);
}

export class SaveError extends Error {}

export function deserialize(json: string): GameState {
  let file: SaveFile;
  try {
    file = JSON.parse(json) as SaveFile;
  } catch {
    throw new SaveError('Файл сохранения повреждён');
  }
  if (!file || typeof file.version !== 'number' || !file.data) throw new SaveError('Это не сохранение игры');
  if (file.version > SAVE_VERSION) throw new SaveError('Сохранение из более новой версии игры');

  let data = file.data as unknown as RawData;
  for (let v = file.version; v < SAVE_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new SaveError(`Нет миграции с версии ${v}`);
    data = step(data);
  }
  const rng = new Rng(0);
  rng.setState(file.rngState);
  return { ...(data as unknown as Omit<GameState, 'rng'>), version: SAVE_VERSION, rng };
}

/** Прочитать только краткую информацию из сохранения (для списка слотов). */
export function readSummary(json: string): SaveFile['summary'] & { savedAt: string } | null {
  try {
    const f = JSON.parse(json) as SaveFile;
    return { ...f.summary, savedAt: f.savedAt };
  } catch {
    return null;
  }
}
