/**
 * Plan a shelf (E496): a whole-collection multi-binder planner. Given the
 * user's cards, their EXISTING binders and a chosen strategy, this proposes
 * an ordered set of new binders — each with a real would-land count and page
 * count from the REAL routing engine — with a catch-all last so the plan
 * always reports "0 left over". The proposed binders are placed AFTER the
 * user's existing ones (existing binders keep first-match-wins priority).
 *
 * Pure and side-effect free: nothing here touches the store. The planner UI
 * (`PlanShelfModal`) opens on `defaultShelfPlan`, calls `computeShelfPlan`
 * once the user changes a row, and hands the result's `toCreate` list to the
 * store's `createBinders`. A row that would land nothing is never created.
 */
import type { BinderDef, BinderFilter, BinderInput, ChipExpression, EnrichedCard } from '../types';
import type { SetMap } from './api';
import { materializeBinders } from './materialize';
import { cardMatchesAnyGroup, compileFilterGroups } from './rules';
import { SORT_PRESETS } from './sorting';
import { sortOrderSummaryLabel } from './sort-order-label';
import { TYPE_ORDER } from './card-types';
import { COLOR_INFO } from './colors';
import { volumesFor } from './binder-volumes';
import type { Volume } from '../types';

const chip = (value: string, negate = false): ChipExpression => ({
  chips: [{ value, negate }],
  joiners: [],
});

