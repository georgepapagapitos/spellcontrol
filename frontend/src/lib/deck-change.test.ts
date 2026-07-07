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
  fromLandUpgradeMove,
  fromSwap,
  toSwapAgainst,
  fromCostSwapRow,
  fromComboCompletion,
  fromBrewCandidate,
  mergeImprove,
  parsePrice,
} from './deck-change';
import type { BrewCandidate } from '@/deck-builder/services/deckBuilder/brewSlots';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { GapAnalysisCard, ScryfallCard } from '@/deck-builder/types';
import type { OptimizeCard } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import type { SubstituteRow } from '@/deck-builder/services/deckBuilder/substituteFinder';
import type { BracketFitMove } from '@/deck-builder/services/deckBuilder/bracketFit';
import type { LandUpgradeMove } from '@/deck-builder/services/deckBuilder/landUpgrades';
import type { CostSwapRow } from '@/deck-builder/services/deckBuilder/costAnalyzer';
import type { ComboMatch } from '@/types/combos';

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

  it('prefers a lift-flavored reason over the role label when liftedBy is present', () => {
    const c = fromGapCard({ ...gap, liftedBy: ['Sol Ring', 'Krenko, Mob Boss'] });
    expect(c.reason).toBe('Lifted by Sol Ring, Krenko, Mob Boss');
    // roleLabel keeps driving the badge unchanged — only reason changes.
    expect(c.roleLabel).toBe('Ramp');
  });

  it('falls back past liftedBy to the role label when liftedBy is empty', () => {
    const c = fromGapCard({ ...gap, liftedBy: [] });
    expect(c.reason).toBe('Ramp staple');
  });
});

