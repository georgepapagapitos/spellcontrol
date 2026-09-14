/**
 * Filter ALGEBRA invariants — the standing guard for binder filtering, the
 * counterpart to what the 2026-09-08 sort stress audit left behind for sorting.
 *
 * These are properties, not examples. Each identity is checked by comparing the
 * engine's answer against the same answer computed with plain set operations
 * over single-chip results, so a joiner-precedence or negation bug shows up as a
 * set difference rather than as one hand-picked case nobody thought to write.
 *
 * The corpus is deliberately adversarial: it includes copies missing `setCode`,
 * `typeLine`, `cmc`, `layout`, `legalities`, `borderColor` and `oracleText`,
 * because the real ~11.5k dev collection contains exactly such copies and they
 * are what a hand-authored fixture never has.
 *
 * Derived from a run of the real collection through the real engine (11,535
 * copies, 72 identities, 61 partition checks, all holding). If you extend the
 * filter model, add the field to FIELDS below — the identities come for free.
 */
import { describe, it, expect } from 'vitest';
import {
  cardMatchesFilter,
  cardMatchesAnyGroup,
  compileFilterGroups,
  compileExpression,
  setMatchesExpression,
} from './rules.js';
import type { BinderFilter, BinderFilterGroup, ChipExpression, EnrichedCard } from './types.js';

function card(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: `c${Math.random()}`,
    name: 'Alpha',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 's1',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    typeLine: 'Creature — Human Warrior',
    oracleText: 'Flying. Draw a card.',
    layout: 'normal',
    borderColor: 'black',
    cmc: 2,
    colorIdentity: ['W'],
    colors: ['W'],
    ...overrides,
  };
}

/** A corpus wide enough that every identity below is non-trivial. */
const CORPUS: EnrichedCard[] = [
  card({
    rarity: 'rare',
    typeLine: 'Creature — Human Warrior',
    oracleText: 'Flying. Draw a card.',
  }),
  card({
    rarity: 'mythic',
    typeLine: 'Legendary Creature — Elf Druid',
    oracleText: 'Draw two cards.',
  }),
  card({ rarity: 'uncommon', typeLine: 'Instant', oracleText: 'Destroy target creature.' }),
  card({
    rarity: 'common',
    typeLine: 'Basic Land — Forest',
    oracleText: '',
    colors: [],
    colorIdentity: [],
  }),
  card({
    rarity: 'rare',
    typeLine: 'Artifact',
    oracleText: 'Flying creatures you control.',
    colors: [],
    colorIdentity: [],
  }),
  card({ rarity: 'rare', typeLine: 'Enchantment', oracleText: 'Draw a card. Destroy it.' }),
  card({
    rarity: 'mythic',
    typeLine: 'Sorcery',
    oracleText: 'Counter target spell.',
    colors: ['U'],
    colorIdentity: ['U'],
  }),
  card({
    rarity: 'common',
    typeLine: 'Creature — Goblin',
    oracleText: 'Haste.',
    colors: ['R'],
    colorIdentity: ['R'],
  }),
  card({ rarity: 'uncommon', layout: 'transform', typeLine: 'Creature — Human Werewolf' }),
  card({ rarity: 'rare', layout: 'split', typeLine: 'Instant // Sorcery' }),
  card({ rarity: 'rare', borderColor: 'borderless', finish: 'foil', foil: true }),
  card({ rarity: 'mythic', borderColor: 'white', finish: 'etched', foil: true }),
  card({ rarity: 'common', frameEffects: ['showcase'] }),
  card({ rarity: 'rare', frameEffects: ['extendedart'], fullArt: true }),
  card({ rarity: 'rare', tags: ['removal', 'ramp'] }),
  card({ rarity: 'common', tags: ['ramp'] }),
  card({ rarity: 'uncommon', tags: [] }),
  card({ rarity: 'rare', purchasePrice: 0.5 }),
  card({ rarity: 'rare', purchasePrice: 50 }),
  card({ rarity: 'rare', purchasePrice: 0 }), // unpriced — excluded from price bounds
  card({ rarity: 'common', cmc: 0 }),
  card({ rarity: 'common', cmc: 8 }),
  // --- pathological copies the real collection actually contains -------------
  card({ rarity: 'rare', setCode: undefined as unknown as string }),
  card({ rarity: 'rare', typeLine: undefined }),
  card({ rarity: 'rare', oracleText: undefined }),
  card({ rarity: 'rare', layout: undefined }),
  card({ rarity: 'rare', borderColor: undefined }),
  card({ rarity: 'rare', cmc: undefined }),
  card({ rarity: 'rare', colors: undefined, colorIdentity: undefined }),
];

const chip = (value: string, negate = false) => ({ value, negate });
const expr = (chips: { value: string; negate: boolean }[], joiners: string[]): ChipExpression =>
  ({ chips, joiners }) as unknown as ChipExpression;

const match = (filter: BinderFilter) =>
  new Set(CORPUS.filter((c) => cardMatchesFilter(c, filter)).map((c) => c.copyId));
