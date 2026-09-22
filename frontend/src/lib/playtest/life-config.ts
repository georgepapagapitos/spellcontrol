export interface PlaytestLifeConfig {
  life: number;
}

/** Commander-family formats start on higher life. `format` is untyped
 *  (`string`) rather than `DeckFormat` so this stays isomorphic/dependency-free
 *  like the rest of `lib/playtest`. */
const COMMANDER_FAMILY = new Set(['commander', 'paupercommander']);

/** Verified against pdhhomebase.com/rules: PDH plays 30 life (vs. Commander's
 *  40) — reflecting the commons-only power level. */
export function playtestLifeConfig(format: string | undefined): PlaytestLifeConfig {
  if (format && COMMANDER_FAMILY.has(format)) {
    return { life: format === 'paupercommander' ? 30 : 40 };
  }
  return { life: 20 };
}
