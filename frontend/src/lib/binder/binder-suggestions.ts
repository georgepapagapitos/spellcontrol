import type { BinderFilter, ChipExpression, EnrichedCard } from '@/types/index';
import { cardMatchesAnyGroup, compileFilterGroups } from '@spellcontrol/binder-routing';

/**
 * A binder the Uncategorized pile could become: one rule, the name it would
 * start with, and how many of the pile's cards it would take.
 */
export interface BinderSuggestion {
  id: string;
  name: string;
  /** The rule in the words the rules editor uses for it. */
  description: string;
  filter: BinderFilter;
  /** Cards in the pile this rule matches, counted by the real rule engine. */
  count: number;
}

/** Kinds compete for a slot, so three suggestions are three different ideas,
 *  never "White, Blue, Black". */
type Kind = 'type' | 'color' | 'rarity' | 'price';

interface Candidate extends Omit<BinderSuggestion, 'count'> {
  kind: Kind;
}

const chip = (value: string): ChipExpression => ({
  chips: [{ value, negate: false }],
  joiners: [],
});

const TYPES: [string, string][] = [
  ['land', 'Lands'],
  ['creature', 'Creatures'],
  ['instant', 'Instants'],
  ['sorcery', 'Sorceries'],
  ['artifact', 'Artifacts'],
  ['enchantment', 'Enchantments'],
  ['planeswalker', 'Planeswalkers'],
];

const COLORS: [string, string][] = [
  ['W', 'White'],
  ['U', 'Blue'],
  ['B', 'Black'],
  ['R', 'Red'],
  ['G', 'Green'],
];

const CANDIDATES: Candidate[] = [
  ...TYPES.map(([value, name]): Candidate => ({
    id: `type-${value}`,
    kind: 'type',
    name,
    description: `Card type: ${value}`,
    filter: { typeTokenChips: chip(value) },
  })),
  ...COLORS.map(([color, name]): Candidate => ({
    id: `color-${color}`,
    kind: 'color',
    name,
    description: `Color identity: only ${name.toLowerCase()}`,
    filter: { colorIdentity: { colors: [color], mode: 'all' } },
  })),
  {
    id: 'rares',
    kind: 'rarity',
    name: 'Rares & mythics',
    description: 'Rarity: rare or mythic',
    filter: {
      rarities: {
        chips: [
          { value: 'rare', negate: false },
          { value: 'mythic', negate: false },
        ],
        joiners: ['OR'],
      },
    },
  },
  {
    id: 'value',
    kind: 'price',
    name: 'Cards worth $1+',
    description: 'Price ≥ $1',
    filter: { priceMin: 1 },
  },
];

/** Below this a suggested binder is a handful of pockets, not a binder. */
export const MIN_SUGGESTION_COUNT = 3;

/**
 * Up to `max` binders worth making from the cards no binder takes, biggest
 * first, at most one per kind (card type, color, rarity, price). Each count
 * runs the real rule engine over the pile, so the editor's "N cards land here"
 * agrees with it once the binder is created: a new binder goes to the bottom
 * of the list, and nothing above it takes these cards.
 */
export function suggestBinders(pile: EnrichedCard[], max = 3): BinderSuggestion[] {
  if (pile.length < MIN_SUGGESTION_COUNT) return [];
  const bestByKind = new Map<Kind, BinderSuggestion>();
  for (const { kind, ...candidate } of CANDIDATES) {
    const compiled = compileFilterGroups([{ filter: candidate.filter }]);
    let count = 0;
    for (const card of pile) if (cardMatchesAnyGroup(card, compiled)) count++;
    if (count < MIN_SUGGESTION_COUNT) continue;
    const best = bestByKind.get(kind);
    // Strictly greater: on a tie the earlier candidate (the list's own order)
    // keeps the slot, so the answer never depends on iteration luck.
    if (!best || count > best.count) bestByKind.set(kind, { ...candidate, count });
  }
  return [...bestByKind.values()].sort((a, b) => b.count - a.count).slice(0, max);
}