const all = new Set(CORPUS.map((c) => c.copyId));

const union = (a: Set<string>, b: Set<string>) => new Set([...a, ...b]);
const inter = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => b.has(x)));
const minus = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => !b.has(x)));
const compl = (a: Set<string>) => minus(all, a);
const sorted = (s: Set<string>) => [...s].sort();

/**
 * kind drives ONE expectation: `A AND B` in a single group is unsatisfiable for
 * an exact single-valued field (a card has one rarity, not two) but a genuine
 * intersection for substring and set-membership fields (a card's oracle text can
 * contain both "draw" and "flying"). Conflating those three is a harness bug
 * that reads as an engine bug — it cost a pass during the audit.
 */
const FIELDS: [keyof BinderFilter, string, string, string, 'exact' | 'substring' | 'set'][] = [
  ['rarities', 'rare', 'mythic', 'uncommon', 'exact'],
  ['layouts', 'normal', 'transform', 'split', 'exact'],
  ['borderColors', 'black', 'borderless', 'white', 'exact'],
  ['colors', 'w', 'u', 'r', 'exact'],
  ['typeChips', 'creature', 'instant', 'human', 'substring'],
  ['oracleChips', 'draw', 'flying', 'destroy', 'substring'],
  ['subtypeChips', 'human', 'elf', 'goblin', 'substring'],
  ['typeTokenChips', 'creature', 'instant', 'artifact', 'set'],
  ['treatments', 'showcase', 'extendedart', 'fullart', 'set'],
  ['oracleTagChips', 'removal', 'ramp', 'lifegain', 'set'],
  ['finishes', 'nonfoil', 'foil', 'etched', 'set'],
];

describe.each(FIELDS)('filter algebra: %s', (field, a, b, c, kind) => {
  const one = (v: string, negate = false) => match({ [field]: expr([chip(v, negate)], []) });
  const A = () => one(a);
  const B = () => one(b);
  const C = () => one(c);

  it('IS and IS-NOT partition the corpus exactly', () => {
    const is = A();
    const not = one(a, true);
    expect(sorted(inter(is, not))).toEqual([]);
    expect(is.size + not.size).toBe(all.size);
  });

  it('IS matches something (the filter is wired, not dead)', () => {
    expect(A().size).toBeGreaterThan(0);
  });

  it('A OR B is the union', () => {
    expect(sorted(match({ [field]: expr([chip(a), chip(b)], ['OR']) }))).toEqual(
      sorted(union(A(), B()))
    );
  });

  it('A OR B OR C is the union of all three', () => {
    expect(sorted(match({ [field]: expr([chip(a), chip(b), chip(c)], ['OR', 'OR']) }))).toEqual(
      sorted(union(union(A(), B()), C()))
    );
  });

  it('A AND NOT B is the difference', () => {
    expect(sorted(match({ [field]: expr([chip(a), chip(b, true)], ['AND']) }))).toEqual(
      sorted(minus(A(), B()))
    );
  });

  it('NOT A AND NOT B is the complement of the union', () => {
    expect(sorted(match({ [field]: expr([chip(a, true), chip(b, true)], ['AND']) }))).toEqual(
      sorted(compl(union(A(), B())))
    );
  });

  it(`A AND B ${kind === 'exact' ? 'is unsatisfiable (single-valued)' : 'is the intersection'}`, () => {
    const got = match({ [field]: expr([chip(a), chip(b)], ['AND']) });
    if (kind === 'exact') expect(sorted(got)).toEqual([]);
    else expect(sorted(got)).toEqual(sorted(inter(A(), B())));
  });

  // The precedence rule compileExpression documents: OR splits groups, AND is tighter.
  it('AND binds tighter than OR: A OR B AND C == A OR (B AND C)', () => {
    const got = match({ [field]: expr([chip(a), chip(b), chip(c)], ['OR', 'AND']) });
    const bAndC = kind === 'exact' ? new Set<string>() : inter(B(), C());
    expect(sorted(got)).toEqual(sorted(union(A(), bAndC)));
  });
});

describe('filter algebra: cross-field and group level', () => {
  const rare = () => match({ rarities: expr([chip('rare')], []) });
  const creature = () => match({ typeTokenChips: expr([chip('creature')], []) });

  it('fields within one filter AND together', () => {
    const got = match({
      rarities: expr([chip('rare')], []),
      typeTokenChips: expr([chip('creature')], []),
    });
    expect(sorted(got)).toEqual(sorted(inter(rare(), creature())));
  });

  it("a binder's filterGroups OR together", () => {
    const groups: BinderFilterGroup[] = [
      { filter: { rarities: expr([chip('rare')], []) } },
      { filter: { typeTokenChips: expr([chip('creature')], []) } },
    ];
    const compiled = compileFilterGroups(groups);
    const got = new Set(
      CORPUS.filter((c) => cardMatchesAnyGroup(c, compiled)).map((c) => c.copyId)
    );
    expect(sorted(got)).toEqual(sorted(union(rare(), creature())));
  });

  it('an empty group matches everything, dominating its siblings', () => {
    const compiled = compileFilterGroups([
      { filter: {} },
      { filter: { rarities: expr([chip('rare')], []) } },
    ]);
    expect(CORPUS.every((c) => cardMatchesAnyGroup(c, compiled))).toBe(true);
  });
});

