// A land's mana abilities that always work, read from Oracle text. A leaf on
// purpose: the mana sim's classifier and the cube's fixing-land reading
// (lib/cube/pool.ts) share it, and the cube must not pull the simulator in.

/** Generic mana in an activation cost, or -1 when it needs colored mana. */
export function costMana(cost: string): number {
  let generic = 0;
  for (const [, sym] of cost.matchAll(/\{([^}]+)\}/g)) {
    if (sym === 't' || sym === 'q') continue;
    if (/^\d+$/.test(sym)) generic += Number(sym);
    else return -1;
  }
  return generic;
}

/**
 * A land's mana abilities that always work: the ones a source can count on.
 * Scryfall's `produced_mana` also lists what a paid or restricted ability makes,
 * so Daily Bugle Building ("{1}, {T}: Add one mana of any color"), Springjack
 * Pasture (sacrifice Goats for any one color), Power Depot ("Spend this mana
 * only to cast artifact spells") and Cavern of Souls read as free any-colour
 * sources. An ability is left out when it costs generic mana or a sacrifice, or
 * when its mana carries a spend restriction. Returns the face's text without
 * those lines and the colors the rest produce, or null when nothing is left
 * out (the caller keeps Scryfall's reading).
 *
 * A text test, not a model of the filter step: a filter land costing
 * generic mana reads as its {T} mana (a colorless land for Daily Bugle
 * Building). A coloured-cost filter (Mystic Gate) is kept as a dual. Upgrade
 * path: model the filter's conversion in the engine.
 *
 * `fixing` reads a land the way a drafter counts fixing; the simulator leaves
 * it off. It keeps a generic-cost ability that makes more mana than it costs:
 * an Odyssey filter (Sunscorched Divide, "{1}, {T}: Add {R}{W}") nets one extra
 * mana in two colors, real fixing even though the engine can't spend it. It
 * also leaves out a one-shot triggered add: Branch of Vitu-Ghazi's "When this
 * land is turned face up, add two mana of any one color" is not a source.
 */
export function unconditionalMana(
  rawText: string,
  { fixing = false }: { fixing?: boolean } = {}
): { text: string; colours: string[] | null } | null {
  const lines = rawText.toLowerCase().replace(/[()]/g, ' ').split('\n');
  let dropped = false;
  const kept: string[] = [];
  const symbols = new Set<string>();
  let anyColour = false;
  for (const line of lines) {
    const m = /^([^:]*):\s*adds?\s([^]*)$/.exec(line.trim());
    if (fixing && !m && /^(?:when|whenever|at)\b[^:]*\badds?\b/.test(line.trim())) {
      dropped = true;
      continue;
    }
    if (!m) {
      kept.push(line);
      continue;
    }
    const [, cost, effect] = m;
    const generic = costMana(cost);
    const named = effect.split('.')[0];
    const made = /\bor\b|one mana|any/.test(named)
      ? 1
      : (named.match(/\{[wubrgc]\}/g) ?? []).length;
    const netFilter = fixing && generic > 0 && made > generic;
    const needsMana = (generic > 0 && !netFilter) || cost.includes('sacrifice');
    if (needsMana || /spend this mana only/.test(effect)) {
      dropped = true;
      continue;
    }
    kept.push(line);
    for (const [, sym] of effect.split('.')[0].matchAll(/\{([wubrgc])\}/g))
      symbols.add(sym.toUpperCase());
    if (/any (?:one )?(?:colou?r|type)|color identity|could produce/.test(effect)) anyColour = true;
  }
  if (!dropped) return null;
  return { text: kept.join('\n'), colours: anyColour ? null : [...symbols] };
}

/**
 * The colors a land can count on, as WUBRG + C keys: Scryfall's
 * `produced_mana` with the paid, sacrifice and spend-restricted abilities left
 * out (see `unconditionalMana`). Undefined in, undefined out, so a caller's
 * fallback (color identity, then colors) still applies to a card without it.
 */
export function alwaysProducedMana(
  oracleText: string | undefined,
  producedMana: string[] | undefined
): string[] | undefined {
  if (!producedMana || !oracleText) return producedMana;
  return unconditionalMana(oracleText, { fixing: true })?.colours ?? producedMana;
}

/** "As it enters, choose a color other than red": a Thriving land's fixed color. */
export const CHOSEN_OTHER_THAN = /choose a colou?r other than (white|blue|black|red|green)/;
const COLOR_KEY: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

/**
 * The one color every mana a land makes can pair with, or undefined. A
 * Thriving land taps for its own color or the one chosen on entry, so it fixes
 * only the pairs holding its own color; Scryfall lists all five.
 */
export function fixedColourOf(oracleText: string | undefined): string | undefined {
  const m = (oracleText ?? '').toLowerCase().match(CHOSEN_OTHER_THAN);
  return m ? COLOR_KEY[m[1]] : undefined;
}
