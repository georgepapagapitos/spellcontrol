import type { BinderFilter } from '../types';

/**
 * The rule vocabulary, as data.
 *
 * The binder/list rule editor used to render all 22 of these as a fixed form:
 * five rows always visible and seventeen behind a "More rules" triangle, every
 * one of them taking a full row whether or not it held a value. A binder with
 * a single rule showed twenty-one empty controls, and the only signal that
 * something was set below the fold was one dot on the disclosure.
 *
 * Now a row renders when its field has a value (or the user just added it), and
 * everything else lives behind a searchable picker. That needs three things per
 * field which the JSX cannot answer on its own: what to call it, where it sits
 * in the picker, and how to tell whether it is set / clear it.
 */
export type FilterFieldId =
  | 'typeChips'
  | 'supertypeChips'
  | 'typeTokenChips'
  | 'subtypeChips'
  | 'colors'
  | 'commanderEligible'
  | 'cmc'
  | 'manaCost'
  | 'nameContains'
  | 'oracleChips'
  | 'oracleTagChips'
  | 'rarities'
  | 'setCodes'
  | 'layouts'
  | 'treatments'
  | 'borderColors'
  | 'finishes'
  | 'price'
  | 'edhrecRankMax'
  | 'legalities'
  | 'proxy'
  | 'scryfallQuery';

/** Picker sections, in the order they appear. Most-reached-for first. */
export const FILTER_FIELD_GROUPS = [
  'Identity',
  'Cost',
  'Text',
  'Printing',
  'Value & play',
  'Advanced',
] as const;

export type FilterFieldGroup = (typeof FILTER_FIELD_GROUPS)[number];

export interface FilterFieldSpec {
  id: FilterFieldId;
  label: string;
  group: FilterFieldGroup;
  /**
   * Shown under the label in the picker. Present only where the name alone
   * doesn't settle it — which is most of the point for the four type fields,
   * whose names ("Type line", "Supertype", "Type", "Subtype") are close enough
   * that nothing on screen used to say which one you wanted.
   */
  hint?: string;
  /** Extra words that should match this field in the picker's search. */
  keywords?: string[];
  /** True when the filter carries a value for this field. */
  isSet: (f: BinderFilter) => boolean;
  /** The patch that removes this field's value. */
  clear: () => Partial<BinderFilter>;
}

const hasChips = (e: { chips: unknown[] } | undefined) => !!e && e.chips.length > 0;

