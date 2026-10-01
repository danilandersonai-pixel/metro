// Все основные типы данных игры. Чистый TypeScript, без Phaser.

// ---------- Ресурсы ----------

export type ResourceId = 'ammo' | 'food' | 'fuel' | 'power' | 'meds' | 'scrap';

/** Набор ресурсов: цена, содержание, запасы. Отсутствующий ключ = 0. */
export type Resources = Partial<Record<ResourceId, number>>;

// ---------- Карта ----------

export type StationTag = 'hub' | 'surface_exit' | 'abandoned' | 'infested';

export interface Line {
  id: string;
  name: string;
  color: string;
  /** Станции линии по порядку. */
  stationIds: string[];
}

export interface Station {
  id: string;
  name: string;
  lineIds: string[];
  x: number;
  y: number;
  ownerFactionId: string | null;
  unlocked: boolean;
  buildings: BuildingInstance[];
  garrison: Unit[];
  population: number;
  defenseBonus: number;
  tags: StationTag[];
}

export interface Tunnel {
  from: string;
  to: string;
  /** Длина в очках движения. */
  length: number;
  /** Опасность 0–3: шанс случайного события при проходе. */
  danger: number;
  blocked: boolean;
}

/** Позиция отряда внутри тоннеля. */
export interface TunnelPos {
  from: string;
  to: string;
  progress: number;
}

export interface Squad {
  id: string;
  factionId: string;
  /** До 6 бойцов. */
  units: Unit[];
  stationId: string | null;
  tunnelPos: TunnelPos | null;
  movePoints: number;
}

// ---------- Здания ----------

export type BuildingKind = 'economy' | 'military' | 'special';

export interface BuildingEffect {
  type: string;
  value: number;
  resource?: ResourceId;
}

export interface BuildingType {
  id: string;
  name: string;
  kind: BuildingKind;
  cost: Resources;
  buildTurns: number;
  upkeep: Resources;
  effects: BuildingEffect[];
  requires: string[];
  maxLevel: number;
}

export interface BuildingInstance {
  typeId: string;
  level: number;
  /** Сколько ходов осталось до конца стройки (0 — построено). */
  turnsLeft: number;
  damaged: boolean;
}

// ---------- Бойцы ----------

export type AttackType = 'melee' | 'ranged' | 'area' | 'support';

export type EffectId =
  | 'bleeding'
  | 'burning'
  | 'stunned'
  | 'poisoned'
  | 'inspired'
  | 'covered'
  | 'suppressed';

export interface Effect {
  id: EffectId;
  turns: number;
  stacks: number;
}

export interface LevelUnlock {
  level: number;
  abilityId?: string;
  passiveId?: string;
}

export interface UnitType {
  id: string;
  name: string;
  role: string;
  hp: number;
  armor: number;
  damage: number;
  accuracy: number;
  initiative: number;
  attackType: AttackType;
  abilities: string[];
  passives: string[];
  cost: Resources;
  upkeep: Resources;
  factionTags: string[];
  levelUnlocks?: LevelUnlock[];
  /** Наёмник: не умирает насовсем, а выбывает на N ходов. */
  mercenary?: boolean;
}

/** Шеренга: 0 — передняя, 1 — задняя. */
export type Row = 0 | 1;

export interface UnitPosition {
  row: Row;
  slot: number;
}

export interface Unit {
  uid: string;
  typeId: string;
  level: number;
  xp: number;
  hp: number;
  effects: Effect[];
  position: UnitPosition;
}

// ---------- Фракции ----------

export type AiPersonality = 'aggressor' | 'trader' | 'isolationist';

export interface Faction {
  id: string;
  name: string;
  color: string;
  ideology: string;
  startStations: string[];
  unitPool: string[];
  canTrade: boolean;
  aiPersonality: AiPersonality;
}

export type RelationStatus = 'war' | 'neutral' | 'peace' | 'alliance';

// ---------- Квесты ----------

export type ObjectiveType =
  | 'reach_station'
  | 'capture_station'
  | 'defeat_squad'
  | 'deliver_resource'
  | 'reach_relation'
  | 'build'
  | 'hold_turns';

export interface QuestStage {
  text: string;
  objective: { type: ObjectiveType; params: Record<string, unknown> };
  onComplete: {
    setFlags?: string[];
    rewards?: Resources;
    unlockStations?: string[];
  };
}

export interface Quest {
  id: string;
  title: string;
  giverStationId: string;
  requires: { flags: string[]; relation: Record<string, number> };
  stages: QuestStage[];
  branches?: { choiceText: string; nextQuestId: string; setFlags: string[] }[];
}
