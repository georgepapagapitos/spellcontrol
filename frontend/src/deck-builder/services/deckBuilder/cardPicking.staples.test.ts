// E532: premium roleless cards keep their slot at pick time. Real cards, real
// oracle text, and inclusion read from each commander's own EDHREC page
// (2026-09-29 panel cache). Role boosts come from computeRoleBoosts itself,
// so the fixtures carry the boosts a live type pass computes.
import { describe, it, expect } from 'vitest';
import { pickFromPrefetchedWithCurve, type RoleCapConfig } from './cardPicking';
import { computeRoleBoosts } from './categorize';
import { BudgetTracker } from './budgetTracker';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';

function ec(name: string, inclusion: number, primary_type: string, synergy = 0): EDHRECCard {
  return { name, sanitized: name.toLowerCase(), primary_type, inclusion, synergy, num_decks: 100 };
}

function sc(name: string, cmc: number, type_line: string, oracle_text: string): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc,
    type_line,
    oracle_text,
    color_identity: [],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  };
}

const LIGHTNING_GREAVES = sc(
  'Lightning Greaves',
  2,
  'Artifact — Equipment',
  "Equipped creature has haste and shroud. (It can't be the target of spells or abilities.)\nEquip {0}"
);
const MIND_STONE = sc(
  'Mind Stone',
  2,
  'Artifact',
  '{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.'
);
const GOLGARI_SIGNET = sc('Golgari Signet', 2, 'Artifact', '{1}, {T}: Add {B}{G}.');
const KAITO = sc(
  'Kaito, Bane of Nightmares',
  4,
  'Legendary Planeswalker — Kaito',
  'Ninjutsu {1}{U}{B}\nDuring your turn, as long as Kaito has one or more loyalty counters on him, he\'s a 3/4 Ninja creature and has hexproof.\n+1: You get an emblem with "Ninjas you control get +1/+1."\n0: Surveil 2. Then draw a card for each opponent who lost life this turn.\n−2: Tap target creature. Put two stun counters on it.'
);
const JACE = sc(
  'Jace, the Mind Sculptor',
  4,
  'Legendary Planeswalker — Jace',
  "+2: Look at the top card of target player's library. You may put that card on the bottom of that player's library.\n0: Draw three cards, then put two cards from your hand on top of your library in any order.\n−1: Return target creature to its owner's hand.\n−12: Exile all cards from target player's library, then that player shuffles their hand into their library."
);

interface PassOpts {
  pool: EDHRECCard[];
  cards: ScryfallCard[];
  count: number;
  expectedType: string;
  roleCap: RoleCapConfig;
  curveTargets?: Record<number, number>;
  currentCurve?: Record<number, number>;
  brewLevel?: number;
  admitFirst?: ReadonlySet<string>;
  budgetTracker?: BudgetTracker;
  comboLinePieces?: ReadonlySet<string>;
}

// The live type pass's argument order (typePassPick.ts's pickEdhrecTypePass).
function pass(o: PassOpts): string[] {
  const cardMap = new Map(o.cards.map((c) => [c.name, c]));
  const boosts = computeRoleBoosts(
    o.roleCap.cardRoleMap,
    o.roleCap.roleTargets,
    o.roleCap.currentRoleCounts,
    undefined,
    new Map(o.cards.map((c) => [c.name, c.cmc]))
  );
  const picked = pickFromPrefetchedWithCurve(
    o.pool,
    cardMap,
    o.count,
    new Set(),
    ['B', 'G', 'R', 'U', 'W'],
    o.curveTargets ?? { 2: 20, 4: 20 },
    o.currentCurve ?? {},
    new Set(),
    o.expectedType,
    null,
    Infinity,
    { value: 0 },
    null,
    null,
    o.budgetTracker ?? null,
    undefined,
    boosts,
    'USD',
    new Set(),
    false,
    false,
    'full',
    100,
    false,
    false,
    undefined,
    undefined,
    undefined,
    o.roleCap,
    false,
    undefined,
    undefined,
    o.brewLevel ?? 0.5,
    undefined,
    o.admitFirst,
    o.comboLinePieces
  );
  return picked.map((c) => c.name);
}

