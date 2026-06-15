import type { BinderFilter, ChipExpression } from '../types';

/**
 * One-tap starter templates for a new binder's first rule group. Each either
 * pre-fills a concrete constraint (`filter`) or runs an action (`revealSets`).
 *
 * ⚠️ A `filter` template must impose a real constraint — a template whose
 * filter cleans down to empty would silently match the whole collection (the
 * "A set binder" trap). `binder-templates.test.ts` guards this.
 */
export interface StarterTemplate {
  id: string;
  label: string;
  description: string;
  /** One-tap concrete constraint. Omitted for action-only templates. */
  filter?: Partial<BinderFilter>;
  /**
   * Action template: instead of a constraint, open the "More rules" section
   * and scroll the Sets picker into view. "A set" can't be a one-tap constant
   * (there's no universal set), so this is an honest "take me to the picker"
   * shortcut rather than an empty filter that matches everything.
   */
  revealSets?: boolean;
}

const tagChip = (...tags: string[]): ChipExpression => ({
  chips: tags.map((value) => ({ value, negate: false })),
  joiners: tags.slice(1).map(() => 'OR' as const),
});

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'value',
    label: 'Cards worth $1+',
    description: 'Price ≥ $1',
    filter: { priceMin: 1 },
  },
  {
    id: 'rares',
    label: 'Rares & mythics',
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
    id: 'one-color',
    label: 'One color',
    description: 'Single-color cards — pick your color after',
    filter: {
      colors: {
        chips: [{ value: 'W', negate: false }],
        joiners: [],
      },
    },
  },
  // Oracle-tag (otag) starters — precise semantic concepts from Scryfall's
  // curated tags, far better than oracle-text substrings. Each pre-fills the
  // Oracle tags rule, which auto-opens the "More rules" section.
  {
    id: 'mana-rocks',
    label: 'Mana rocks',
    description: 'Artifacts that make mana',
    filter: { oracleTagChips: tagChip('mana-rock') },
  },
  {
    id: 'removal',
    label: 'Removal & counters',
    description: 'Removal or counterspells',
    filter: { oracleTagChips: tagChip('removal', 'counterspell') },
  },
  {
    id: 'ramp',
    label: 'Ramp',
    description: 'Mana rocks, dorks & ramp',
    filter: { oracleTagChips: tagChip('ramp', 'mana-rock', 'mana-dork') },
  },
  {
    id: 'set',
    label: 'A set binder',
    description: 'Pick a specific set',
    revealSets: true,
  },
];