export const FILTER_FIELDS: FilterFieldSpec[] = [
  {
    id: 'typeChips',
    label: 'Type line',
    group: 'Identity',
    hint: 'Matches anywhere in the whole type line — "Legendary Creature", "Artifact — Equipment".',
    keywords: ['creature', 'artifact', 'land'],
    isSet: (f) => hasChips(f.typeChips),
    clear: () => ({ typeChips: undefined }),
  },
  {
    id: 'supertypeChips',
    label: 'Supertype',
    group: 'Identity',
    hint: 'Only the supertype word: legendary, basic, snow.',
    isSet: (f) => hasChips(f.supertypeChips),
    clear: () => ({ supertypeChips: undefined }),
  },
  {
    id: 'typeTokenChips',
    label: 'Card type',
    group: 'Identity',
    hint: 'Only the type itself: creature, instant, land.',
    isSet: (f) => hasChips(f.typeTokenChips),
    clear: () => ({ typeTokenChips: undefined }),
  },
  {
    id: 'subtypeChips',
    label: 'Subtype',
    group: 'Identity',
    hint: 'Only the subtype after the dash: angel, equipment, forest.',
    isSet: (f) => hasChips(f.subtypeChips),
    clear: () => ({ subtypeChips: undefined }),
  },
  {
    id: 'colors',
    label: 'Color identity',
    group: 'Identity',
    keywords: ['wubrg', 'mono', 'multicolor', 'colourless'],
    isSet: (f) => hasChips(f.colors),
    clear: () => ({ colors: undefined }),
  },
  {
    id: 'commanderEligible',
    label: 'Commander',
    group: 'Identity',
    hint: 'Whether the card can legally be your commander.',
    isSet: (f) => f.commanderEligible !== undefined,
    clear: () => ({ commanderEligible: undefined }),
  },
  {
    id: 'cmc',
    label: 'Mana value',
    group: 'Cost',
    hint: 'The number in the corner, as a range.',
    keywords: ['cmc', 'converted'],
    isSet: (f) => f.cmcMin !== undefined || f.cmcMax !== undefined,
    clear: () => ({ cmcMin: undefined, cmcMax: undefined }),
  },
  {
    id: 'manaCost',
    label: 'Mana cost',
    group: 'Cost',
    hint: 'The exact symbols, e.g. {2}{G}{W}.',
    keywords: ['pips', 'symbols'],
    isSet: (f) => !!f.manaCost?.trim(),
    clear: () => ({ manaCost: undefined }),
  },
  {
    id: 'nameContains',
    label: 'Name contains',
    group: 'Text',
    isSet: (f) => !!f.nameContains?.trim(),
    clear: () => ({ nameContains: undefined }),
  },
  {
    id: 'oracleChips',
    label: 'Oracle text',
    group: 'Text',
    hint: 'Words in the rules text.',
    keywords: ['rules', 'ability'],
    isSet: (f) => hasChips(f.oracleChips),
    clear: () => ({ oracleChips: undefined }),
  },
  {
    id: 'oracleTagChips',
    label: 'Oracle tags',
    group: 'Text',
    hint: "Scryfall's curated concepts — more precise than searching the text.",
    keywords: ['otag', 'ramp', 'removal', 'mana rock'],
    isSet: (f) => hasChips(f.oracleTagChips),
    clear: () => ({ oracleTagChips: undefined }),
  },
  {
    id: 'rarities',
    label: 'Rarity',
    group: 'Printing',
    keywords: ['common', 'uncommon', 'rare', 'mythic'],
    isSet: (f) => hasChips(f.rarities),
    clear: () => ({ rarities: undefined }),
  },
  {
    id: 'setCodes',
    label: 'Sets',
    group: 'Printing',
    keywords: ['expansion', 'edition'],
    isSet: (f) => !!f.setCodes && f.setCodes.length > 0,
    clear: () => ({ setCodes: undefined }),
  },
  {
    id: 'layouts',
    label: 'Layout',
    group: 'Printing',
    hint: 'Split, transform, adventure, and friends.',
    isSet: (f) => hasChips(f.layouts),
    clear: () => ({ layouts: undefined }),
  },
  {
    id: 'treatments',
    label: 'Treatment',
    group: 'Printing',
    hint: 'Showcase, borderless, extended art.',
    isSet: (f) => hasChips(f.treatments),
    clear: () => ({ treatments: undefined }),
  },
  {
    id: 'borderColors',
    label: 'Border',
    group: 'Printing',
    isSet: (f) => hasChips(f.borderColors),
    clear: () => ({ borderColors: undefined }),
  },
  {
    id: 'finishes',
    label: 'Finish',
    group: 'Printing',
    keywords: ['foil', 'etched', 'nonfoil'],
    isSet: (f) => hasChips(f.finishes),
    clear: () => ({ finishes: undefined }),
  },
  {
    id: 'price',
    label: 'Price',
    group: 'Value & play',
    hint: 'Market price, as a range.',
    keywords: ['value', 'cost', 'money'],
    isSet: (f) => f.priceMin !== undefined || f.priceMax !== undefined,
    clear: () => ({ priceMin: undefined, priceMax: undefined }),
  },
  {
    id: 'edhrecRankMax',
    label: 'EDHREC popularity',
    group: 'Value & play',
    hint: 'Only the top N most-played cards in Commander.',
    keywords: ['staple', 'popular'],
    isSet: (f) => f.edhrecRankMax !== undefined,
    clear: () => ({ edhrecRankMax: undefined }),
  },
  {
    id: 'legalities',
    label: 'Format',
    group: 'Value & play',
    keywords: ['commander', 'modern', 'pioneer', 'standard', 'format'],
    isSet: (f) => hasChips(f.legalities),
    clear: () => ({ legalities: undefined }),
  },
  {
    id: 'proxy',
    label: 'Proxy',
    group: 'Value & play',
    hint: 'Whether the copy is a proxy.',
    isSet: (f) => f.proxy !== undefined,
    clear: () => ({ proxy: undefined }),
  },
  {
    id: 'scryfallQuery',
    label: 'Scryfall query',
    group: 'Advanced',
    hint: 'Any Scryfall search, snapshot to the cards you own.',
    keywords: ['search', 'is:', 'syntax'],
    isSet: (f) => !!f.scryfallQuery?.query.trim(),
    clear: () => ({ scryfallQuery: undefined }),
  },
];

const BY_ID = new Map(FILTER_FIELDS.map((f) => [f.id, f]));

export function filterFieldSpec(id: FilterFieldId): FilterFieldSpec | undefined {
  return BY_ID.get(id);
}

/** Every field this filter currently carries a value for. */
export function setFilterFields(f: BinderFilter): Set<FilterFieldId> {
  return new Set(FILTER_FIELDS.filter((spec) => spec.isSet(f)).map((spec) => spec.id));
}

/**
 * Fields matching a picker query, grouped and in registry order. An empty query
 * returns everything. Matches label, hint and keywords, so "foil" finds Finish
 * and "cmc" finds Mana value.
 */
export function searchFilterFields(
  query: string,
  exclude: ReadonlySet<FilterFieldId>
): Array<{ group: FilterFieldGroup; fields: FilterFieldSpec[] }> {
  const q = query.trim().toLowerCase();
  const matches = (spec: FilterFieldSpec) => {
    if (exclude.has(spec.id)) return false;
    if (!q) return true;
    return (
      spec.label.toLowerCase().includes(q) ||
      spec.hint?.toLowerCase().includes(q) === true ||
      spec.keywords?.some((k) => k.includes(q)) === true
    );
  };
  return FILTER_FIELD_GROUPS.map((group) => ({
    group,
    fields: FILTER_FIELDS.filter((spec) => spec.group === group && matches(spec)),
  })).filter((section) => section.fields.length > 0);
}