describe('staples are never held back by a role cap (E532 a)', () => {
  // Yuriko, the Tiger's Shadow at bracket 4, the planeswalker pass: draw sat
  // at 22 on a target of 18 (cap 18 + 4), removal at 8 on 7 (cap 9).
  function yurikoPlaneswalkerPass(
    stapleOverflowCounts: Partial<Record<RoleKey, number>>,
    budgetTracker?: BudgetTracker,
    cardDraw = 22
  ) {
    return pass({
      pool: [
        ec('Kaito, Bane of Nightmares', 54.9, 'Planeswalker', 0.5),
        ec('Jace, the Mind Sculptor', 5.6, 'Planeswalker', 0.04),
      ],
      // Placeholder prices: the budget case needs a price to pace spending.
      cards: [
        { ...KAITO, prices: { usd: '1.50' } },
        { ...JACE, prices: { usd: '3.00' } },
      ],
      count: 1,
      expectedType: 'Planeswalker',
      roleCap: {
        cardRoleMap: new Map<string, RoleKey>([
          ['Kaito, Bane of Nightmares', 'cardDraw'],
          ['Jace, the Mind Sculptor', 'removal'],
        ]),
        roleTargets: { ramp: 9, removal: 7, boardwipe: 2, cardDraw: 18 },
        currentRoleCounts: { ramp: 8, removal: 8, boardwipe: 3, cardDraw },
        overflowCounts: {},
        stapleOverflowCounts,
      },
      budgetTracker,
    });
  }

  it('seats Kaito (54.9%) over Jace (5.6%) with card draw at its cap', () => {
    expect(yurikoPlaneswalkerPass({})).toEqual(['Kaito, Bane of Nightmares']);
  });

  it('counts the admission past the cap for the overflow note', () => {
    const counts: Partial<Record<RoleKey, number>> = {};
    yurikoPlaneswalkerPass(counts);
    expect(counts).toEqual({ cardDraw: 1 });
  });

  it('stops at a second tolerance band, so the cap still means something', () => {
    // 18 + 2 x 4: past it, the staple waits like any other card.
    expect(yurikoPlaneswalkerPass({}, undefined, 26)).toEqual(['Jace, the Mind Sculptor']);
    expect(yurikoPlaneswalkerPass({}, undefined, 25)).toEqual(['Kaito, Bane of Nightmares']);
  });

  it('holds the cap under a deck budget, where a card past it is money to claw back', () => {
    expect(yurikoPlaneswalkerPass({}, new BudgetTracker(400, 60, 'USD'))).toEqual([
      'Jace, the Mind Sculptor',
    ]);
  });
});

describe('staples go before role-deficit ordering (E532 b)', () => {
  // Krenko, Mob Boss, the artifact pass with ramp at 5 of 12: the deficit
  // boost lifts a 20% rock (Mind Stone) above the 49% Lightning Greaves.
  const krenkoArtifactPass = (brewLevel?: number, budgetTracker?: BudgetTracker) =>
    pass({
      pool: [
        ec('Lightning Greaves', 49.0, 'Artifact', 0.16),
        ec('Mind Stone', 20.3, 'Artifact', -0.1),
      ],
      // Placeholder prices: the budget case needs a price to pace spending.
      cards: [
        { ...LIGHTNING_GREAVES, prices: { usd: '3.40' } },
        { ...MIND_STONE, prices: { usd: '0.45' } },
      ],
      count: 1,
      expectedType: 'Artifact',
      roleCap: {
        cardRoleMap: new Map<string, RoleKey>([['Mind Stone', 'ramp']]),
        roleTargets: { ramp: 12, removal: 12, boardwipe: 1, cardDraw: 10 },
        currentRoleCounts: { ramp: 5, removal: 12, boardwipe: 1, cardDraw: 9 },
      },
      brewLevel,
      budgetTracker,
    });

  it('seats Lightning Greaves (49%) over a boosted Mind Stone (20.3%)', () => {
    expect(krenkoArtifactPass()).toEqual(['Lightning Greaves']);
  });

  it('leaves the Synergy end of the dial to role and synergy ordering', () => {
    expect(krenkoArtifactPass(1)).toEqual(['Mind Stone']);
  });

  it('leaves a deck budget to role ordering: pick order is spending order there', () => {
    expect(krenkoArtifactPass(0.5, new BudgetTracker(50, 60, 'USD'))).toEqual(['Mind Stone']);
  });
});

describe('admitFirst: a protection piece for a commander that must survive (E532 c)', () => {
  // Meren of Clan Nel Toth: Lightning Greaves 31.6%, Golgari Signet 26.2%
  // (ramp at 4 of 11, so the Signet carries a deficit boost).
  const merenArtifactPass = (admitFirst?: ReadonlySet<string>, currentCurve = {}) =>
    pass({
      pool: [
        ec('Golgari Signet', 26.2, 'Artifact', 0.03),
        ec('Lightning Greaves', 31.6, 'Artifact', 0.11),
      ],
      cards: [GOLGARI_SIGNET, LIGHTNING_GREAVES],
      count: 1,
      expectedType: 'Artifact',
      roleCap: {
        cardRoleMap: new Map<string, RoleKey>([['Golgari Signet', 'ramp']]),
        roleTargets: { ramp: 11, removal: 11, boardwipe: 2, cardDraw: 10 },
        currentRoleCounts: { ramp: 4, removal: 11, boardwipe: 2, cardDraw: 10 },
      },
      curveTargets: { 2: 10 },
      currentCurve,
      admitFirst,
    });

  it('without it, the boosted Signet takes the slot', () => {
    expect(merenArtifactPass()).toEqual(['Golgari Signet']);
  });

  it('with it, Lightning Greaves takes the slot', () => {
    expect(merenArtifactPass(new Set(['Lightning Greaves']))).toEqual(['Lightning Greaves']);
  });

  it('with it, Lightning Greaves may break a full two-drop curve like a staple', () => {
    expect(merenArtifactPass(new Set(['Lightning Greaves']), { 2: 10 })).toEqual([
      'Lightning Greaves',
    ]);
  });

  it('an admitted piece goes before the staples, not among them', () => {
    // Meren of Clan Nel Toth's Aristocrats page: Skullclamp 67.2%, Swiftfoot
    // Boots 18.8%. Sorted by priority inside the tier, the staple took the
    // pass's last slot and Boots never reached the deck.
    const skullclamp = sc(
      'Skullclamp',
      1,
      'Artifact — Equipment',
      'Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}'
    );
    const boots = sc(
      'Swiftfoot Boots',
      2,
      'Artifact — Equipment',
      "Equipped creature has hexproof and haste. (It can't be the target of spells or abilities your opponents control. It can attack and {T} no matter when it came under your control.)\nEquip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)"
    );
    const picked = pass({
      pool: [
        ec('Skullclamp', 67.2, 'Artifact', 0.4),
        ec('Swiftfoot Boots', 18.8, 'Artifact', -0.04),
      ],
      cards: [skullclamp, boots],
      count: 1,
      expectedType: 'Artifact',
      roleCap: {
        cardRoleMap: new Map<string, RoleKey>([['Skullclamp', 'cardDraw']]),
        roleTargets: { ramp: 11, removal: 11, boardwipe: 2, cardDraw: 10 },
        currentRoleCounts: { ramp: 11, removal: 11, boardwipe: 2, cardDraw: 6 },
      },
      admitFirst: new Set(['Swiftfoot Boots']),
    });
    expect(picked).toEqual(['Swiftfoot Boots']);
  });
});