describe('filter algebra: numeric bounds', () => {
  it('price bounds are disjoint and cover every PRICED copy', () => {
    const cheap = match({ priceMax: 10 });
    const dear = match({ priceMin: 10.01 });
    const priced = new Set(CORPUS.filter((c) => c.purchasePrice > 0).map((c) => c.copyId));
    expect(sorted(inter(cheap, dear))).toEqual([]);
    expect(sorted(union(cheap, dear))).toEqual(sorted(priced));
  });

  it('an unpriced copy is in NO price-bounded filter, in either direction', () => {
    const unpriced = CORPUS.find((c) => c.purchasePrice === 0)!;
    expect(cardMatchesFilter(unpriced, { priceMin: 0 })).toBe(false);
    expect(cardMatchesFilter(unpriced, { priceMax: 1000 })).toBe(false);
  });

  it('a price band is the intersection of its bounds', () => {
    expect(sorted(match({ priceMin: 5, priceMax: 100 }))).toEqual(
      sorted(inter(match({ priceMin: 5 }), match({ priceMax: 100 })))
    );
  });

  it('cmc bounds exclude unknown cmc in either direction', () => {
    const noCmc = CORPUS.find((c) => c.cmc === undefined)!;
    expect(cardMatchesFilter(noCmc, { cmcMin: 0 })).toBe(false);
    expect(cardMatchesFilter(noCmc, { cmcMax: 99 })).toBe(false);
  });
});

describe('filter engine: hostile input', () => {
  it('no field throws on a copy missing every optional property', () => {
    const bare = {
      copyId: 'bare',
      name: '',
      setCode: undefined,
      setName: undefined,
      collectorNumber: undefined,
      rarity: undefined,
      scryfallId: '',
      purchasePrice: 0,
      sourceCategory: '',
      sourceFormat: 'plain',
      foil: false,
      finish: 'nonfoil',
    } as unknown as EnrichedCard;

    const filters: BinderFilter[] = [
      { setCodes: ['tst'] },
      { rarities: expr([chip('rare')], []) },
      { typeChips: expr([chip('creature')], []) },
      { typeTokenChips: expr([chip('creature')], []) },
      { supertypeChips: expr([chip('legendary')], []) },
      { subtypeChips: expr([chip('human')], []) },
      { oracleChips: expr([chip('draw')], []) },
      { oracleTagChips: expr([chip('ramp')], []) },
      { layouts: expr([chip('normal')], []) },
      { borderColors: expr([chip('black')], []) },
      { colors: expr([chip('w')], []) },
      { finishes: expr([chip('foil')], []) },
      { treatments: expr([chip('showcase')], []) },
      { legalities: expr([chip('commander')], []) },
      { nameContains: 'x' },
      { manaCost: '{1}{G}' },
      { cmcMin: 1 },
      { cmcMax: 5 },
      { priceMin: 1 },
      { priceMax: 5 },
      { edhrecRankMax: 100 },
      { commanderEligible: true },
      { proxy: false },
    ];
    for (const f of filters) expect(() => cardMatchesFilter(bare, f)).not.toThrow();
  });

  it('a copy with no setCode matches no set-code filter instead of throwing', () => {
    const noSet = card({ setCode: undefined as unknown as string });
    expect(cardMatchesFilter(noSet, { setCodes: ['tst'] })).toBe(false);
  });

  // `setMatchesExpression` accepts `Set<string> | string[]`. The array branch
  // was always lowercased; the Set branch was NOT, so a caller handing it a
  // mixed-case Set matched nothing at all — silently, since an empty result is
  // indistinguishable from "no cards qualify". Exercised through the exported
  // function directly because no current card field is typed as a Set, which is
  // precisely why the bug could sit there unnoticed.
  it('set-membership is case-insensitive for BOTH a Set and an array', () => {
    const e = compileExpression(expr([chip('removal')], []))!;
    expect(setMatchesExpression(new Set(['Removal', 'RAMP']), e)).toBe(true);
    expect(setMatchesExpression(['Removal', 'RAMP'], e)).toBe(true);
    expect(setMatchesExpression(new Set(['REMOVAL']), e)).toBe(true);
    expect(setMatchesExpression(new Set(['ramp']), e)).toBe(false);
  });

  it('set-membership negation is case-insensitive for a Set too', () => {
    const notRemoval = compileExpression(expr([chip('removal', true)], []))!;
    expect(setMatchesExpression(new Set(['Removal']), notRemoval)).toBe(false);
    expect(setMatchesExpression(new Set(['Ramp']), notRemoval)).toBe(true);
  });
});
