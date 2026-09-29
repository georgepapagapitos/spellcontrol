import type { BinderFilter, ChipExpression } from '../types';

/**
 * One-tap starter templates for a new binder's first rule group. Each either
 * pre-fills a concrete constraint (`filter`) or runs an action (`revealSets`).
 *
 * ⚠️ A `filter` template must impose a real constraint — a template whose
 * filter cleans down to empty would silently match the whole collection (the
 * "A set binder" trap). `binder-templates.test.ts` guards this. "Blank" and
 * "Everything else" are deliberately NOT in this list for that reason — an
 * empty filter is exactly what they mean, so they're separate `BinderStart`
 * kinds in `BinderStartChooser.tsx` rather than templates that would fail the
 * guard on purpose.
 *
 * The chooser groups templates by job (E495): `group` says which of the three
 * sections a tile sits in; a template with no `group` isn't offered here at
 * all (there are none today — every template is grouped).
 */
export type TemplateGroup = 'pull' | 'slice' | 'pool';

export interface StarterTemplate {
  id: string;
  label: string;
  description: string;
  group: TemplateGroup;
  /** One-tap concrete constraint. Omitted for action-only templates. */
  filter?: Partial<BinderFilter>;
  /**
   * Action template: instead of a constraint, add an empty Sets condition
   * and bring it into view. "A set" can't be a one-tap constant
   * (there's no universal set), so this is an honest "take me to the picker"
   * shortcut rather than an empty filter that matches everything.
   */
  revealSets?: boolean;
  /**
   * This tile needs a color chosen on the tile before its filter and count
   * mean anything — `BinderStartChooser` renders the pip row and builds the
   * filter from the pick (E473: no more silent white).
   */
  colorPick?: boolean;
  /**
   * A `SORT_PRESETS` id: the order this tile promises and seeds on creation.
   * Every filter template carries one so "what will this look like" is
   * answered on the tile itself, never left at the color/name default.
   */
  sortPreset: string;
  /** Marks the created binder as offered for trade (the Trade binder tile). */
  tradeable?: boolean;
  /**
   * A standing overlap note shown under the description regardless of live
   * data — e.g. Mana rocks is a strict subset of Ramp whether or not either
   * binder exists yet. The live "would land" count (E495) covers the case
   * where an overlapping binder DOES already exist; this covers the case
   * where it doesn't, so the relationship is still said out loud.
   */
  overlapNote?: string;
}

const tagChip = (...tags: string[]): ChipExpression => ({
  chips: tags.map((value) => ({ value, negate: false })),
  joiners: tags.slice(1).map(() => 'OR' as const),
});

export const STARTER_TEMPLATES: StarterTemplate[] = [
  // ── Pull out a pile ───────────────────────────────────────────────────
  {
    id: 'value',
    label: 'Worth $1 or more',
    description: 'Cards to keep safe',
    group: 'pull',
    filter: { priceMin: 1 },
    sortPreset: 'most-valuable',
  },
  {
    id: 'trade',
    label: 'Trade binder',
    description: 'Your spare copies worth $1 or more',
    group: 'pull',
    // "Spare copies" (E495 coordinator review) is a real per-copy engine
    // decision — see @spellcontrol/binder-routing's computeSpareCopyIds — not
    // the same pile as Worth $1 or more. Also turns on the binder's real
    // `tradeable` flag, which is what actually puts it on a game night's
    // trade board.
    filter: { spareCopies: true, priceMin: 1 },
    sortPreset: 'most-valuable',
    tradeable: true,
  },
  {
    id: 'commanders',
    label: 'Commanders',
    description: 'Every legend that can lead a deck',
    group: 'pull',
    filter: { commanderEligible: true },
    sortPreset: 'by-color',
  },
  {
    id: 'rares',
    label: 'Rares & mythics',
    description: 'Rarity: rare or mythic',
    group: 'pull',
    filter: {
      rarities: {
        chips: [
          { value: 'rare', negate: false },
          { value: 'mythic', negate: false },
        ],
        joiners: ['OR'],
      },
    },
    sortPreset: 'set-collection',
  },

  // ── One slice ─────────────────────────────────────────────────────────
  {
    id: 'one-color',
    label: 'One color',
    description: 'Single-color cards',
    group: 'slice',
    colorPick: true,
    sortPreset: 'by-type',
  },
  {
    id: 'set',
    label: 'A set',
    description: 'Every card from one set, in number order',
    group: 'slice',
    revealSets: true,
    sortPreset: 'set-collection',
  },
  {
    id: 'lands',
    label: 'Lands',
    description: 'Nonbasic lands; basics stay out',
    group: 'slice',
    filter: {
      typeTokenChips: tagChip('land'),
      supertypeChips: { chips: [{ value: 'basic', negate: true }], joiners: [] },
    },
    sortPreset: 'by-color',
  },

  // ── Deck-building pools ───────────────────────────────────────────────
  {
    id: 'ramp',
    label: 'Ramp',
    description: 'Mana rocks, dorks and land search',
    group: 'pool',
    filter: { oracleTagChips: tagChip('ramp', 'mana-rock', 'mana-dork') },
    sortPreset: 'by-color',
  },
  {
    id: 'mana-rocks',
    label: 'Mana rocks only',
    description: 'Artifacts that make mana',
    group: 'pool',
    filter: { oracleTagChips: tagChip('mana-rock') },
    sortPreset: 'by-type',
    overlapNote: 'Part of Ramp',
  },
  {
    id: 'removal',
    label: 'Removal & counters',
    description: 'Removal or counterspells',
    group: 'pool',
    filter: { oracleTagChips: tagChip('removal', 'counterspell') },
    sortPreset: 'by-color',
  },
];

/** Every color-pick tile's pip row, in the same WUBRG + multicolor + colorless
 *  order as the rules editor's `colors` (legacy "Color group") field. */
export const CHOOSER_COLOR_KEYS = ['W', 'U', 'B', 'R', 'G', 'M', 'C'] as const;
export type ChooserColorKey = (typeof CHOOSER_COLOR_KEYS)[number];

/** Builds the `colors` (Color group) filter a one-color tile's pick means —
 *  one exact bucket, so "One color" never silently defaults to white (E473)
 *  and can also express Multicolor / Colorless. */
export function colorPickFilter(color: ChooserColorKey): Partial<BinderFilter> {
  return { colors: { chips: [{ value: color.toLowerCase(), negate: false }], joiners: [] } };
}
