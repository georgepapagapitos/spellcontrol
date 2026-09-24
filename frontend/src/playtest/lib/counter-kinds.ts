/**
 * The counters a card prints, each with the mana-font glyph EDHPlay draws for
 * it: the body counters, the bookkeeping ones, then the keyword counters.
 * `kind` is what the reducer stores, so it stays lowercase like every counter
 * already on a saved board ("charge", "loyalty"). A counter not listed here is
 * one the player named, and it is drawn as a coloured disc instead.
 */
export const COUNTER_CATALOG: ReadonlyArray<{ kind: string; glyph: string }> = [
  { kind: '+1/+1', glyph: 'ms-counter-plus' },
  { kind: '-1/-1', glyph: 'ms-counter-minus' },
  { kind: 'loyalty', glyph: 'ms-counter-loyalty' },
  { kind: 'charge', glyph: 'ms-counter-charge' },
  { kind: 'time', glyph: 'ms-counter-time' },
  { kind: 'lore', glyph: 'ms-counter-lore' },
  { kind: 'shield', glyph: 'ms-counter-shield' },
  { kind: 'stun', glyph: 'ms-counter-stun' },
  { kind: 'deathtouch', glyph: 'ms-counter-deathtouch' },
  { kind: 'double strike', glyph: 'ms-ability-double-strike' },
  { kind: 'first strike', glyph: 'ms-ability-first-strike' },
  { kind: 'flying', glyph: 'ms-ability-flying' },
  { kind: 'haste', glyph: 'ms-ability-haste' },
  { kind: 'hexproof', glyph: 'ms-ability-hexproof' },
  { kind: 'indestructible', glyph: 'ms-ability-indestructible' },
  { kind: 'lifelink', glyph: 'ms-ability-lifelink' },
  { kind: 'menace', glyph: 'ms-ability-menace' },
  { kind: 'reach', glyph: 'ms-ability-reach' },
  { kind: 'trample', glyph: 'ms-ability-trample' },
  { kind: 'vigilance', glyph: 'ms-ability-vigilance' },
  { kind: 'ward', glyph: 'ms-ability-ward' },
  { kind: 'arrow', glyph: 'ms-counter-arrow' },
  { kind: 'brick', glyph: 'ms-counter-brick' },
  { kind: 'damage', glyph: 'ms-counter-damage' },
  { kind: 'doom', glyph: 'ms-counter-doom' },
  { kind: 'finality', glyph: 'ms-counter-finality' },
  { kind: 'flame', glyph: 'ms-counter-flame' },
  { kind: 'flood', glyph: 'ms-counter-flood' },
  { kind: 'fungus', glyph: 'ms-counter-fungus' },
  { kind: 'gold', glyph: 'ms-counter-gold' },
  { kind: 'ki', glyph: 'ms-counter-ki' },
  { kind: 'mining', glyph: 'ms-counter-mining' },
  { kind: 'muster', glyph: 'ms-counter-muster' },
  { kind: 'pin', glyph: 'ms-counter-pin' },
  { kind: 'rad', glyph: 'ms-counter-rad' },
  { kind: 'scream', glyph: 'ms-counter-scream' },
  { kind: 'slime', glyph: 'ms-counter-slime' },
  { kind: 'verse', glyph: 'ms-counter-verse' },
  { kind: 'void', glyph: 'ms-counter-void' },
  { kind: 'vortex', glyph: 'ms-counter-vortex' },
];

const GLYPHS = new Map(COUNTER_CATALOG.map((c) => [c.kind, c.glyph]));

/** The glyph for a printed counter, or undefined for one the player named. */
export function counterGlyph(kind: string): string | undefined {
  return GLYPHS.get(kind);
}

/** How a counter is named on screen: "Charge", "+1/+1", or the player's own
 *  name exactly as they typed it. */
export function counterLabel(kind: string): string {
  if (!GLYPHS.has(kind)) return kind;
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Disc colours for named counters. Fixed, not themed: a disc sits on card
 *  art, the same ruling as the P/T plates. Each clears 4.5:1 against white. */
const DISC_COLORS = [
  '#be185d',
  '#047857',
  '#1d4ed8',
  '#b45309',
  '#6d28d9',
  '#b91c1c',
  '#0e7490',
  '#4d7c0f',
];

/** A named counter keeps its colour for as long as it keeps its name, so
 *  "Counter 1" is the same disc on every render and every seat. Consecutive
 *  names ("Counter 1", "Counter 2") land on neighbouring colours. */
export function counterColor(kind: string): string {
  let sum = 0;
  for (let i = 0; i < kind.length; i++) sum += kind.charCodeAt(i);
  return DISC_COLORS[sum % DISC_COLORS.length];
}

/** EDHPlay's "Add New Counter": the next unused "Counter N" on this card. */
export function nextGenericCounter(counters: Record<string, number>): string {
  let n = 1;
  while (`Counter ${n}` in counters) n++;
  return `Counter ${n}`;
}

/** Printed counters first in catalogue order (the body counters lead), then
 *  the player's own in the order they were added. */
export function sortCounters(counters: Record<string, number>): Array<[string, number]> {
  const order = (k: string) => {
    const i = COUNTER_CATALOG.findIndex((c) => c.kind === k);
    return i < 0 ? COUNTER_CATALOG.length : i;
  };
  return Object.entries(counters)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => order(a) - order(b));
}
