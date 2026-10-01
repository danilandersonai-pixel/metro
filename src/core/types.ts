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
  name: string;
  factionId: string;
  /** До 6 бойцов. */
  units: Unit[];
  stationId: string | null;
  tunnelPos: TunnelPos | null;
  movePoints: number;
}

// ---------- Здания ----------

export type BuildingKind = 'economy' | 'military' | 'special';

/**
 * Эффект здания. Значение умножается на уровень здания (кроме recruit).
 * produce — ресурс за ход; heal — доп. лечение (доля HP); defense — точность защитников;
 * recruit — разрешает найм; risk — шанс потерь при вылазке (пост сталкеров);
 * frontArmor — множитель урона по передней шеренге защитников (баррикада);
 * openingStrike — урон по врагу в начале боя (пулемётное гнездо);
 * garrisonXp — опыт гарнизону за ход; vision — дальность обзора; housing — +лимит населения;
 * diplomacy — +отношения в ход; morale — +боевой дух в ход; armory — доступ к элитным бойцам;
 * trade — скидка на торговлю; quests — доступ к квестам архива.
 */
export type BuildingEffectType =
  | 'produce'
  | 'heal'
  | 'defense'
  | 'recruit'
  | 'risk'
  | 'frontArmor'
  | 'openingStrike'
  | 'garrisonXp'
  | 'vision'
  | 'housing'
  | 'diplomacy'
  | 'morale'
  | 'armory'
  | 'trade'
  | 'quests';

export interface BuildingEffect {
  type: BuildingEffectType;
  value: number;
  resource?: ResourceId;
}

export interface BuildingType {
  id: string;
  name: string;
  kind: BuildingKind;
  description: string;
  /** Порядок обработки в конце хода (меньше — раньше: сначала топливо и энергия). */
  order: number;
  cost: Resources;
  buildTurns: number;
  upkeep: Resources;
  effects: BuildingEffect[];
  /** Здания, которые должны уже стоять на станции. */
  requires: string[];
  /** Теги станции, без которых строить нельзя. */
  requiresTags?: StationTag[];
  maxLevel: number;
}

export interface BuildingInstance {
  typeId: string;
  level: number;
  /** Сколько ходов осталось до конца стройки (0 — построено). */
  turnsLeft: number;
  damaged: boolean;
  /** Идёт улучшение до этого уровня — здание пока работает на старом. */
  upgradeTo?: number;
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

/** Описание эффекта из effects.json. */
export interface EffectDef {
  id: EffectId;
  name: string;
  /** Короткая подпись для карточки бойца. */
  short: string;
  positive: boolean;
  maxStacks: number;
  /** Урон за стак в начале хода носителя (без учёта брони). */
  tickDamage?: number;
  /** Пропуск хода (оглушение). */
  skipTurn?: boolean;
  /** Добавка к точности (доля, например -0.25). */
  accuracy?: number;
  /** Множитель наносимого урона. */
  damageMult?: number;
  /** Множитель получаемого урона. */
  damageTakenMult?: number;
}

/** Наложение эффекта атакой или способностью. */
export interface EffectApplication {
  id: EffectId;
  turns: number;
  chance: number;
}

export type AbilityTarget = 'enemy' | 'enemy_row' | 'all_enemies' | 'ally' | 'all_allies' | 'self';

/** Способность или пассивка из abilities.json. */
export interface AbilityDef {
  id: string;
  name: string;
  kind: 'active' | 'passive';
  target?: AbilityTarget;
  /** Для одиночной атаки: melee — по правилам ближнего боя, ranged — по любому. */
  reach?: 'melee' | 'ranged';
  damageMult?: number;
  accuracyBonus?: number;
  heal?: number;
  effect?: EffectApplication;
  cooldown?: number;
  /** Пассивка: добавка к точности всем союзникам, пока носитель жив. */
  auraAccuracy?: number;
  /** Пассивка: восстановление HP в начале своего хода. */
  regen?: number;
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
  evasion: number;
  initiative: number;
  attackType: AttackType;
  /** Сила лечения (только для support). */
  heal?: number;
  /** Эффект, который может наложить обычная атака. */
  onHitEffect?: EffectApplication;
  abilities: string[];
  passives: string[];
  cost: Resources;
  upkeep: Resources;
  factionTags: string[];
  /** Для найма нужна Оружейная на станции. */
  requiresArmory?: boolean;
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
  /** Наёмник выбыл из строя на столько ходов (0/нет — в строю). */
  downedTurns?: number;
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
  /** Фракция без дипломатии (мутанты) — всегда враждебна всем. */
  noDiplomacy?: boolean;
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
