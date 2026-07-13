import type { OpponentLife } from './types';

export interface PlaytestLifeConfig {
  life: number;
  opponentCount: number;
  opponentLife: number;
  commanderDamageThreshold: number;
}

/** Commander-family formats play multiplayer goldfish (3 virtual opponents,
 *  higher life, commander damage as an alt-kill). Everything else assumes a
 *  1v1 game. `format` is untyped (`string`) rather than `DeckFormat` so this
 *  stays isomorphic/dependency-free like the rest of `lib/playtest`. */
const COMMANDER_FAMILY = new Set(['commander', 'paupercommander']);

/** Verified against pdhhomebase.com/rules: PDH plays 30 life / 16 commander
 *  damage (vs. Commander's 40 / 21) — reflecting the commons-only power level. */
export function playtestLifeConfig(format: string | undefined): PlaytestLifeConfig {
  if (format && COMMANDER_FAMILY.has(format)) {
    const isPdh = format === 'paupercommander';
    const life = isPdh ? 30 : 40;
    return {
      life,
      opponentCount: 3,
      opponentLife: life,
      commanderDamageThreshold: isPdh ? 16 : 21,
    };
  }
  return { life: 20, opponentCount: 1, opponentLife: 20, commanderDamageThreshold: 21 };
}

/** An opponent is defeated when their life is gone or your commander alone
 *  has dealt lethal — either is independently sufficient, so this is always
 *  re-derived from the live numbers rather than stored (healing naturally
 *  un-defeats them). */
export function isOpponentDefeated(
  opponent: OpponentLife,
  commanderDamageThreshold: number
): boolean {
  return opponent.life <= 0 || opponent.commanderDamage >= commanderDamageThreshold;
}