describe('fromBrewCandidate', () => {
  const base: BrewCandidate = {
    name: 'Arcane Signet',
    price: '$1.20',
    inclusion: 80,
    synergy: 0,
    typeLine: 'Artifact',
    cmc: 1,
    isOwned: false,
    role: 'ramp',
    roleLabel: 'Ramp',
  };

  it('maps a role-classified candidate into an add Change with the caller-supplied ownership', () => {
    const c = fromBrewCandidate(base, 'brew:ramp:Arcane Signet', 'unowned', '{1}');
    expect(c.type).toBe('add');
    expect(c.lane).toBe('fill-gaps');
    expect(c.id).toBe('brew:ramp:Arcane Signet');
    expect(c.reason).toBe('Ramp pick');
    expect(c.ownership).toBe('unowned');
    expect(c.deltaPrice).toBe(1.2);
    expect(c.role).toBe('ramp');
    expect(c.manaCost).toBe('{1}');
  });

  it('passes through the full allocation-aware ownership state, not just owned/unowned', () => {
    expect(fromBrewCandidate(base, 'x', 'owned').ownership).toBe('owned');
    expect(fromBrewCandidate(base, 'x', 'in-other-deck').ownership).toBe('in-other-deck');
    expect(fromBrewCandidate(base, 'x', 'in-cube').ownership).toBe('in-cube');
  });

  it('feeds the why-factor "owned" signal from ownership === owned, not the raw candidate flag', () => {
    // isOwned:false on the candidate itself — only the ownership arg should drive the chip.
    const owned = fromBrewCandidate(base, 'x', 'owned');
    const claimed = fromBrewCandidate(base, 'x', 'in-other-deck');
    expect(owned.whyFactors?.some((f) => f.text.includes('Already in your collection'))).toBe(true);
    expect(claimed.whyFactors?.some((f) => f.text.includes('Already in your collection'))).toBe(
      false
    );
  });

  it('falls back to a theme-synergy reason when there is no role', () => {
    const c = fromBrewCandidate(
      { ...base, role: undefined, roleLabel: undefined, isThemeSynergy: true },
      'x',
      'unowned'
    );
    expect(c.reason).toBe('Theme synergy');
  });

  it('falls back to a Game Changer reason when there is no role or theme synergy', () => {
    const c = fromBrewCandidate(
      { ...base, role: undefined, roleLabel: undefined, isGameChanger: true },
      'x',
      'unowned'
    );
    expect(c.reason).toBe('Game Changer');
  });

  it('has no reason when neither role, theme synergy, nor Game Changer apply', () => {
    const c = fromBrewCandidate({ ...base, role: undefined, roleLabel: undefined }, 'x', 'unowned');
    expect(c.reason).toBeUndefined();
  });

  it('omits manaCost, inclusion, and synergy when not provided/zero', () => {
    const c = fromBrewCandidate({ ...base, inclusion: 0, synergy: 0, price: null }, 'x', 'unowned');
    expect(c.manaCost).toBeUndefined();
    expect(c.inclusion).toBeUndefined();
    expect(c.synergy).toBeUndefined();
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

describe('fromLandUpgradeMove', () => {
  const move: LandUpgradeMove = {
    outName: 'Plains',
    outCard: { name: 'Plains' } as ScryfallCard,
    inName: 'Hallowed Fountain',
    inCard: {
      name: 'Hallowed Fountain',
      cmc: 0,
      type_line: 'Land — Plains Island',
    } as ScryfallCard,
    reason: 'Stronger land you own — adds blue fixing.',
    outScore: 20,
    inScore: 52,
    fixesShortColors: ['U'],
    addsColors: ['U'],
  };

  it('surfaces the incoming land as primary, cut land in inName, owned', () => {
    const c = fromLandUpgradeMove(move);
    expect(c.type).toBe('swap');
    expect(c.lane).toBe('lands');
    expect(c.name).toBe('Hallowed Fountain'); // primary = incoming land
    expect(c.inName).toBe('Plains'); // slot to cut
    expect(c.ownership).toBe('owned'); // engine only proposes owned lands
    expect(c.deltaScore).toBe(32);
    expect(c.roleLabel).toBe('Lands');
    expect(c.card).toBe(move.inCard);
  });

  it('builds a why-factor naming the short color it covers', () => {
    const c = fromLandUpgradeMove(move);
    expect(c.whyFactors?.some((f) => f.text.includes('blue'))).toBe(true);
    expect(c.whyFactors?.some((f) => f.text.includes('already own'))).toBe(true);
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
    expect(c.id).toBe('collection:Cyclonic Rift:Evacuation');
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

describe('toSwapAgainst', () => {
  it('promotes a thin add Change into a swap against the cut card, reusing its metadata', () => {
    // A thin EDHREC gap row — no resolved ScryfallCard, art resolves by name.
    const incoming = fromGapCard(
      {
        name: 'Cultivate',
        price: '$1.50',
        inclusion: 71,
        synergy: 0.3,
        typeLine: 'Sorcery',
        cmc: 3,
        role: 'ramp',
        roleLabel: 'Ramp',
        imageUrl: 'https://img/cultivate',
      } satisfies GapAnalysisCard,
      'owned'
    );
    const swap = toSwapAgainst(incoming, 'Rampant Growth');

    expect(swap.type).toBe('swap');
    expect(swap.name).toBe('Cultivate'); // primary = coming IN
    expect(swap.inName).toBe('Rampant Growth'); // offender = being CUT
    expect(swap.id).toBe('swap:Rampant Growth->Cultivate');
    // every computed field on the incoming row survives the promotion
    expect(swap.ownership).toBe('owned');
    expect(swap.inclusion).toBe(71);
    expect(swap.roleLabel).toBe('Ramp');
    expect(swap.imageUrl).toBe('https://img/cultivate');
    expect(swap.reason).toBe(incoming.reason);
    expect(swap.card).toBeUndefined(); // still a thin row — no ScryfallCard needed
  });

  it('does not mutate the incoming Change', () => {
    const incoming = add({ name: 'Cultivate' });
    const swap = toSwapAgainst(incoming, 'Rampant Growth');
    expect(incoming.type).toBe('add');
    expect(incoming.inName).toBeUndefined();
    expect(swap).not.toBe(incoming);
  });
});

describe('fromCostSwapRow', () => {
  const baseRow: CostSwapRow = {
    id: 'Smothering Tithe',
    currentName: 'Smothering Tithe',
    currentPrice: 24.0,
    currentInclusion: 41,
    currentCmc: 4,
    suggestionName: 'Esper Sentinel',
    suggestionPrice: 8.0,
    suggestionInclusion: 38,
    suggestionCmc: 1,
    savings: 16.0,
    confidence: 'drop-in',
    category: 'spell',
  };

  it('drop-in: name=suggestion (INCOMING), inName=current (OUTGOING), deltaPrice=-savings; tier rides confidence, not a reason string', () => {
    const c = fromCostSwapRow(baseRow);
    expect(c.type).toBe('swap');
    expect(c.lane).toBe('budget');
    expect(c.name).toBe('Esper Sentinel'); // incoming cheaper card
    expect(c.inName).toBe('Smothering Tithe'); // outgoing expensive card
    expect(c.deltaPrice).toBe(-16.0);
    // Tier + savings are shown by the confidence badge and the price delta — no
    // redundant reason string.
    expect(c.reason).toBeUndefined();
    expect(c.confidence).toBe('drop-in');
  });

  it('sidegrade: confidence tier set, no reason string', () => {
    const c = fromCostSwapRow({ ...baseRow, confidence: 'sidegrade', savings: 10.5 });
    expect(c.reason).toBeUndefined();
    expect(c.deltaPrice).toBe(-10.5);
    expect(c.confidence).toBe('sidegrade');
  });

  it('budget: confidence tier set, no reason string', () => {
    const c = fromCostSwapRow({ ...baseRow, confidence: 'budget', savings: 5.0 });
    expect(c.reason).toBeUndefined();
    expect(c.deltaPrice).toBe(-5.0);
    expect(c.confidence).toBe('budget');
  });

  it('confidence field is set correctly', () => {
    const c = fromCostSwapRow(baseRow);
    expect(c.confidence).toBe('drop-in');
  });

  it('carries the resolved ownership of the INCOMING suggestion', () => {
    expect(fromCostSwapRow(baseRow, 'owned').ownership).toBe('owned');
    expect(fromCostSwapRow(baseRow).ownership).toBeUndefined();
  });
});

describe('fromComboCompletion', () => {
  const match: ComboMatch = {
    combo: {
      id: 'combo-1',
      identity: 'WG',
      produces: ['infinite damage'],
      prerequisites: null,
      description: null,
      manaNeeded: null,
      popularity: 100,
      cardCount: 2,
      bracket: 4,
      cards: [
        { oracleId: 'o1', cardName: 'Walking Ballista', quantity: 1 },
        { oracleId: 'o2', cardName: 'Heliod, Sun-Crowned', quantity: 1 },
      ],
    },
    presentOracleIds: ['o1'],
    missingOracleIds: ['o2'],
  };

  it('produces add Change with lane combos and type add', () => {
    const c = fromComboCompletion(match, 'Heliod, Sun-Crowned');
    expect(c.type).toBe('add');
    expect(c.lane).toBe('combos');
    expect(c.name).toBe('Heliod, Sun-Crowned');
  });

  it('reason names the in-deck partner and the result', () => {
    const c = fromComboCompletion(match, 'Heliod, Sun-Crowned');
    expect(c.reason).toContain('Walking Ballista');
    expect(c.reason).toContain('infinite damage');
  });

  it('3-card combo names both partners', () => {
    const match3: ComboMatch = {
      ...match,
      combo: {
        ...match.combo,
        cardCount: 3,
        cards: [
          { oracleId: 'o1', cardName: 'Card A', quantity: 1 },
          { oracleId: 'o2', cardName: 'Card B', quantity: 1 },
          { oracleId: 'o3', cardName: 'Missing Card', quantity: 1 },
        ],
      },
      missingOracleIds: ['o3'],
    };
    const c = fromComboCompletion(match3, 'Missing Card');
    expect(c.reason).toContain('Card A');
    expect(c.reason).toContain('Card B');
  });

  it('carries the resolved ownership of the missing card', () => {
    expect(fromComboCompletion(match, 'Heliod, Sun-Crowned', 'owned').ownership).toBe('owned');
    expect(fromComboCompletion(match, 'Heliod, Sun-Crowned').ownership).toBeUndefined();
  });
});

describe('fromBracketFitMove swap convention (lock test)', () => {
  it('swap: name=incoming (replacement), inName=outgoing (card being cut)', () => {
    const move: BracketFitMove = {
      type: 'swap',
      name: 'Cyclonic Rift', // the card being CUT
      inName: 'Evacuation', // the replacement coming IN
      reason: 'Too powerful',
      signal: 'game-changer',
    };
    const c = fromBracketFitMove(move, 'owned');
    expect(c.name).toBe('Evacuation'); // INCOMING (primary)
    expect(c.inName).toBe('Cyclonic Rift'); // OUTGOING (cut)
  });
});

describe('whyFactors wiring — every lane adapter carries a structured breakdown', () => {
  it('fromGapCard grounds the breakdown in role gap + lift + inclusion', () => {
    const c = fromGapCard(
      {
        name: 'Cultivate',
        price: '$1.50',
        inclusion: 62,
        synergy: 5,
        typeLine: 'Sorcery',
        role: 'ramp',
        roleLabel: 'Ramp',
        liftedBy: ['Omnath, Locus of Rage'],
      },
      'owned'
    );
    const texts = (c.whyFactors ?? []).map((f) => f.text);
    expect(texts.some((t) => /light on Ramp/.test(t))).toBe(true);
    expect(texts.some((t) => /Omnath, Locus of Rage/.test(t))).toBe(true);
    expect(texts.some((t) => /Already in your collection/.test(t))).toBe(true);
  });

  it('fromSynergySuggestion frames the axis side', () => {
    const c = fromSynergySuggestion({
      cardName: 'Cathars’ Crusade',
      axis: 'tokens',
      axisLabel: 'Tokens',
      side: 'payoff',
      reason: 'rewards going wide',
    });
    expect((c.whyFactors ?? []).some((f) => /payoff for your Tokens engine/.test(f.text))).toBe(
      true
    );
  });

  it('fromOptimizeCard interprets the reason category on both sides', () => {
    const cut = fromOptimizeCard(
      { name: 'Jungle Hollow', reason: 'Tapland', reasonCategory: 'tapland', inclusion: 8 },
      'cut'
    );
    expect((cut.whyFactors ?? []).some((f) => /tempo tax/.test(f.text))).toBe(true);
    const add = fromOptimizeCard(
      {
        name: 'Swords to Plowshares',
        reason: 'Fills Removal gap',
        reasonCategory: 'fills:removal',
        roleLabel: 'Removal',
        inclusion: 70,
      },
      'add',
      'unowned'
    );
    expect((add.whyFactors ?? []).some((f) => /Removal count is under target/.test(f.text))).toBe(
      true
    );
  });

  it('fromBracketFitMove grounds the breakdown in the bracket signal, on cut and swap', () => {
    const cut = fromBracketFitMove({
      type: 'cut',
      name: 'Armageddon',
      reason: 'MLD',
      signal: 'mass-land-denial',
    });
    expect((cut.whyFactors ?? []).some((f) => /Bracket 4\+/.test(f.text))).toBe(true);
    const swap = fromBracketFitMove(
      {
        type: 'swap',
        name: 'Cyclonic Rift',
        inName: 'Evacuation',
        reason: 'Too powerful',
        signal: 'game-changer',
        roleLabel: 'Board Wipes',
        inclusion: 40,
      },
      'owned'
    );
    const texts = (swap.whyFactors ?? []).map((f) => f.text);
    expect(texts.some((t) => /Game Changers list/.test(t))).toBe(true);
    expect(texts.some((t) => /Same Board Wipes slot/.test(t))).toBe(true);
  });

  it('fromComboCompletion counts pieces and flags the two-card caution', () => {
    const match: ComboMatch = {
      combo: {
        id: 'combo-why',
        identity: 'WG',
        produces: ['infinite damage'],
        prerequisites: null,
        description: null,
        manaNeeded: null,
        popularity: 5000,
        cardCount: 2,
        bracket: 4,
        cards: [
          { oracleId: 'o1', cardName: 'Walking Ballista', quantity: 1 },
          { oracleId: 'o2', cardName: 'Heliod, Sun-Crowned', quantity: 1 },
        ],
      },
      presentOracleIds: ['o1'],
      missingOracleIds: ['o2'],
    };
    const c = fromComboCompletion(match, 'Heliod, Sun-Crowned', 'owned');
    const texts = (c.whyFactors ?? []).map((f) => f.text);
    expect(texts.some((t) => /1 of 2 pieces/.test(t))).toBe(true);
    expect(texts.some((t) => /5,000 decks/.test(t))).toBe(true);
    expect(
      (c.whyFactors ?? []).some((f) => /two-card combo/.test(f.text) && f.tone === 'con')
    ).toBe(true);
  });
});