function sortsFor(presetId: string) {
  return SORT_PRESETS.find((p) => p.id === presetId)?.sorts ?? [];
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

export type ShelfStrategyId = 'by-color' | 'by-set' | 'by-type' | 'value-then-color';

export interface ShelfStrategy {
  id: ShelfStrategyId;
  name: string;
  description: string;
}

export const SHELF_STRATEGIES: readonly ShelfStrategy[] = [
  {
    id: 'by-color',
    name: 'By color',
    description: 'White, blue, black, red, green, then multicolor. Lands and colorless last.',
  },
  {
    id: 'by-set',
    name: 'By set',
    description: 'Your biggest sets each get their own binder, in number order inside.',
  },
  {
    id: 'by-type',
    name: 'By card type',
    description: 'Creatures, instants, sorceries and the rest, by mana value inside.',
  },
  {
    id: 'value-then-color',
    name: 'Value first, then color',
    description: 'Priciest cards peel off into value binders first; everything else by color.',
  },
];

// ---------------------------------------------------------------------------
// Pull-outs — optional rows offered ahead of every strategy's split, reorderable.
// ---------------------------------------------------------------------------

export type PullOutId = 'value' | 'commanders' | 'lands';

export interface ShelfRowDef {
  id: string;
  name: string;
  filter: BinderFilter;
  /** A `SORT_PRESETS` id. The row shows that named order's own name (via
   *  `sortOrderSummaryLabel`), the same words the binder's sort pill and the
   *  editor's Order summary will show once it exists. */
  sortPresetId: string;
  /** Swatch color for the row / shelf spine. */
  color: string;
}

export const SHELF_PULL_OUTS: readonly (ShelfRowDef & { id: PullOutId })[] = [
  {
    id: 'value',
    name: 'Worth $5 or more',
    filter: { priceMin: 5 },
    sortPresetId: 'most-valuable',
    color: '#c9a94a',
  },
  {
    id: 'commanders',
    name: 'Commanders',
    filter: { commanderEligible: true },
    sortPresetId: 'by-color',
    color: '#3f8c58',
  },
  {
    id: 'lands',
    name: 'Lands',
    filter: { typeTokenChips: chip('land') },
    sortPresetId: 'by-color',
    color: '#8a7458',
  },
];

/** Which pull-outs are checked by default for a strategy. `value-then-color`
 *  already peels off value as its own tiered split, so pre-checking the
 *  Worth-$5+ pull-out on top of it would just make its own tiers empty. */
const DEFAULT_PULL_OUTS: Record<ShelfStrategyId, PullOutId[]> = {
  'by-color': ['value', 'commanders'],
  'by-set': ['value', 'commanders'],
  'by-type': ['value', 'commanders'],
  'value-then-color': ['commanders'],
};

export function defaultPullOutOrder(): PullOutId[] {
  return SHELF_PULL_OUTS.map((p) => p.id);
}

/** The rows a strategy proposes before any counting: its default pull-outs,
 *  plus every one of its split rows (the catch-all is implicit and never
 *  appears in this set — see `computeShelfPlan`). `defaultShelfPlan` then
 *  drops every one of these that would land nothing. */
function candidateRows(
  strategy: ShelfStrategyId,
  pile: EnrichedCard[],
  setMap: SetMap | undefined
): Set<string> {
  const checked = new Set<string>(DEFAULT_PULL_OUTS[strategy]);
  for (const row of splitBucketsFor(strategy, pile, setMap)) checked.add(row.id);
  return checked;
}

// ---------------------------------------------------------------------------
// Split buckets — one per strategy. Deterministic given the pile + set map.
// ---------------------------------------------------------------------------

export const CATCH_ALL_ID = 'catch-all';

const notLand = chip('land', true);

const COLOR_KEYS = ['W', 'U', 'B', 'R', 'G', 'M'] as const;

/**
 * W/U/B/R/G mono binders plus one Multicolor binder, each ONE rule group:
 * `colors IS <key>` (the "Color group" field — a chip expression over
 * `getColorKey`'s per-card bucket, `packages/binder-routing/src/rules.ts` /
 * `colors.ts`) AND `typeTokenChips NOT land`.
 *
 * Deliberately NOT `colorIdentity` (the modern exact-combo rule the ground-
 * truth audit introduced for one-off "Save as binder" filters, #2351): that
 * rule can only express ONE specific color combo per group, so a Multicolor
 * binder needs the OR of all 26 non-mono combinations — 26 rules a user
 * opening "Binder rules" would have to read. `colors`/`getColorKey` is
 * already the SAME bucket the Color sort's sections use and the chooser's
 * "One color" tile reads, so reusing it here doesn't introduce a new
 * classification, just a plain, single-rule binder. A `?` (no Scryfall
 * color data) card reports `colors` as `''` internally (rules.ts), which
 * matches no IS chip, so it falls through every color binder to the
 * catch-all — never vanishes, never gets its own bucket.
 *
 * A catch-all last (colorless + every land, regardless of the land's own
 * color identity) keeps lands off the color shelf entirely, matching the
 * "Lands" pull-out's own job.
 */
function colorSplitBuckets(): ShelfRowDef[] {
  return COLOR_KEYS.map((k) => ({
    id: `color-${k.toLowerCase()}`,
    name: COLOR_INFO[k].label,
    filter: { colors: chip(k.toLowerCase()), typeTokenChips: notLand },
    sortPresetId: 'a-to-z',
    color: COLOR_INFO[k].pip,
  }));
}

const TYPE_LABEL: Record<string, string> = {
  creature: 'Creatures',
  planeswalker: 'Planeswalkers',
  instant: 'Instants',
  sorcery: 'Sorceries',
  enchantment: 'Enchantments',
  artifact: 'Artifacts',
  land: 'Lands',
  battle: 'Battles',
};

const TYPE_COLOR: Record<string, string> = {
  creature: '#3f8c58',
  planeswalker: '#d65a9a',
  instant: '#3a85cc',
  sorcery: '#d8442a',
  enchantment: '#d9c469',
  artifact: '#a8b0bc',
  land: '#8a7458',
  battle: '#8a5bd6',
};

/** One binder per primary type, in `TYPE_ORDER`'s own precedence (the same
 *  order `getCardType` resolves an artifact creature by) so an ambiguous card
 *  lands exactly where the single-card classifier already says it belongs —
 *  first-match-wins reproduces `getCardType` by construction. `'other'` is
 *  not a real token to match against; it becomes the catch-all instead. */
function typeSplitBuckets(): ShelfRowDef[] {
  return TYPE_ORDER.filter((t) => t !== 'other').map((t) => ({
    id: `type-${t}`,
    name: TYPE_LABEL[t] ?? t,
    filter: { typeTokenChips: chip(t) },
    sortPresetId: 'by-type',
    color: TYPE_COLOR[t] ?? '#a8b0bc',
  }));
}

const MIN_SET_BINDER_COUNT = 30;
const MAX_SET_BINDERS = 6;

/**
 * One binder per set is unusable (a collection spans hundreds of sets); one
 * per year/block reads clean on paper but doesn't map to how anyone actually
 * shelves cards, and still produces 20-30 binders for an older collection.
 * Instead: the user's own biggest sets (the ones that are genuinely a
 * binder's worth of cards on their shelf) each get one, oldest-set-first
 * inside; everything else — every other set — is one binder, still ordered
 * by Set collection so it still reads set-by-set even though it isn't split
 * further.
 */
function setSplitBuckets(pile: EnrichedCard[], setMap: SetMap | undefined): ShelfRowDef[] {
  const counts = new Map<string, number>();
  for (const c of pile) {
    if (!c.setCode) continue;
    counts.set(c.setCode, (counts.get(c.setCode) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .filter(([, n]) => n >= MIN_SET_BINDER_COUNT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_SET_BINDERS);

  return top.map(([code], i) => ({
    id: `set-${code}`,
    name: setMap?.[code.toUpperCase()]?.name ?? code.toUpperCase(),
    filter: { setCodes: [code] },
    sortPresetId: 'set-collection',
    // A muted, evenly-spaced palette independent of any card's own colors —
    // these binders are grouped by printing, not by color.
    color: ['#7391da', '#9c7ad6', '#5aa6c9', '#c98a5a', '#5ab08a', '#c96a8a'][i % 6],
  }));
}

const PRICE_TIERS: { id: string; name: string; priceMin: number; color: string }[] = [
  { id: 'price-20', name: 'Worth $20 or more', priceMin: 20, color: '#c9a94a' },
  { id: 'price-5', name: 'Worth $5 to $20', priceMin: 5, color: '#d4bb6e' },
  { id: 'price-1', name: 'Worth $1 to $5', priceMin: 1, color: '#e0cf96' },
];

/** Price tiers first (highest first — first-match-wins means a lower tier's
 *  `priceMin` only ever sees what the tier above it didn't already take, so
 *  no `priceMax` upper bound is needed), then the same color split as
 *  `by-color` for whatever's left (mostly sub-$1 and unpriced cards). */
function valueThenColorBuckets(): ShelfRowDef[] {
  const tiers: ShelfRowDef[] = PRICE_TIERS.map((t) => ({
    id: t.id,
    name: t.name,
    filter: { priceMin: t.priceMin },
    sortPresetId: 'most-valuable',
    color: t.color,
  }));
  return [...tiers, ...colorSplitBuckets()];
}

function catchAllBucket(strategy: ShelfStrategyId): ShelfRowDef {
  return {
    id: CATCH_ALL_ID,
    name: 'Everything else',
    filter: {},
    sortPresetId: strategy === 'by-type' ? 'a-to-z' : 'by-type',
    color: COLOR_INFO.C.pip,
  };
}

/** The strategy's split rows, in their fixed (non-reorderable) order — the
 *  catch-all is NOT included here; callers append it once, last. */
export function splitBucketsFor(
  strategy: ShelfStrategyId,
  pile: EnrichedCard[],
  setMap: SetMap | undefined
): ShelfRowDef[] {
  switch (strategy) {
    case 'by-color':
      return colorSplitBuckets();
    case 'by-set':
      return setSplitBuckets(pile, setMap);
    case 'by-type':
      return typeSplitBuckets();
    case 'value-then-color':
      return valueThenColorBuckets();
  }
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface ShelfPlanRow {
  id: string;
  name: string;
  /** The row's order in words: the named order's own name ("A to Z",
   *  "Most valuable first"), from the same `sortOrderSummaryLabel` the sort
   *  pill and the editor's Order summary read. */
  orderLabel: string;
  color: string;
  section: 'pull-out' | 'split' | 'catch-all';
  checked: boolean;
  /** Cards this row lands. A checked row's count is the real, engine-computed
   *  figure that would be created. An unchecked row's is exactly what it
   *  would hold if you checked it now: the cards that get past every existing
   *  binder and every checked row above it and match its rule. Informational
   *  only, never in the totals or the create list. */
  count: number;
  pages: number;
  volumes: Volume[] | null;
  /** True when this row becomes a binder on Create: checked AND it lands at
   *  least one card. A checked row that lands nothing is never created
   *  (an empty binder is shelf clutter), and it isn't counted anywhere. */
  creates: boolean;
}

export interface ShelfPlanTotals {
  /** Binders Create makes: the rows that are checked and land cards. */
  binderCount: number;
  cardCount: number;
  /** Always 0 in a well-formed plan (the catch-all is always active) — kept
   *  as a real number, not a boolean, so a test can assert it rather than
   *  trust the invariant blindly. */
  leftOver: number;
}

export interface ShelfPlan {
  rows: ShelfPlanRow[];
  totals: ShelfPlanTotals;
  /** Binder inputs for every row that `creates`, in final shelf order, ready
   *  for the store's `createBinders` (positions still need
   *  `existingCount + index`, applied by the caller at create time since the
   *  planner never assumes the binder count is stable between preview and
   *  click). */
  toCreate: (existingCount: number) => BinderInput[];
}

const DEFAULT_POCKET_SIZE = 9;
/** Every proposed binder defaults to the standard 360-card 9-pocket size, so
 *  the plan's volumes note ("White · 3 volumes of 360") means something out
 *  of the gate — a brand-new binder with no capacity never needs volumes. */
export const DEFAULT_PLAN_CAPACITY = 360;

/**
 * The editor's own collision prompt only fires for its import-batch flow, so
 * it isn't reusable here — but the same "don't silently shadow an existing
 * binder" concern applies to a batch create. Disambiguates in shelf order:
 * "White" becomes "White 2" if a binder named "White" already exists (or an
 * earlier row in this same plan already claimed the name), "White 3" if that
 * one's taken too.
 */
function dedupeNames(names: string[], existingNames: readonly string[]): string[] {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return names.map((name) => {
    if (!taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase());
      return name;
    }
    let i = 2;
    while (taken.has(`${name} ${i}`.toLowerCase())) i++;
    const unique = `${name} ${i}`;
    taken.add(unique.toLowerCase());
    return unique;
  });
}

/**
 * Every proposed binder is exactly one rule group — the design goal being a
 * plan a user can open "Binder rules" on and immediately read, not a hidden
 * OR-list. `at-most-2-groups.test.ts`-style guard lives in shelf-plan.test.ts.
 */
function rowToInput(row: ShelfRowDef, color: string): BinderInput {
  return {
    name: row.name,
    position: 0, // overwritten by the caller
    filterGroups: [{ filter: row.filter }],
    sorts: sortsFor(row.sortPresetId),
    pocketSize: DEFAULT_POCKET_SIZE,
    doubleSided: false,
    fixedCapacity: DEFAULT_PLAN_CAPACITY,
    color,
  };
}

export interface ComputeShelfPlanInput {
  strategy: ShelfStrategyId;
  /** All three pull-out ids, in the user's current (reorderable) order. */
  pullOutOrder: PullOutId[];
  /** Which pull-out AND split row ids are checked. The catch-all is always
   *  active regardless of this set. */
  checked: ReadonlySet<string>;
  pile: EnrichedCard[];
  existingBinders: BinderDef[];
  allocatedCopyIds?: ReadonlySet<string>;
  setMap?: SetMap;
}

/**
 * Computes the full plan: every row's would-land count (real engine,
 * existing binders placed first and kept at their own positions), the
 * totals, and a `toCreate` builder for the rows that will become binders.
 */
export function computeShelfPlan(input: ComputeShelfPlanInput): ShelfPlan {
  const { strategy, pullOutOrder, checked, pile, existingBinders, allocatedCopyIds, setMap } =
    input;

  const pullOutRows = pullOutOrder
    .map((id) => SHELF_PULL_OUTS.find((p) => p.id === id))
    .filter((r): r is ShelfRowDef & { id: PullOutId } => !!r);
  const splitRows = splitBucketsFor(strategy, pile, setMap);
  const catchAll = catchAllBucket(strategy);

  const allRows: { row: ShelfRowDef; section: ShelfPlanRow['section'] }[] = [
    ...pullOutRows.map((row) => ({ row, section: 'pull-out' as const })),
    ...splitRows.map((row) => ({ row, section: 'split' as const })),
    { row: catchAll, section: 'catch-all' as const },
  ];

  const basePosition =
    existingBinders.length === 0 ? 0 : Math.max(...existingBinders.map((b) => b.position)) + 1;

  const now = Date.now();
  const planId = (row: ShelfRowDef) => `__plan_${row.id}__`;
  const buildDef = (row: ShelfRowDef, position: number): BinderDef => ({
    ...rowToInput(row, row.color),
    id: planId(row),
    position,
    createdAt: now,
    updatedAt: now,
  });
  const isChecked = (row: ShelfRowDef, section: ShelfPlanRow['section']) =>
    section === 'catch-all' || checked.has(row.id);

  // The REAL plan: existing binders first, then only the checked rows (and
  // the always-on catch-all), in final order.
  const checkedRows = allRows.filter(({ row, section }) => isChecked(row, section));
  const checkedDefs = checkedRows.map(({ row }, i) => buildDef(row, basePosition + i));
  const realResult = materializeBinders([...pile], [...existingBinders, ...checkedDefs], {
    search: '',
    allocatedCopyIds,
    setMap,
  });
  const realById = new Map(realResult.binders.map((b) => [b.def.id, b]));

  // Which plan row (by its index in `allRows`) claimed each copy. A copy an
  // existing binder claims, or one a hide-deck-cards binder swallowed, is in
  // no plan row and never reaches one.
  const rowIndexById = new Map(allRows.map(({ row }, i) => [planId(row), i]));
  const claimedAt = new Map<string, number>();
  for (const b of realResult.binders) {
    const i = rowIndexById.get(b.def.id);
    if (i === undefined) continue;
    for (const section of b.sections) for (const c of section.cards) claimedAt.set(c.copyId, i);
  }

  // An unchecked row's count is what it would hold if checked now: routing is
  // first-match-wins, so inserting it takes exactly the copies that reach its
  // slot (claimed by a checked row BELOW it) and match its rule, and changes
  // nothing above it. Pre-filtered here so the engine only sorts the copies
  // it would actually hold, not the whole remainder.
  const ifChecked = (row: ShelfRowDef, index: number) => {
    const def = buildDef(row, 0);
    const compiled = compileFilterGroups(def.filterGroups);
    const reaching = pile.filter(
      (c) => (claimedAt.get(c.copyId) ?? -1) > index && cardMatchesAnyGroup(c, compiled)
    );
    return materializeBinders(reaching, [def], { search: '', allocatedCopyIds, setMap }).binders[0];
  };

  const rows: ShelfPlanRow[] = allRows.map(({ row, section }, index) => {
    const on = isChecked(row, section);
    const materialized = on ? realById.get(planId(row)) : ifChecked(row, index);
    const count = materialized?.totalCards ?? 0;
    return {
      id: row.id,
      name: row.name,
      orderLabel: sortOrderSummaryLabel(sortsFor(row.sortPresetId)),
      color: row.color,
      section,
      checked: on,
      count,
      pages: materialized?.totalPages ?? 0,
      volumes: materialized ? volumesFor(materialized) : null,
      creates: on && count > 0,
    };
  });

  // Only rows that land cards become binders. Dropping a checked row that
  // lands nothing changes no other row's count (it claimed no copy), so the
  // totals and `toCreate` stay exactly what the engine routed above. The
  // catch-all is no exception: when it lands nothing there is nothing left
  // over without it either.
  const creating = allRows.filter((_, i) => rows[i].creates);
  // Sum only the PLAN's own binders — `realResult.binders` also carries the
  // user's existing binders (placed first so they keep priority), whose
  // cards are already spoken for and must not inflate what the plan itself
  // reports it will create.
  const cardCount = rows.reduce((n, r) => n + (r.creates ? r.count : 0), 0);

  return {
    rows,
    totals: {
      binderCount: creating.length,
      cardCount,
      leftOver: realResult.uncategorized.totalCards,
    },
    toCreate: (existingCount: number) => {
      const names = dedupeNames(
        creating.map(({ row }) => row.name),
        existingBinders.map((b) => b.name)
      );
      return creating.map(({ row }, i) => ({
        ...rowToInput(row, row.color),
        name: names[i],
        position: existingCount + i,
      }));
    },
  };
}

export type DefaultShelfPlanInput = Omit<ComputeShelfPlanInput, 'checked'>;

/**
 * The plan a strategy opens with, and the rows it checks. Every proposed row
 * starts checked EXCEPT one that would land nothing: an empty binder is never
 * offered as a default. Unchecking those changes no other row's count (they
 * claim no copy), so this is one engine pass, not two, and the returned plan
 * is exactly `computeShelfPlan` with the returned `checked` set.
 */
export function defaultShelfPlan(input: DefaultShelfPlanInput): {
  checked: Set<string>;
  plan: ShelfPlan;
} {
  const candidates = candidateRows(input.strategy, input.pile, input.setMap);
  const plan = computeShelfPlan({ ...input, checked: candidates });
  const checked = new Set<string>();
  for (const row of plan.rows) {
    if (row.section !== 'catch-all' && row.checked && row.count > 0) checked.add(row.id);
  }
  return {
    checked,
    plan: {
      ...plan,
      rows: plan.rows.map((r) =>
        r.section === 'catch-all' || checked.has(r.id) ? r : { ...r, checked: false }
      ),
    },
  };
}

/** Every card in the pile counted once across `toCreate`'s binders plus
 *  leftover — the invariant a guard test asserts directly against the real
 *  engine rather than trusting the plan's own arithmetic. */
export function totalCopiesPlanned(plan: ShelfPlan): number {
  return plan.totals.cardCount + plan.totals.leftOver;
}