describe('a staple takes a filler slot, never a combo slot (E532 gate)', () => {
  // Muldrotha, the Gravetide's Reanimator page: Spore Frog 62.8%, Eternal
  // Witness 54.7%, Hermit Druid 30.9% (Hermit Druid + Thassa's Oracle wins).
  // Three slots; the Druid carries a card-draw deficit boost, the staples none.
  const creaturePass = (comboLinePieces?: ReadonlySet<string>) =>
    pass({
      pool: [
        ec('Hermit Druid', 30.9, 'Creature', 0.25),
        ec('Spore Frog', 62.8, 'Creature', 0.4),
        ec('Eternal Witness', 54.7, 'Creature', 0.2),
      ],
      cards: [
        sc(
          'Hermit Druid',
          2,
          'Creature — Human Druid',
          '{G}, {T}: Reveal cards from the top of your library until you reveal a basic land card. Put that card into your hand and all other cards revealed this way into your graveyard.'
        ),
        sc(
          'Spore Frog',
          1,
          'Creature — Frog',
          'Sacrifice Spore Frog: Prevent all combat damage that would be dealt this turn.'
        ),
        sc(
          'Eternal Witness',
          3,
          'Creature — Human Shaman',
          'When Eternal Witness enters, you may return target card from your graveyard to your hand.'
        ),
      ],
      count: 2,
      expectedType: 'Creature',
      roleCap: {
        cardRoleMap: new Map<string, RoleKey>([['Hermit Druid', 'cardDraw']]),
        roleTargets: { ramp: 13, removal: 6, boardwipe: 1, cardDraw: 13 },
        currentRoleCounts: { ramp: 10, removal: 3, boardwipe: 0, cardDraw: 2 },
      },
      comboLinePieces,
    });

  it('without protection the two staples take both slots', () => {
    expect(creaturePass().sort()).toEqual(['Eternal Witness', 'Spore Frog']);
  });

  it('a protected combo piece leads the tier', () => {
    expect(creaturePass(new Set(['Hermit Druid']))).toEqual(['Hermit Druid', 'Spore Frog']);
  });
});

describe('a >=40% wipe leads the tier (E532 gate)', () => {
  // Obeka, Brute Chronologist's Wheels page: Toxic Deluge 42.9% and
  // Reanimate 42.9% for the pass's last sorcery slot, with Aetherize 14.3%
  // behind. Kept out of the tier, the wipe lost the slot to the staple.
  it('seats Toxic Deluge on its wipe deficit, not behind every other staple', () => {
    const picked = pass({
      pool: [
        ec('Aetherize', 14.3, 'Instant', 0.05),
        ec('Toxic Deluge', 42.9, 'Sorcery', 0.1),
        ec('Reanimate', 42.9, 'Sorcery', 0.1),
      ],
      cards: [
        sc('Aetherize', 4, 'Instant', "Return all attacking creatures to their owner's hand."),
        sc(
          'Toxic Deluge',
          3,
          'Sorcery',
          'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.'
        ),
        sc(
          'Reanimate',
          1,
          'Sorcery',
          'Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.'
        ),
      ],
      count: 1,
      expectedType: 'Sorcery',
      roleCap: {
        cardRoleMap: new Map<string, RoleKey>([
          ['Toxic Deluge', 'boardwipe'],
          ['Aetherize', 'boardwipe'],
        ]),
        roleTargets: { ramp: 12, removal: 8, boardwipe: 3, cardDraw: 18 },
        currentRoleCounts: { ramp: 6, removal: 3, boardwipe: 1, cardDraw: 16 },
      },
    });
    expect(picked).toEqual(['Toxic Deluge']);
  });
});
