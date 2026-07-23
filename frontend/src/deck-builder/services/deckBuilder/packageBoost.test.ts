import { beforeEach, describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  clearPackageBoostCache,
  computeLiftPickBoosts,
  computePackageBoosts,
  computeUntapVisibilityBoosts,
  computeBlinkVisibilityBoosts,
  computeExileVisibilityBoosts,
  computeExtraCombatVisibilityBoosts,
  LIFT_PICK_BOOST_MAX,
  LIFT_PICK_BOOST_SCALE,
  PACKAGE_BOOST_MAX,
  UNTAP_VISIBILITY_BOOST_MAX,
  BLINK_VISIBILITY_BOOST_MAX,
  EXILE_VISIBILITY_BOOST_MAX,
  EXTRA_COMBAT_VISIBILITY_BOOST_MAX,
  tallyAxisInvestment,
} from './packageBoost';

/** Real cards, real oracle text — the classifier reads the actual words. */
function card(name: string, oracle: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    cmc: 2,
    type_line: 'Creature — Vampire',
    oracle_text: oracle,
    color_identity: ['B'],
    keywords: [],
    rarity: 'uncommon',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

const visceraSeer = card('Viscera Seer', 'Sacrifice a creature: Scry 1.');
const carrionFeeder = card(
  'Carrion Feeder',
  'Carrion Feeder can’t block.\nSacrifice a creature: Put a +1/+1 counter on Carrion Feeder.'
);
const yawgmoth = card(
  'Yawgmoth, Thran Physician',
  'Protection from Humans\n{B}, Pay 1 life, Sacrifice another creature: Put a -1/-1 counter on up to one target creature and draw a card.'
);
const bloodArtist = card(
  'Blood Artist',
  'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.'
);
const zulaport = card(
  'Zulaport Cutthroat',
  'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.'
);
const divination = card('Divination', 'Draw two cards.', {
  type_line: 'Sorcery',
  color_identity: ['U'],
});
const vanillaCommander = card('Isamaru, Hound of Konda', '', {
  type_line: 'Legendary Creature — Dog',
  color_identity: ['W'],
});

// ── E135 type-line density fixtures ─────────────────────────────────────────
// Real mana rock — no token-making text, so classifyCard tags it on no axis
// at all pre-fix; only the type_line ('Artifact') makes it count.
const solRing = card('Sol Ring', '{T}: Add {C}{C}.', { type_line: 'Artifact', cmc: 1 });
// Equipment already classifies under the narrower `equipment` axis (axes.ts
// checks type_line directly there) — E135 additionally credits `artifacts`.
const bonesplitter = card('Bonesplitter', 'Equipped creature gets +2/+0.\nEquip {1}', {
  type_line: 'Artifact — Equipment',
  cmc: 1,
});
// Vehicle, same shape as Equipment — narrow `vehicles` axis pre-existing,
// broad `artifacts` axis added by E135.
const smugglersCopter = card(
  "Smuggler's Copter",
  'Flying\nWhenever Smuggler’s Copter attacks or blocks, you may draw a card. If you do, discard a card.\nCrew 1',
  { type_line: 'Artifact — Vehicle', cmc: 2 }
);
// Double-matching card: an Artifact Creature whose OWN oracle text already
// trips axes.ts's text-based `artifacts` producer regex ("artifact creature
// token") — the type-line addition must not double-bump it.
const hangarbackWalker = card(
  'Hangarback Walker',
  'Hangarback Walker enters the battlefield with X +1/+1 counters on it.\n{1}, {T}, Sacrifice a creature: Put a +1/+1 counter on Hangarback Walker.\nWhen Hangarback Walker dies, create a 1/1 colorless Thopter artifact creature token for each +1/+1 counter on Hangarback Walker.',
  { type_line: 'Artifact Creature — Construct', cmc: 2 }
);
// Real metalcraft payoff — already classifies as an `artifacts` PAYOFF via
// axes.ts's existing keyword/text check (E135 doesn't touch payoff
// classification); only the producer/support side was broken.
const etchedChampion = card(
  'Etched Champion',
  'Metalcraft — Etched Champion has protection from all colors as long as you control three or more artifacts.',
  { type_line: 'Artifact Creature — Golem', cmc: 3, keywords: ['Metalcraft'] }
);

const cardMap = new Map(
  [visceraSeer, carrionFeeder, yawgmoth, bloodArtist, zulaport, divination].map((c) => [c.name, c])
);

beforeEach(() => clearPackageBoostCache());

describe('tallyAxisInvestment', () => {
  it('tallies sac outlets as sacrifice producers and weighs the commander double', () => {
    const outlets = tallyAxisInvestment([visceraSeer, carrionFeeder, yawgmoth], [vanillaCommander]);
    const sac = outlets.get('sacrifice');
    expect(sac?.producers).toBe(3);
    expect(sac?.payoffs ?? 0).toBe(0);

    const withCommander = tallyAxisInvestment([visceraSeer], [bloodArtist]);
    expect(withCommander.get('sacrifice')?.payoffs).toBe(2); // commander × 2
  });
});

describe('tallyAxisInvestment — E135 type-line density', () => {
  it('counts a raw mana rock as an artifacts producer with no token-making text', () => {
    const investment = tallyAxisInvestment([solRing], []);
    expect(investment.get('artifacts')?.producers).toBe(1);
  });

  it('counts Equipment toward both the broad artifacts axis and its own narrower axis, once each', () => {
    const investment = tallyAxisInvestment([bonesplitter], []);
    expect(investment.get('artifacts')?.producers).toBe(1);
    expect(investment.get('equipment')?.producers).toBe(1);
  });

  it('counts a Vehicle toward both the broad artifacts axis and its own narrower axis, once each', () => {
    const investment = tallyAxisInvestment([smugglersCopter], []);
    expect(investment.get('artifacts')?.producers).toBe(1);
    expect(investment.get('vehicles')?.producers).toBe(1);
  });

  it('does not double-bump a card classifyCard already tagged on the same axis', () => {
    const investment = tallyAxisInvestment([hangarbackWalker], []);
    expect(investment.get('artifacts')?.producers).toBe(1); // not 2
  });

  it('a creature-only pool contributes zero artifacts investment', () => {
    const investment = tallyAxisInvestment([visceraSeer, carrionFeeder], []);
    expect(investment.get('artifacts')?.producers ?? 0).toBe(0);
  });

  it('weighs a raw-permanent commander double, same as every other producer', () => {
    const investment = tallyAxisInvestment([], [solRing]);
    expect(investment.get('artifacts')?.producers).toBe(2); // commander × 2
  });
});

describe('computePackageBoosts', () => {
  it('boosts a metalcraft/affinity-class payoff once raw artifact permanents are picked (E135)', () => {
    // Three raw artifact permanents picked (a rock, an Equipment, a
    // Vehicle), zero payoffs — pre-fix this investment map read 0 artifacts
    // producers, so the payoff never cleared LIVE_MIN and was never boosted.
    const investment = tallyAxisInvestment([solRing, bonesplitter, smugglersCopter], []);
    const boostCardMap = new Map([etchedChampion].map((c) => [c.name, c]));
    const boosts = computePackageBoosts(['Etched Champion'], boostCardMap, investment);
    expect(boosts.get('Etched Champion')).toBeGreaterThan(0);
  });

  it('boosts the starved payoff side of a live aristocrats engine, never the majority side', () => {
    // Three sac outlets picked, zero payoffs → the engine begs for Blood Artist.
    const investment = tallyAxisInvestment(
      [visceraSeer, carrionFeeder, yawgmoth],
      [vanillaCommander]
    );
    const boosts = computePackageBoosts(
      ['Blood Artist', 'Zulaport Cutthroat', 'Divination', 'Viscera Seer'],
      cardMap,
      investment
    );
    // 10 × (3 − 0) / (0 + 1) = 30 → per-axis cap 20 binds (the +30 total cap
    // is reserved for genuinely multi-axis completions).
    expect(boosts.get('Blood Artist')).toBe(20);
    expect(boosts.get('Zulaport Cutthroat')).toBe(20);
    // Goodstuff filler gets nothing; a 4th outlet (majority side) gets nothing.
    expect(boosts.has('Divination')).toBe(false);
    expect(boosts.has('Viscera Seer')).toBe(false);
  });

  it('boosts fuel when payoffs outnumber outlets (the mirror direction)', () => {
    const investment = tallyAxisInvestment([bloodArtist, zulaport, bloodArtist], []);
    const boosts = computePackageBoosts(['Viscera Seer', 'Blood Artist'], cardMap, investment);
    expect(boosts.get('Viscera Seer')).toBeGreaterThan(0);
    expect(boosts.has('Blood Artist')).toBe(false);
  });

  it('stays silent below the live threshold and shrinks as the engine balances', () => {
    // Two outlets only → not a live engine yet.
    const budding = tallyAxisInvestment([visceraSeer, carrionFeeder], [vanillaCommander]);
    expect(computePackageBoosts(['Blood Artist'], cardMap, budding).size).toBe(0);

    // 3 outlets + 2 payoffs → live but nearly balanced: small boost, not the cap.
    const nearlyBalanced = tallyAxisInvestment(
      [visceraSeer, carrionFeeder, yawgmoth, bloodArtist, zulaport],
      [vanillaCommander]
    );
    const boosts = computePackageBoosts(['Blood Artist'], cardMap, nearlyBalanced);
    const b = boosts.get('Blood Artist') ?? 0;
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(PACKAGE_BOOST_MAX / 2);
  });

  it('skips candidates missing from the card map and balanced engines entirely', () => {
    const balanced = tallyAxisInvestment([visceraSeer, bloodArtist, carrionFeeder, zulaport], []);
    // producers 2 vs payoffs 2 → nothing to complete.
    expect(computePackageBoosts(['Blood Artist', 'Viscera Seer'], cardMap, balanced).size).toBe(0);
    expect(computePackageBoosts(['Not A Card'], cardMap, balanced).size).toBe(0);
  });
});

describe('computeLiftPickBoosts', () => {
  it('leaves output unchanged when the lift index is empty (no-signal ⇒ byte-identical)', () => {
    const liftScoreOfNothing = () => 0;
    const boosts = computeLiftPickBoosts(
      ['Blood Artist', 'Zulaport Cutthroat', 'Divination'],
      liftScoreOfNothing
    );
    expect(boosts.size).toBe(0);
  });

  it('boosts a lift-scored candidate, capped at LIFT_PICK_BOOST_MAX', () => {
    const clusterScores: Record<string, number> = {
      'blood artist': 500, // 500 * 0.0075 = 3.75, under the cap
      'zulaport cutthroat': 100000, // far over the cap → saturates
    };
    const liftScoreOf = (name: string) => clusterScores[name.toLowerCase()] ?? 0;

    const boosts = computeLiftPickBoosts(
      ['Blood Artist', 'Zulaport Cutthroat', 'Divination'],
      liftScoreOf
    );

    expect(boosts.get('Blood Artist')).toBeCloseTo(500 * LIFT_PICK_BOOST_SCALE);
    expect(boosts.get('Zulaport Cutthroat')).toBe(LIFT_PICK_BOOST_MAX);
    expect(boosts.has('Divination')).toBe(false); // zero lift connectivity → no entry at all
  });

  it('scaleMul (Staples <-> Brew dial) scales the already-capped boost, default 1 = unchanged', () => {
    const liftScoreOf = (name: string) => (name === 'Blood Artist' ? 500 : 0);
    const base = computeLiftPickBoosts(['Blood Artist'], liftScoreOf);
    expect(computeLiftPickBoosts(['Blood Artist'], liftScoreOf, 1)).toEqual(base); // default no-op
    expect(computeLiftPickBoosts(['Blood Artist'], liftScoreOf, 0).get('Blood Artist')).toBe(0);
    const doubled = computeLiftPickBoosts(['Blood Artist'], liftScoreOf, 2).get('Blood Artist');
    expect(doubled).toBeCloseTo((base.get('Blood Artist') ?? 0) * 2);
  });
});

describe('computeUntapVisibilityBoosts', () => {
  // isProducer is injected (mirrors computeLiftPickBoosts's liftScoreOf) — a
  // simple name-set stub is enough here, the real classifier's regex is
  // covered in tagger/client.test.ts.
  const untapProducerNames = new Set(['Aphetto Alchemist', 'Vizier of Tumbling Sands']);
  const isProducer = (c: ScryfallCard) => untapProducerNames.has(c.name);
  const aphetto = card('Aphetto Alchemist', '{T}: Untap target artifact or creature.');
  const vizier = card('Vizier of Tumbling Sands', '{T}: Untap another target permanent.');
  const untapCardMap = new Map([aphetto, vizier, divination].map((c) => [c.name, c]));

  it('stays an empty map when the commander does not want untap (near-inert requirement)', () => {
    const boosts = computeUntapVisibilityBoosts(
      ['Aphetto Alchemist', 'Vizier of Tumbling Sands', 'Divination'],
      untapCardMap,
      false,
      isProducer
    );
    expect(boosts.size).toBe(0);
  });

  it('boosts only producer candidates, exactly at the cap, when the commander wants untap', () => {
    const boosts = computeUntapVisibilityBoosts(
      ['Aphetto Alchemist', 'Vizier of Tumbling Sands', 'Divination'],
      untapCardMap,
      true,
      isProducer
    );
    expect(boosts.get('Aphetto Alchemist')).toBe(UNTAP_VISIBILITY_BOOST_MAX);
    expect(boosts.get('Vizier of Tumbling Sands')).toBe(UNTAP_VISIBILITY_BOOST_MAX);
    expect(boosts.has('Divination')).toBe(false); // non-producer → absent, not zero-valued
  });

  it('does not throw on a candidate name missing from cardMap', () => {
    const boosts = computeUntapVisibilityBoosts(
      ['Nonexistent Card'],
      untapCardMap,
      true,
      isProducer
    );
    expect(boosts.size).toBe(0);
  });
});

describe('computeBlinkVisibilityBoosts', () => {
  // isProducer is injected (mirrors computeUntapVisibilityBoosts's) — a
  // simple name-set stub is enough here, the real classifier's regex is
  // covered in tagger/client.test.ts.
  const blinkProducerNames = new Set(['Ephemerate', 'Restoration Angel']);
  const isProducer = (c: ScryfallCard) => blinkProducerNames.has(c.name);
  const ephemerate = card(
    'Ephemerate',
    "Exile target creature you control, then return it to the battlefield under its owner's control."
  );
  const restorationAngel = card(
    'Restoration Angel',
    'Flash\nFlying\nWhen this creature enters, you may exile target non-Angel creature you control, then return that card to the battlefield under your control.'
  );
  const blinkCardMap = new Map([ephemerate, restorationAngel, divination].map((c) => [c.name, c]));

  it('stays an empty map when the commander does not want blink (near-inert requirement)', () => {
    const boosts = computeBlinkVisibilityBoosts(
      ['Ephemerate', 'Restoration Angel', 'Divination'],
      blinkCardMap,
      false,
      isProducer
    );
    expect(boosts.size).toBe(0);
  });

  it('boosts only producer candidates, exactly at the cap, when the commander wants blink', () => {
    const boosts = computeBlinkVisibilityBoosts(
      ['Ephemerate', 'Restoration Angel', 'Divination'],
      blinkCardMap,
      true,
      isProducer
    );
    expect(boosts.get('Ephemerate')).toBe(BLINK_VISIBILITY_BOOST_MAX);
    expect(boosts.get('Restoration Angel')).toBe(BLINK_VISIBILITY_BOOST_MAX);
    expect(boosts.has('Divination')).toBe(false); // non-producer → absent, not zero-valued
  });

  it('does not throw on a candidate name missing from cardMap', () => {
    const boosts = computeBlinkVisibilityBoosts(
      ['Nonexistent Card'],
      blinkCardMap,
      true,
      isProducer
    );
    expect(boosts.size).toBe(0);
  });
});

describe('computeExileVisibilityBoosts', () => {
  // isProducer is injected (mirrors computeUntapVisibilityBoosts's) — a
  // simple name-set stub is enough here, the real classifier's regex is
  // covered in tagger/client.test.ts.
  const exileProducerNames = new Set(['Prosper, Tome-Bound', "Jeska's Will"]);
  const isProducer = (c: ScryfallCard) => exileProducerNames.has(c.name);
  const prosper = card(
    'Prosper, Tome-Bound',
    'Mystic Arcanum — At the beginning of your end step, exile the top card of your library. Until the end of your next turn, you may play that card.'
  );
  const jeskasWill = card(
    "Jeska's Will",
    'Exile the top three cards of your library. You may play them this turn.'
  );
  const exileCardMap = new Map([prosper, jeskasWill, divination].map((c) => [c.name, c]));

  it('stays an empty map when the commander does not want exile-matters (near-inert requirement)', () => {
    const boosts = computeExileVisibilityBoosts(
      ['Prosper, Tome-Bound', "Jeska's Will", 'Divination'],
      exileCardMap,
      false,
      isProducer
    );
    expect(boosts.size).toBe(0);
  });

  it('boosts only producer candidates, exactly at the cap, when the commander wants exile-matters', () => {
    const boosts = computeExileVisibilityBoosts(
      ['Prosper, Tome-Bound', "Jeska's Will", 'Divination'],
      exileCardMap,
      true,
      isProducer
    );
    expect(boosts.get('Prosper, Tome-Bound')).toBe(EXILE_VISIBILITY_BOOST_MAX);
    expect(boosts.get("Jeska's Will")).toBe(EXILE_VISIBILITY_BOOST_MAX);
    expect(boosts.has('Divination')).toBe(false); // non-producer → absent, not zero-valued
  });

  it('does not throw on a candidate name missing from cardMap', () => {
    const boosts = computeExileVisibilityBoosts(
      ['Nonexistent Card'],
      exileCardMap,
      true,
      isProducer
    );
    expect(boosts.size).toBe(0);
  });
});

describe('computeExtraCombatVisibilityBoosts', () => {
  // isProducer is injected (mirrors computeExileVisibilityBoosts's) — a
  // simple name-set stub is enough here, the real classifier's regex is
  // covered in tagger/client.test.ts.
  const extraCombatProducerNames = new Set(['Aggravated Assault', 'Aurelia, the Warleader']);
  const isProducer = (c: ScryfallCard) => extraCombatProducerNames.has(c.name);
  const aggravatedAssault = card(
    'Aggravated Assault',
    '{3}{R}{R}: Untap all creatures you control. After this main phase, there is an additional combat phase followed by an additional main phase. Activate only as a sorcery.'
  );
  const aurelia = card(
    'Aurelia, the Warleader',
    'Whenever Aurelia attacks for the first time each turn, untap all creatures you control. After this phase, there is an additional combat phase.'
  );
  const extraCombatCardMap = new Map(
    [aggravatedAssault, aurelia, divination].map((c) => [c.name, c])
  );

  it('stays an empty map when the commander does not want extra combats (near-inert requirement)', () => {
    const boosts = computeExtraCombatVisibilityBoosts(
      ['Aggravated Assault', 'Aurelia, the Warleader', 'Divination'],
      extraCombatCardMap,
      false,
      isProducer
    );
    expect(boosts.size).toBe(0);
  });

  it('boosts only producer candidates, exactly at the cap, when the commander wants extra combats', () => {
    const boosts = computeExtraCombatVisibilityBoosts(
      ['Aggravated Assault', 'Aurelia, the Warleader', 'Divination'],
      extraCombatCardMap,
      true,
      isProducer
    );
    expect(boosts.get('Aggravated Assault')).toBe(EXTRA_COMBAT_VISIBILITY_BOOST_MAX);
    expect(boosts.get('Aurelia, the Warleader')).toBe(EXTRA_COMBAT_VISIBILITY_BOOST_MAX);
    expect(boosts.has('Divination')).toBe(false); // non-producer → absent, not zero-valued
  });

  it('does not throw on a candidate name missing from cardMap', () => {
    const boosts = computeExtraCombatVisibilityBoosts(
      ['Nonexistent Card'],
      extraCombatCardMap,
      true,
      isProducer
    );
    expect(boosts.size).toBe(0);
  });
});
