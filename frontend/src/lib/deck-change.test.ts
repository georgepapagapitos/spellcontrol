import { describe, it, expect } from 'vitest';
import {
  type Change,
  sortOwnedFirst,
  laneSummary,
  fromSynergySuggestion,
  fromGapCard,
  fromOptimizeCard,
  fromSubstituteRow,
  fromBracketFitMove,
  fromSwap,
  mergeImprove,
  parsePrice,
} from './deck-change';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { GapAnalysisCard, ScryfallCard } from '@/deck-builder/types';
import type { OptimizeCard } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import type { SubstituteRow } from '@/deck-builder/services/deckBuilder/substituteFinder';
import type { BracketFitMove } from '@/deck-builder/services/deckBuilder/bracketFit';

/** Minimal add Change for the lane helpers. */
function add(over: Partial<Change>): Change {
  return {
    id: over.id ?? `fill-gaps:${over.name ?? 'x'}`,
    type: 'add',
    lane: 'fill-gaps',
    name: 'x',
    reason: 'r',
    ...over,
  };
}

describe('sortOwnedFirst', () => {
  it('owned beats in-other-deck beats unowned/undefined', () => {
    const out = sortOwnedFirst([
      add({ name: 'unowned', ownership: 'unowned' }),
      add({ name: 'free', ownership: 'owned' }),
      add({ name: 'blind', ownership: undefined }),
      add({ name: 'elsewhere', ownership: 'in-other-deck' }),
    ]);
    expect(out.map((c) => c.name)).toEqual(['free', 'elsewhere', 'unowned', 'blind']);
  });

  it('within a rank, higher inclusion comes first', () => {
    const out = sortOwnedFirst([
      add({ name: 'low', ownership: 'owned', inclusion: 20 }),
      add({ name: 'high', ownership: 'owned', inclusion: 90 }),
    ]);
    expect(out.map((c) => c.name)).toEqual(['high', 'low']);
  });

  it('is stable for equal rank + equal/absent inclusion', () => {
    const out = sortOwnedFirst([
      add({ name: 'a', ownership: 'unowned' }),
      add({ name: 'b', ownership: 'unowned' }),
      add({ name: 'c', ownership: 'unowned' }),
    ]);
    expect(out.map((c) => c.name)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = [
      add({ name: 'a', ownership: 'unowned' }),
      add({ name: 'b', ownership: 'owned' }),
    ];
    const before = input.map((c) => c.name);
    sortOwnedFirst(input);
    expect(input.map((c) => c.name)).toEqual(before);
  });
});

describe('laneSummary', () => {
  it('counts adds, cuts, and swaps (swap counts on both sides)', () => {
    const s = laneSummary([add({ type: 'add' }), add({ type: 'cut' }), add({ type: 'swap' })]);
    expect(s.addCount).toBe(2); // add + swap
    expect(s.cutCount).toBe(2); // cut + swap
    expect(s.net).toBe(0);
  });

  it('sums defined deltas and keeps unknown deltas null (never coerced to 0)', () => {
    const s = laneSummary([
      add({ deltaScore: 5, deltaPrice: -3 }),
      add({ deltaScore: undefined, deltaPrice: undefined }),
      add({ deltaScore: 2 }),
    ]);
    expect(s.scoreDelta).toBe(7);
    expect(s.priceDelta).toBe(-3);
  });

  it('reports null deltas when nothing is known', () => {
    const s = laneSummary([add({}), add({})]);
    expect(s.scoreDelta).toBeNull();
    expect(s.priceDelta).toBeNull();
  });

  it('handles an empty lane', () => {
    expect(laneSummary([])).toEqual({
      addCount: 0,
      cutCount: 0,
      net: 0,
      scoreDelta: null,
      priceDelta: null,
    });
  });
});

describe('fromSynergySuggestion', () => {
  const base: SynergySuggestion = {
    cardName: 'Cathars’ Crusade',
    axis: 'tokens',
    axisLabel: 'Tokens / go-wide',
    side: 'payoff',
    reason: 'rewards going wide',
    inclusion: 12,
  };

  it('maps an off-meta synergy pick into an upgrade-lane add', () => {
    const c = fromSynergySuggestion(base, 'unowned');
    expect(c.type).toBe('add');
    expect(c.lane).toBe('upgrade');
    expect(c.name).toBe(base.cardName);
    expect(c.id).toBe('upgrade:Cathars’ Crusade');
    expect(c.reason).toBe('rewards going wide');
    expect(c.ownership).toBe('unowned');
    expect(c.inclusion).toBe(12);
    expect(c.isThemeSynergy).toBe(true);
    expect(c.group).toBe('Tokens / go-wide');
    expect(c.axis).toBe('tokens');
    expect(c.side).toBe('payoff');
  });

  it('leaves inclusion undefined for genuinely off-meta picks (renders "Off-meta")', () => {
    const c = fromSynergySuggestion({ ...base, inclusion: undefined });
    expect(c.inclusion).toBeUndefined();
    expect(c.ownership).toBeUndefined();
  });
});

describe('fromGapCard', () => {
  const gap: GapAnalysisCard = {
    name: 'Cultivate',
    price: '$1.50',
    inclusion: 62,
    synergy: 0.3,
    typeLine: 'Sorcery',
    cmc: 3,
    role: 'ramp',
    roleLabel: 'Ramp',
    imageUrl: 'http://img/cultivate',
  };

  it('maps an EDHREC gap card into an add Change with parsed price + role', () => {
    const c = fromGapCard(gap, 'owned');
    expect(c.type).toBe('add');
    expect(c.name).toBe('Cultivate');
    expect(c.reason).toBe('Ramp staple');
    expect(c.ownership).toBe('owned');
    expect(c.deltaPrice).toBe(1.5);
    expect(c.role).toBe('ramp');
    expect(c.inclusion).toBe(62);
    expect(c.imageUrl).toBe('http://img/cultivate');
  });

  it('falls back to a generic reason + undefined price when fields are absent', () => {
    const c = fromGapCard({ ...gap, roleLabel: undefined, price: null });
    expect(c.reason).toBe('EDHREC staple');
    expect(c.deltaPrice).toBeUndefined();
  });
});

describe('fromOptimizeCard', () => {
  const base: OptimizeCard = {
    name: 'Smothering Tithe',
    reason: 'Fills Card Advantage gap',
    reasonCategory: 'Card Advantage',
    inclusion: 41,
    price: '$24.00',
    role: 'cardDraw',
    roleLabel: 'Card Advantage',
    imageUrl: 'http://img/tithe',
    cmc: 4,
    primaryType: 'Enchantment',
    isGameChanger: true,
    isThemeSynergy: false,
  };

  it('maps an addition into an add Change carrying live ownership', () => {
    const c = fromOptimizeCard(base, 'add', 'unowned');
    expect(c.type).toBe('add');
    expect(c.lane).toBe('upgrade');
    expect(c.id).toBe('upgrade:add:Smothering Tithe');
    expect(c.ownership).toBe('unowned');
    expect(c.deltaPrice).toBe(24);
    expect(c.inclusion).toBe(41);
    expect(c.group).toBe('Card Advantage');
    expect(c.isGameChanger).toBe(true);
  });

  it('maps a removal into an ownership-blind cut Change', () => {
    const c = fromOptimizeCard({ ...base, name: 'Hedron Archive' }, 'cut', 'owned');
    expect(c.type).toBe('cut');
    expect(c.id).toBe('upgrade:cut:Hedron Archive');
    expect(c.ownership).toBeUndefined(); // cuts are ownership-blind
  });

  it('leaves price + inclusion undefined when the optimizer omits them', () => {
    const c = fromOptimizeCard({ ...base, price: undefined, inclusion: null }, 'add');
    expect(c.deltaPrice).toBeUndefined();
    expect(c.inclusion).toBeUndefined();
  });
});

describe('fromBracketFitMove', () => {
  it('maps a pure cut into an ownership-blind cut Change', () => {
    const move: BracketFitMove = {
      type: 'cut',
      name: 'Armageddon',
      reason: 'Mass land denial isn’t allowed below Bracket 4.',
      signal: 'mass-land-denial',
      isGameChanger: false,
    };
    const c = fromBracketFitMove(move);
    expect(c.type).toBe('cut');
    expect(c.lane).toBe('bracket-fit');
    expect(c.id).toBe('bracket-fit:cut:Armageddon');
    expect(c.name).toBe('Armageddon');
    expect(c.ownership).toBeUndefined(); // cuts are ownership-blind
    expect(c.group).toBe('mass-land-denial');
  });

  it('maps an add carrying live ownership + metadata', () => {
    const move: BracketFitMove = {
      type: 'add',
      name: 'Rhystic Study',
      reason: 'Game Changer the deck lacks.',
      signal: 'upshift-gc',
      inclusion: 70,
      cmc: 3,
      typeLine: 'Enchantment',
      imageUrl: 'http://img/rhystic',
      isGameChanger: true,
    };
    const c = fromBracketFitMove(move, 'owned');
    expect(c.type).toBe('add');
    expect(c.name).toBe('Rhystic Study');
    expect(c.ownership).toBe('owned');
    expect(c.isGameChanger).toBe(true);
    expect(c.inclusion).toBe(70);
  });

  it('surfaces the replacement as primary on a downshift swap; never a GC', () => {
    const move: BracketFitMove = {
      type: 'swap',
      name: 'Cyclonic Rift', // the card being cut
      inName: 'Evacuation', // the lower-power replacement coming in
      reason: 'Game Changer over the Bracket 2 limit.',
      signal: 'game-changer',
      inclusion: 40,
      imageUrl: 'http://img/evac',
    };
    const c = fromBracketFitMove(move, 'unowned');
    expect(c.type).toBe('swap');
    expect(c.id).toBe('bracket-fit:swap:Cyclonic Rift');
    expect(c.name).toBe('Evacuation'); // primary = the incoming card
    expect(c.inName).toBe('Cyclonic Rift'); // the slot to cut
    expect(c.reason).toBe('Replaces Cyclonic Rift — Game Changer over the Bracket 2 limit.');
    expect(c.ownership).toBe('unowned');
    expect(c.isGameChanger).toBe(false); // downshift replacement is never a GC
  });

  it('flags the incoming Game Changer on an upshift swap (inIsGameChanger)', () => {
    const move: BracketFitMove = {
      type: 'swap',
      name: 'Llanowar Elves', // lowest-impact slot cut to make room
      inName: 'Smothering Tithe', // the GC powering the deck up
      reason: 'Game Changer the deck lacks.',
      signal: 'upshift-gc',
      inclusion: 65,
      isGameChanger: false, // the cut card is not a GC
      inIsGameChanger: true, // the incoming card is
    };
    const c = fromBracketFitMove(move, 'owned');
    expect(c.type).toBe('swap');
    expect(c.name).toBe('Smothering Tithe');
    expect(c.inName).toBe('Llanowar Elves');
    expect(c.isGameChanger).toBe(true); // the incoming GC drives the badge
  });
});

describe('fromSubstituteRow', () => {
  const row: SubstituteRow = {
    wantedName: 'Cyclonic Rift',
    wantedRole: 'boardwipe',
    wantedRoleLabel: 'Board Wipes',
    wantedCmc: 7,
    usedName: 'Evacuation',
    usedSubtypeMatch: true,
    reason: 'Evacuation fills the board-wipe slot — owned, same bounce',
  };

  it('adapts to an add of the OWNED card (nothing is cut), always owned', () => {
    const c = fromSubstituteRow(row);
    expect(c.type).toBe('add');
    expect(c.lane).toBe('collection');
    expect(c.name).toBe('Evacuation'); // the owned card we actually add
    expect(c.id).toBe('collection:Evacuation');
    expect(c.ownership).toBe('owned');
    expect(c.reason).toContain('Evacuation');
    expect(c.role).toBe('boardwipe');
    expect(c.roleLabel).toBe('Board Wipes');
    expect(c.cmc).toBe(7);
  });
});

describe('mergeImprove', () => {
  it('dedupes by name (case-insensitive), keeping the higher-signal row', () => {
    const owned = add({ name: 'Cultivate', ownership: 'owned', inclusion: 60 });
    const unowned = add({ name: 'cultivate', ownership: 'unowned', inclusion: 60 });
    const out = mergeImprove([unowned, owned]);
    expect(out).toHaveLength(1);
    expect(out[0].ownership).toBe('owned'); // owned wins regardless of input order
  });

  it('unions the synergy signal across sources for a survivor', () => {
    const staple = add({ name: 'Esper Sentinel', ownership: 'owned', inclusion: 70 });
    const synergy = add({
      name: 'Esper Sentinel',
      ownership: 'owned',
      isThemeSynergy: true,
      synergy: 18,
    });
    const out = mergeImprove([staple, synergy]);
    expect(out).toHaveLength(1);
    expect(out[0].isThemeSynergy).toBe(true); // synergy flag survives the merge
    expect(out[0].inclusion).toBe(70); // best-known inclusion kept
    expect(out[0].synergy).toBe(18);
  });

  it('returns owned-first order and ignores cuts', () => {
    const out = mergeImprove([
      add({ name: 'unowned', ownership: 'unowned' }),
      add({ name: 'owned', ownership: 'owned' }),
      add({ name: 'cutme', type: 'cut', ownership: undefined }),
    ]);
    expect(out.map((c) => c.name)).toEqual(['owned', 'unowned']); // cut dropped
  });
});

describe('parsePrice re-export', () => {
  it('parses a "$X.XX" string', () => {
    expect(parsePrice('$12.34')).toBe(12.34);
  });
  it('returns null for non-finite input', () => {
    expect(parsePrice('—')).toBeNull();
    expect(parsePrice(null)).toBeNull();
  });
});

describe('fromSwap', () => {
  const inCard = {
    id: 'in',
    oracle_id: 'o-in',
    name: 'Rhystic Study',
    cmc: 3,
    type_line: 'Enchantment',
    color_identity: ['U'],
    image_uris: { normal: 'https://img/rhystic-normal', small: 'https://img/rhystic-small' },
  } as ScryfallCard;

  it('renders the incoming card as primary and the cut card as the offender', () => {
    const c = fromSwap({
      inCard,
      outName: 'Mind Stone',
      reason: 'Overlapping Card Advantage',
      ownership: 'owned',
      inclusion: 62,
      role: 'cardDraw',
      roleLabel: 'Card Advantage',
    });
    expect(c.type).toBe('swap');
    expect(c.name).toBe('Rhystic Study'); // primary card = coming IN
    expect(c.inName).toBe('Mind Stone'); // offender = being CUT
    expect(c.card).toBe(inCard);
    expect(c.id).toBe('swap:Mind Stone->Rhystic Study');
    expect(c.lane).toBe('similar'); // default lane
    expect(c.ownership).toBe('owned');
    expect(c.inclusion).toBe(62);
    expect(c.reason).toBe('Overlapping Card Advantage');
    expect(c.imageUrl).toBe('https://img/rhystic-normal');
    expect(c.cmc).toBe(3);
    expect(c.typeLine).toBe('Enchantment');
  });

  it('falls back to the small image and honors a custom lane', () => {
    const noNormal = {
      ...inCard,
      image_uris: { small: 'https://img/only-small' },
    } as ScryfallCard;
    const c = fromSwap({
      inCard: noNormal,
      outName: 'Old Card',
      reason: 'r',
      lane: 'upgrade',
    });
    expect(c.imageUrl).toBe('https://img/only-small');
    expect(c.lane).toBe('upgrade');
    expect(c.ownership).toBeUndefined();
  });
});
