// Итоги боя: выжившие, погибшие, трофеи — в форме, удобной для карты.
import { BALANCE } from '../content';
import { grantXp, xpForKill } from '../units/experience';
import type { Resources, Unit } from '../types';
import type { BattleState, Combatant, Side } from './types';

export interface SideOutcome {
  /** Выжившие бойцы основного отряда с обновлённым HP и позицией. */
  survivors: Unit[];
  /** Выжившие «призванные» (гарнизон/союзники). */
  summonedSurvivors: Unit[];
  /** uid погибших (наёмники сюда не попадают — они в survivors с downedTurns). */
  dead: string[];
  /** Сколько врагов убил каждый боец (uid → убийства). */
  kills: Record<string, number>;
  /** Кто получил новый уровень: имя и новый уровень. */
  levelUps: { uid: string; name: string; level: number }[];
}

export interface BattleOutcome {
  winner: Side;
  retreatedSide: Side | null;
  rounds: number;
  sides: [SideOutcome, SideOutcome];
  /** Трофеи победителя. */
  loot: Resources;
}

function toUnit(c: Combatant): Unit {
  return {
    ...c.source,
    hp: c.hp,
    level: c.level,
    position: { row: c.row, slot: c.slot },
    effects: [],
  };
}

export function collectOutcome(state: BattleState): BattleOutcome {
  if (!state.result || state.result.winner === null) throw new Error('collectOutcome: бой не окончен');
  const winner = state.result.winner;
  const sides = ([0, 1] as Side[]).map((side): SideOutcome => {
    const own = state.combatants.filter((c) => c.side === side);
    const survivors: Unit[] = [];
    const summonedSurvivors: Unit[] = [];
    const dead: string[] = [];
    const kills: Record<string, number> = {};
    const levelUps: SideOutcome['levelUps'] = [];

    // Опыт: стоимость убитых этой стороной врагов делится между выжившими, добивший получает бонус.
    const enemyDead = state.combatants.filter((c) => c.side !== side && c.hp <= 0);
    const pool = enemyDead.reduce((sum, c) => sum + xpForKill(c.level), 0);
    const aliveCount = own.filter((c) => c.hp > 0).length;
    const share = aliveCount > 0 ? pool / aliveCount : 0;

    for (const c of own) {
      kills[c.uid] = c.kills;
      if (c.hp > 0) {
        const unit = toUnit(c);
        const gained = grantXp(unit, share + c.kills * BALANCE.experience.xpKillBonus);
        if (gained > 0) levelUps.push({ uid: c.uid, name: c.name, level: unit.level });
        (c.summoned ? summonedSurvivors : survivors).push(unit);
      } else if (c.mercenary) {
        survivors.push({ ...toUnit(c), hp: 1, downedTurns: BALANCE.battle.mercenaryDownedTurns });
      } else {
        dead.push(c.uid);
      }
    }
    return { survivors, summonedSurvivors, dead, kills, levelUps };
  }) as [SideOutcome, SideOutcome];

  return {
    winner,
    retreatedSide: state.result.retreatedSide,
    rounds: state.result.rounds,
    sides,
    loot: computeLoot(state, winner),
  };
}

/** Трофеи: патроны за каждого убитого врага, иногда медикаменты и хлам. */
export function computeLoot(state: BattleState, winner: Side): Resources {
  const L = BALANCE.loot;
  const loot: Resources = {};
  const killed = state.combatants.filter((c) => c.side !== winner && c.hp <= 0);
  for (const c of killed) {
    loot.ammo = (loot.ammo ?? 0) + L.ammoPerKill + L.ammoPerKillLevel * (c.level - 1);
    if (state.rng.chance(L.medsChance)) loot.meds = (loot.meds ?? 0) + L.medsAmount;
    if (state.rng.chance(L.scrapChance)) loot.scrap = (loot.scrap ?? 0) + L.scrapAmount;
  }
  return loot;
}
