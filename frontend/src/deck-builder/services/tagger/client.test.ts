import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  loadTaggerData,
  getCardRole,
  cubeRole,
  validateCardRole,
  isProtectionPiece,
  isFreeInteraction,
  isUntapProducer,
  isBlinkProducer,
  isExileProducer,
  isExtraCombatPiece,
  isOneSidedWipe,
  getWipeScope,
} from './client';

// Minimal tagger dataset: a cost-reducer (which the generic classifier folds
// into "ramp"), a genuine ramp spell, and a removal spell. Also includes
// Expropriate mistagged 'ramp' (the real-world bug this sanity layer catches)
// and Divination for the cardDraw check.
const DATA = {
  generatedAt: '2026-06-21T00:00:00Z',
  tags: {
    'cost-reducer': ['Puresteel Paladin'],
    removal: [
      'Swords to Plowshares',
      'Lightning Bolt',
      "Vraska's Fall",
      'Ulamog, the Ceaseless Hunger',
      'Endbringer',
      'Fleshbag Marauder',
      'Flayer of Loyalties',
      "Kenrith's Transformation",
      'Hullbreaker Horror',
      'Spatial Contortion',
    ],
    boardwipe: [
      'Wrath of God',
      'Farewell',
      'Devastation Tide',
      'Ruinous Ultimatum',
      'Blasphemous Act',
      'Damn',
      'Vandalblast',
      'Austere Command',
      'The Eternal Wanderer',
      'Massacre Wurm',
      'Silumgar, the Drifting Death',
      'Selective Obliteration',
      'Aetherize',
      'Spectral Deluge',
      'Cyclonic Rift',
      'Contagion Engine',
    ],
    'card-advantage': ['Divination', 'Experimental Augury', 'Eternal Witness'],
    tutor: [
      'Vampiric Tutor',
      'Demonic Tutor',
      'Worldly Tutor',
      'Entomb',
      'Buried Alive',
      'Natural Order',
      'Survival of the Fittest',
      'Protean Hulk',
      'Opposition Agent',
    ],
    ramp: [
      'Cultivate',
      'Sol Ring',
      'Expropriate',
      'Ramp DFC',
      'Wild Growth',
      'Utopia Sprawl',
      'Sanctum Weaver',
      'Smothering Tithe',
      'Dockside Extortionist',
      'Pitiless Plunderer',
      'Revel in Riches',
      'Mana Echoes',
      "Lion's Eye Diamond",
      'Morophon, the Boundless',
      'Oblivion Sower',
    ],
  },
};

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => DATA }) as unknown as Response)
  );
  await loadTaggerData();
});

describe('cubeRole', () => {
  it('demotes a cost-reducer-only "ramp" to no role (misleading in a cube)', () => {
    expect(getCardRole('Puresteel Paladin')).toBe('ramp'); // generic tagger says ramp
    expect(cubeRole('Puresteel Paladin')).toBeNull(); // cube view: not real acceleration
  });

  it('keeps genuine ramp and unrelated roles untouched', () => {
    expect(cubeRole('Cultivate')).toBe('ramp');
    expect(cubeRole('Swords to Plowshares')).toBe('removal');
  });
});

describe('validateCardRole', () => {
  it('confirms a real ramp card whose oracle text corroborates mana production', () => {
    expect(validateCardRole({ name: 'Sol Ring', oracle_text: '{T}: Add {C}{C}.' })).toBe('ramp');
  });

  it('confirms a real ramp card whose oracle text corroborates land fetch', () => {
    expect(
      validateCardRole({
        name: 'Cultivate',
        oracle_text:
          'Search your library for up to two basic land cards, reveal them, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      })
    ).toBe('ramp');
  });

  it('drops a role mistagged onto a card with no supporting evidence (Expropriate)', () => {
    // Real Expropriate text: an extra-turns/draw effect, not mana production —
    // tagged 'ramp' upstream (E77 iter-3 evidence), but the oracle text has
    // none of add-mana/cost-reduction/land-fetch.
    expect(
      validateCardRole({
        name: 'Expropriate',
        oracle_text:
          'Choose one or both — Target player takes an extra turn after this one; Draw a card.',
      })
    ).toBeNull();
    // The raw (unvalidated) tag still says ramp — this is what validateCardRole guards against.
    expect(getCardRole('Expropriate')).toBe('ramp');
  });

  it('drops a role when the cached oracle text is corrupt/mismatched for the claimed role', () => {
    // Simulates a corrupt/mismatched Scryfall record: tagged 'ramp' but the
    // text on file doesn't describe mana production, cost reduction, or land
    // fetch at all (e.g. a keyword-only line from an unrelated printing).
    expect(
      validateCardRole({ name: 'Sol Ring', oracle_text: 'Flying, vigilance, deathtouch.' })
    ).toBeNull();
  });

  it('confirms removal, boardwipe, and cardDraw with matching evidence', () => {
    expect(
      validateCardRole({
        name: 'Swords to Plowshares',
        oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
      })
    ).toBe('removal');
    expect(
      validateCardRole({
        name: 'Wrath of God',
        oracle_text: "Destroy all creatures. They can't be regenerated.",
      })
    ).toBe('boardwipe');
    expect(validateCardRole({ name: 'Divination', oracle_text: 'Draw two cards.' })).toBe(
      'cardDraw'
    );
  });

  it('falls back to trusting the tag when no oracle text is available to check', () => {
    expect(validateCardRole({ name: 'Sol Ring' })).toBe('ramp');
  });

  it('checks card_faces oracle text for DFCs (front face has no oracle_text of its own)', () => {
    expect(
      validateCardRole({
        name: 'Ramp DFC',
        card_faces: [{ oracle_text: '{T}: Add {C}{C}.' }, { oracle_text: 'Land face text' }],
      })
    ).toBe('ramp');
  });

  it('returns null for a card with no tagged role at all', () => {
    expect(validateCardRole({ name: 'Untagged Card', oracle_text: 'Draw a card.' })).toBeNull();
  });
});

describe('validateCardRole — round-2 evidence gaps', () => {
  // Tutors: getCardRole folds 'tutor' into cardDraw — any search-destination
  // corroborates (not just "into hand"), since the taxonomy call (tutor =
  // cardDraw) isn't this gate's job to re-litigate.
  it.each([
    [
      'Vampiric Tutor',
      'Search your library for a card and put it on top of your library. Then shuffle your library. You lose 2 life.',
    ],
    [
      'Demonic Tutor',
      'Search your library for a card, reveal it, put it into your hand, then shuffle.',
    ],
    [
      'Worldly Tutor',
      'Search your library for a creature card, reveal it, put it into your hand, then shuffle.',
    ],
    ['Entomb', 'Search your library for a card and put it into your graveyard, then shuffle.'],
    [
      'Buried Alive',
      'Search your library for up to three creature cards and put them into your graveyard, then shuffle.',
    ],
    [
      'Natural Order',
      'Sacrifice a Forest. Search your library for a green creature card, put it onto the battlefield, then shuffle.',
    ],
    [
      'Survival of the Fittest',
      'Discard a creature card: Search your library for a creature card, reveal it, put it into your hand, then shuffle.',
    ],
    [
      'Protean Hulk',
      'When Protean Hulk dies, search your library for any number of creature cards with total mana value 6 or less and put them onto the battlefield, then shuffle.',
    ],
    [
      'Opposition Agent',
      // Round 4 fix: this fixture previously used fabricated text that didn't
      // match the real card and happened to pass by coincidence. The REAL
      // Opposition Agent doesn't search YOUR library at all — it redirects an
      // OPPONENT's search — so it needs the broadened search(ing) pattern
      // below, not the "search your library for ... card" one.
      "Flash\nYou control your opponents while they're searching their libraries.\nWhile an opponent is searching their library, they exile each card they would draw, mill, or put into their hand or library this way. You may put any number of the exiled cards into that player's hand and the rest into that player's graveyard.",
    ],
  ])('confirms tutor %s as cardDraw regardless of search destination', (name, oracle_text) => {
    expect(validateCardRole({ name, oracle_text })).toBe('cardDraw');
  });

  // Boardwipe: exile-based and return-all bounce wipes, not just "destroy all".
  it('confirms Farewell (exile-based modal wipe) as boardwipe', () => {
    expect(
      validateCardRole({
        name: 'Farewell',
        oracle_text:
          'Choose one or more — Exile all creatures. Their controllers create that many 1/1 white Spirit creature tokens. Exile all artifacts and enchantments. Exile all graveyards.',
      })
    ).toBe('boardwipe');
  });

  it('confirms Devastation Tide (return-all bounce wipe) as boardwipe', () => {
    expect(
      validateCardRole({
        name: 'Devastation Tide',
        oracle_text:
          "Return all permanents to their owners' hands except for lands and permanents with mana value 6 or greater.",
      })
    ).toBe('boardwipe');
  });

  // Ramp: Treasure-makers, land-aura "adds an additional {G}" phrasing, and
  // "Add X mana of any one color" (variable-amount infix).
  it('confirms Treasure-makers as ramp (deferred mana via a Treasure token)', () => {
    expect(
      validateCardRole({
        name: 'Smothering Tithe',
        oracle_text:
          'Whenever an opponent draws a card, you may have that player create a Treasure token unless they pay {2}.',
      })
    ).toBe('ramp');
    expect(
      validateCardRole({
        name: 'Dockside Extortionist',
        oracle_text:
          "When Dockside Extortionist enters the battlefield, create X Treasure tokens, where X is the number of artifacts and/or enchantments you don't control.",
      })
    ).toBe('ramp');
    expect(
      validateCardRole({
        name: 'Pitiless Plunderer',
        oracle_text:
          "Whenever a creature you control dies, if it wasn't a Treasure, you may create a Treasure token.",
      })
    ).toBe('ramp');
    expect(
      validateCardRole({
        name: 'Revel in Riches',
        oracle_text:
          'Whenever a creature an opponent controls dies, create a Treasure token. If you control ten or more Treasures, you win the game.',
      })
    ).toBe('ramp');
  });

  it('confirms land-aura "adds an additional {G}" mana boosters as ramp', () => {
    expect(
      validateCardRole({
        name: 'Wild Growth',
        oracle_text:
          'Enchant land. Whenever enchanted land is tapped for mana, its controller adds an additional {G}.',
      })
    ).toBe('ramp');
    expect(
      validateCardRole({
        name: 'Utopia Sprawl',
        oracle_text:
          'Enchant land you control. You may put Utopia Sprawl onto the battlefield as an additional cost to cast a green spell. Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any color permanent among lands you control.',
      })
    ).toBe('ramp');
  });

  it('confirms "Add X mana of any one color" (variable-amount infix) as ramp', () => {
    expect(
      validateCardRole({
        name: 'Sanctum Weaver',
        oracle_text:
          'Whenever a permanent you control with a +1/+1 counter on it enters, add one mana of any color. {T}: Add X mana of any one color, where X is the number of permanents you control with +1/+1 counters on them.',
      })
    ).toBe('ramp');
  });

  it('still rejects Expropriate for ramp (no treasure/mana-boost text of its own)', () => {
    expect(
      validateCardRole({
        name: 'Expropriate',
        oracle_text:
          'Choose one or both — Target player takes an extra turn after this one; Draw a card.',
      })
    ).toBeNull();
  });
});

describe('validateCardRole — round-4 boardwipe evidence (Isshin 7-wipe differ)', () => {
  // The differ found the same physical 7 board wipes running unchanged
  // across 3 iterations because 2 of them (Damn, Vandalblast) lost their
  // boardwipe tag to the sanity gate: their overload mode replaces "target"
  // with "each" via a RULES INSTRUCTION in the reminder text, never literally
  // in the effect line — so "destroy each creature" never appears as a
  // string. Every one of these 7 real wipes must validate as boardwipe.
  it.each([
    [
      'Ruinous Ultimatum',
      'For each opponent, destroy up to one target permanent that player controls of each permanent type.',
    ],
    [
      'Farewell',
      'Choose one or more — Exile all creatures. Their controllers create that many 1/1 white Spirit creature tokens. Exile all artifacts and enchantments. Exile all graveyards.',
    ],
    [
      'Blasphemous Act',
      'This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.',
    ],
    [
      'Damn',
      'Choose one —\n• Destroy target creature. It can\'t be regenerated.\n• Overload {2}{W}{W} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of "target" with "each.")',
    ],
    [
      'Vandalblast',
      'Destroy target artifact you don\'t control.\nOverload {4}{R} (You may cast this spell for its overload cost. If you do, change "target" in its text with "each.")',
    ],
    [
      'Austere Command',
      'Choose two —\n• Destroy all artifacts.\n• Destroy all enchantments.\n• Destroy all creatures with power 3 or greater.\n• Destroy all creatures with power 2 or less.',
    ],
    [
      'The Eternal Wanderer',
      '+1: Put a loyalty counter on target permanent you control. It gains hexproof until your next turn.\n−2: Exile all creatures with power 2 or less.\n0: You may cast target instant or sorcery card from your graveyard this turn. If that spell would be put into your graveyard, exile it instead.',
    ],
  ])('confirms %s (real Isshin wipe) as boardwipe', (name, oracle_text) => {
    expect(validateCardRole({ name, oracle_text })).toBe('boardwipe');
  });
});

describe('validateCardRole — round-4 strip-sweep pattern fixes', () => {
  // One test per NEW pattern (not per stripped card — see the round-4 report
  // for the full per-card verdict table from the decks-iter4b sweep).

  it('boardwipe: Overload co-occurring with a return-target clause (Cyclonic Rift)', () => {
    expect(
      validateCardRole({
        name: 'Cyclonic Rift',
        oracle_text:
          'Return target nonland permanent you don\'t control to its owner\'s hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of "target" with "each.")',
      })
    ).toBe('boardwipe');
  });

  it('boardwipe: one-sided "-N/-N to an opponent\'s board" without "all"/"each" (Massacre Wurm, Silumgar)', () => {
    expect(
      validateCardRole({
        name: 'Massacre Wurm',
        oracle_text:
          'When this creature enters, creatures your opponents control get -2/-2 until end of turn. Whenever a creature an opponent controls dies, that player loses 2 life.',
      })
    ).toBe('boardwipe');
    expect(
      validateCardRole({
        name: 'Silumgar, the Drifting Death',
        oracle_text:
          'Flying, hexproof\nWhenever a Dragon you control attacks, creatures defending player controls get -1/-1 until end of turn.',
      })
    ).toBe('boardwipe');
  });

  it('boardwipe: exile/return each PERMANENT, not just creature (Selective Obliteration, Spectral Deluge)', () => {
    expect(
      validateCardRole({
        name: 'Selective Obliteration',
        oracle_text:
          "Each player chooses a color. Then exile each permanent unless it's colorless or it's only the color its controller chose.",
      })
    ).toBe('boardwipe');
    expect(
      validateCardRole({
        name: 'Spectral Deluge',
        oracle_text:
          "Return each creature your opponents control with toughness X or less to its owner's hand, where X is the number of Islands you control.",
      })
    ).toBe('boardwipe');
  });

  it('boardwipe: lenient "return all" gap (Aetherize: "return all ATTACKING creatures")', () => {
    expect(
      validateCardRole({
        name: 'Aetherize',
        oracle_text: "Return all attacking creatures to their owner's hand.",
      })
    ).toBe('boardwipe');
  });

  it('boardwipe: counter-based one-sided wipe (Contagion Engine)', () => {
    expect(
      validateCardRole({
        name: 'Contagion Engine',
        oracle_text:
          'When this artifact enters, put a -1/-1 counter on each creature target player controls.\n{4}, {T}: Proliferate twice.',
      })
    ).toBe('boardwipe');
  });

  it('removal: damage-based removal (burn/reach — Lightning Bolt, Endbringer)', () => {
    expect(
      validateCardRole({
        name: 'Lightning Bolt',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      })
    ).toBe('removal');
    expect(
      validateCardRole({
        name: 'Endbringer',
        oracle_text:
          "Untap this creature during each other player's untap step.\n{T}: This creature deals 1 damage to any target.\n{C}, {T}: Target creature can't block this turn.",
      })
    ).toBe('removal');
  });

  it('removal: lenient exile-target gap ("exile TWO target permanents")', () => {
    expect(
      validateCardRole({
        name: 'Ulamog, the Ceaseless Hunger',
        oracle_text: 'When you cast this spell, exile two target permanents.',
      })
    ).toBe('removal');
  });

  it('removal: sacrifice-edict with any forcing subject, not just "target player" (Vraska\'s Fall, Fleshbag Marauder)', () => {
    expect(
      validateCardRole({
        name: "Vraska's Fall",
        oracle_text:
          'Each opponent sacrifices a creature or planeswalker of their choice and gets a poison counter.',
      })
    ).toBe('removal');
    expect(
      validateCardRole({
        name: 'Fleshbag Marauder',
        oracle_text:
          'When this creature enters, each player sacrifices a creature of their choice.',
      })
    ).toBe('removal');
  });

  it('removal: Threaten-style "gain control of target creature" (Flayer of Loyalties)', () => {
    expect(
      validateCardRole({
        name: 'Flayer of Loyalties',
        oracle_text:
          'When you cast this spell, gain control of target creature until end of turn. Untap that creature. Until end of turn, it has base power and toughness 13/13 and gains trample and haste.',
      })
    ).toBe('removal');
  });

  it('removal: Pacifism/Song-of-the-Dryads-style "loses all abilities" auras (Kenrith\'s Transformation)', () => {
    expect(
      validateCardRole({
        name: "Kenrith's Transformation",
        oracle_text:
          'Enchant creature\nWhen this Aura enters, draw a card.\nEnchanted creature loses all abilities and is a green Elk creature with base power and toughness 3/3.',
      })
    ).toBe('removal');
  });

  it('removal: "return target SPELL" (Hullbreaker Horror bounce-as-counter)', () => {
    expect(
      validateCardRole({
        name: 'Hullbreaker Horror',
        oracle_text:
          "Flash\nThis spell can't be countered.\nWhenever you cast a spell, choose up to one — Return target spell you don't control to its owner's hand.",
      })
    ).toBe('removal');
  });

  it('removal: asymmetric pump-down, not just symmetric -N/-N (Spatial Contortion)', () => {
    expect(
      validateCardRole({
        name: 'Spatial Contortion',
        oracle_text: 'Target creature gets +3/-3 until end of turn.',
      })
    ).toBe('removal');
  });

  it('ramp: consolidated add-mana infix (number words, "an amount of", DFC-safe) (Mana Echoes, Lion\'s Eye Diamond)', () => {
    expect(
      validateCardRole({
        name: 'Mana Echoes',
        oracle_text:
          'Whenever a creature enters, you may add an amount of {C} equal to the number of creatures you control that share a creature type with it.',
      })
    ).toBe('ramp');
    expect(
      validateCardRole({
        name: "Lion's Eye Diamond",
        oracle_text:
          'Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only as an instant.',
      })
    ).toBe('ramp');
  });

  it('ramp: colored-symbol cost reduction, not just a digit (Morophon, the Boundless)', () => {
    expect(
      validateCardRole({
        name: 'Morophon, the Boundless',
        oracle_text:
          'Changeling (This card is every creature type.)\nAs Morophon enters, choose a creature type.\nSpells of the chosen type you cast cost {W}{U}{B}{R}{G} less to cast.',
      })
    ).toBe('ramp');
  });

  it('ramp: land-onto-battlefield via exile, not search (Oblivion Sower)', () => {
    expect(
      validateCardRole({
        name: 'Oblivion Sower',
        oracle_text:
          'When you cast this spell, target opponent exiles the top four cards of their library. Put any number of land cards from among them onto the battlefield under your control.',
      })
    ).toBe('ramp');
  });

  it('cardDraw: library-top manipulation, any destination (Experimental Augury)', () => {
    expect(
      validateCardRole({
        name: 'Experimental Augury',
        oracle_text:
          'Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.',
      })
    ).toBe('cardDraw');
  });

  it('cardDraw: graveyard-to-hand recursion (Eternal Witness)', () => {
    expect(
      validateCardRole({
        name: 'Eternal Witness',
        oracle_text:
          'When this creature enters, you may return target card from your graveyard to your hand.',
      })
    ).toBe('cardDraw');
  });
});

// isProtectionPiece (E87-new Slice A): a parallel, roleless class flag — not
// gated on any tagger tag (see the sparse/mixed-signal `protection` otag,
// no otag fetch list exists in this repo either), pure oracle-text evidence.
describe('isProtectionPiece', () => {
  it('mass/anthem grant to your stuff (Heroic Intervention)', () => {
    expect(
      isProtectionPiece({
        name: 'Heroic Intervention',
        oracle_text:
          "Permanents you control gain hexproof and indestructible until end of turn. (They can't be the targets of spells or abilities your opponents control. They can't be destroyed.)",
      })
    ).toBe(true);
  });

  it('equipment granting hexproof to its bearer (Swiftfoot Boots)', () => {
    expect(
      isProtectionPiece({
        name: 'Swiftfoot Boots',
        oracle_text: 'Equipped creature has hexproof and haste.\nEquip {1}',
      })
    ).toBe(true);
  });

  it('equipment granting shroud to its bearer (Lightning Greaves)', () => {
    expect(
      isProtectionPiece({
        name: 'Lightning Greaves',
        oracle_text:
          "Equipped creature has haste.\nEquipped creature has shroud. (It can't be the target of spells or abilities.)\nEquip {0}",
      })
    ).toBe(true);
  });

  it('single-target protection grant (Mother of Runes)', () => {
    expect(
      isProtectionPiece({
        name: 'Mother of Runes',
        oracle_text:
          '{T}: Target creature you control gains protection from the color of your choice until end of turn.',
      })
    ).toBe(true);
  });

  it('commander-gated free cast + counter, noncreature branch (Fierce Guardianship — live oracle text, iter-10 Slice A fix)', () => {
    // Live-verified real text (was previously a fabricated fixture attributed
    // to this card — see iter-10 Slice A's fixture-correction pass). Only
    // passes because of the widened `counter target(?: noncreature)? spell`
    // branch above — pre-fix this card was a live, unnoticed miss.
    expect(
      isProtectionPiece({
        name: 'Fierce Guardianship',
        oracle_text:
          'If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.',
      })
    ).toBe(true);
  });

  it('synthetic sentence-crossing alt-cost counterspell (not a real card — exercises the [\\s\\S] cross-newline path with an extra qualifying clause)', () => {
    // The fixture previously (mis)attributed to Fierce Guardianship above —
    // kept as a synthetic case since it exercises a template shape (a
    // targeting-restriction clause between the alt-cost sentence and the
    // counter clause, with a "pay {N}" soft-counter tail) distinct from the
    // real card's own text.
    expect(
      isProtectionPiece({
        name: 'Synthetic Sentence-Crossing Counterspell',
        oracle_text:
          "You may cast this spell without paying its mana cost if it targets a permanent or player you control and it isn't your turn.\nCounter target spell unless its controller pays {5}.",
      })
    ).toBe(true);
  });

  it('unconditional redirect (Deflecting Swat — "rather than pay", not "without paying" — live oracle text, iter-10 Slice A fix)', () => {
    // Live-verified real text (was previously a fabricated fixture attributed
    // to this card).
    expect(
      isProtectionPiece({
        name: 'Deflecting Swat',
        oracle_text:
          'If you control a commander, you may cast this spell without paying its mana cost.\nYou may choose new targets for target spell or ability.',
      })
    ).toBe(true);
  });

  it("granting-subject can't-be-countered (Prowling Serpopard)", () => {
    expect(
      isProtectionPiece({
        name: 'Prowling Serpopard',
        oracle_text:
          "Creature spells you control can't be countered. Spells your opponents cast that target a Cat you control cost {2} more to cast.",
      })
    ).toBe(true);
  });

  it("granting-subject can't-be-countered (Vexing Shusher)", () => {
    expect(
      isProtectionPiece({
        name: 'Vexing Shusher',
        oracle_text:
          "Target spell can't be countered.\n{2}{R}: Vexing Shusher deals 2 damage to any target.",
      })
    ).toBe(true);
  });

  it("phasing/fog protection (Teferi's Protection)", () => {
    expect(
      isProtectionPiece({
        name: "Teferi's Protection",
        oracle_text:
          "Until your next turn, you and permanents you own have hexproof and phasing, and you can't lose the game and your opponents can't win the game.",
      })
    ).toBe(true);
  });

  it("does NOT match a bare self can't-be-countered clause (Supreme Verdict — false-positive guard)", () => {
    // The exact failure mode this class must avoid: Supreme Verdict's own
    // "this spell can't be countered" self-protection is NOT a grant to the
    // player's board and must not read as a protection piece (it would
    // otherwise silently gain +100 trim resistance in the live eval panel).
    expect(
      isProtectionPiece({
        name: 'Supreme Verdict',
        oracle_text: "This spell can't be countered.\nDestroy all creatures.",
      })
    ).toBe(false);
  });

  it('does NOT match a bare static "Protection from X" keyword line (Progenitus)', () => {
    expect(
      isProtectionPiece({
        name: 'Progenitus',
        oracle_text:
          "Protection from everything.\nIf Progenitus would be put into a graveyard from anywhere, reveal Progenitus and shuffle it into its owner's library instead.",
      })
    ).toBe(false);
  });

  it('does NOT match a plain removal spell (Path to Exile)', () => {
    expect(
      isProtectionPiece({
        name: 'Path to Exile',
        oracle_text:
          'Exile target creature. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.',
      })
    ).toBe(false);
  });

  it('returns false for a text-less card (opposite fallback direction from validateCardRole — no tag to trust)', () => {
    expect(isProtectionPiece({ name: 'No-Text Card' })).toBe(false);
  });
});

// isUntapProducer (E89, iter-7 Slice E) — every oracle_text below verified
// live against the Scryfall API before being written in.
describe('isUntapProducer', () => {
  it('single-target untap (Aphetto Alchemist)', () => {
    expect(
      isUntapProducer({
        name: 'Aphetto Alchemist',
        oracle_text:
          '{T}: Untap target artifact or creature.\nMorph {U} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)',
      })
    ).toBe(true);
  });

  it('"untap another target" (Vizier of Tumbling Sands)', () => {
    expect(
      isUntapProducer({
        name: 'Vizier of Tumbling Sands',
        oracle_text:
          '{T}: Untap another target permanent.\nCycling {1}{U} ({1}{U}, Discard this card: Draw a card.)\nWhen you cycle this card, untap target permanent.',
      })
    ).toBe(true);
  });

  it('untap buried inside a tap-or-untap ability (Fatestitcher)', () => {
    expect(
      isUntapProducer({
        name: 'Fatestitcher',
        oracle_text: '{T}: You may tap or untap another target permanent.\nUnearth {U}',
      })
    ).toBe(true);
  });

  it('"untap another target permanent you control" (Kelpie Guide)', () => {
    expect(
      isUntapProducer({
        name: 'Kelpie Guide',
        oracle_text:
          '{T}: Untap another target permanent you control.\n{T}: Tap target permanent. Activate only if you control eight or more lands.',
      })
    ).toBe(true);
  });

  it("Kiora's Follower", () => {
    expect(
      isUntapProducer({
        name: "Kiora's Follower",
        oracle_text: '{T}: Untap another target permanent.',
      })
    ).toBe(true);
  });

  it('mass untap, nonland-qualified (Dramatic Reversal)', () => {
    expect(
      isUntapProducer({
        name: 'Dramatic Reversal',
        oracle_text: 'Untap all nonland permanents you control.',
      })
    ).toBe(true);
  });

  it('mass untap on an extra-untap-step trigger (Drumbellower)', () => {
    expect(
      isUntapProducer({
        name: 'Drumbellower',
        oracle_text:
          "Flying\nUntap all creatures you control during each other player's untap step.",
      })
    ).toBe(true);
  });

  it('mass untap on an extra-untap-step trigger (Seedborn Muse)', () => {
    expect(
      isUntapProducer({
        name: 'Seedborn Muse',
        oracle_text: "Untap all permanents you control during each other player's untap step.",
      })
    ).toBe(true);
  });

  it('mass untap on an extra-untap-step trigger (Unwinding Clock)', () => {
    expect(
      isUntapProducer({
        name: 'Unwinding Clock',
        oracle_text: "Untap all artifacts you control during each other player's untap step.",
      })
    ).toBe(true);
  });

  it('bare "Untap them" callback (Valley Floodcaller)', () => {
    expect(
      isUntapProducer({
        name: 'Valley Floodcaller',
        oracle_text:
          'Flash\nYou may cast noncreature spells as though they had flash.\nWhenever you cast a noncreature spell, Birds, Frogs, Otters, and Rats you control get +1/+1 until end of turn. Untap them.',
      })
    ).toBe(true);
  });

  it('planeswalker loyalty ability flows through plain oracle_text (Tezzeret, Cruel Captain)', () => {
    expect(
      isUntapProducer({
        name: 'Tezzeret, Cruel Captain',
        oracle_text:
          "Whenever an artifact you control enters, put a loyalty counter on Tezzeret.\n0: Untap target artifact or creature. If it's an artifact creature, put a +1/+1 counter on it.\n−3: Search your library for an artifact card with mana value 1 or less, reveal it, put it into your hand, then shuffle.",
      })
    ).toBe(true);
  });

  it('does NOT match the tap-down idiom (Frost Titan)', () => {
    expect(
      isUntapProducer({
        name: 'Frost Titan',
        oracle_text:
          "Whenever this creature becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {2}.\nWhenever this creature enters or attacks, tap target permanent. It doesn't untap during its controller's next untap step.",
      })
    ).toBe(false);
  });

  it('does NOT match the tap-down idiom (Icefall Regent)', () => {
    expect(
      isUntapProducer({
        name: 'Icefall Regent',
        oracle_text:
          "Flying\nWhen this creature enters, tap target creature an opponent controls. That creature doesn't untap during its controller's untap step for as long as you control this creature.\nSpells your opponents cast that target this creature cost {2} more to cast.",
      })
    ).toBe(false);
  });

  it('does NOT match the self-only "choose not to untap" idiom (Amber Prison)', () => {
    expect(
      isUntapProducer({
        name: 'Amber Prison',
        oracle_text:
          "You may choose not to untap this artifact during your untap step.\n{4}, {T}: Tap target artifact, creature, or land. That permanent doesn't untap during its controller's untap step for as long as this artifact remains tapped.",
      })
    ).toBe(false);
  });

  it('does NOT match an opponent-restriction untap lock (Winter Orb)', () => {
    expect(
      isUntapProducer({
        name: 'Winter Orb',
        oracle_text:
          "As long as this artifact is untapped, players can't untap more than one land during their untap steps.",
      })
    ).toBe(false);
  });

  it('does NOT match exert self-untap plumbing (Ahn-Crop Crasher)', () => {
    expect(
      isUntapProducer({
        name: 'Ahn-Crop Crasher',
        oracle_text:
          "Haste (This creature can attack and {T} as soon as it comes under your control.)\nYou may exert this creature as it attacks. When you do, target creature can't block this turn. (An exerted creature won't untap during your next untap step.)",
      })
    ).toBe(false);
  });

  it('does NOT match a plain vigilance creature with no untap text (Serra Angel)', () => {
    expect(
      isUntapProducer({
        name: 'Serra Angel',
        oracle_text: "Flying\nVigilance (Attacking doesn't cause this creature to tap.)",
      })
    ).toBe(false);
  });

  it('does NOT match a plain mana dork/rock (Sol Ring)', () => {
    expect(
      isUntapProducer({
        name: 'Sol Ring',
        oracle_text: '{T}: Add {C}{C}.',
      })
    ).toBe(false);
  });

  it('does NOT match unrelated staples (Path to Exile, Rhystic Study)', () => {
    expect(
      isUntapProducer({
        name: 'Path to Exile',
        oracle_text:
          'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
      })
    ).toBe(false);
    expect(
      isUntapProducer({
        name: 'Rhystic Study',
        oracle_text:
          'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
      })
    ).toBe(false);
  });

  it('returns false for a text-less card (no tag to trust — there is no tag for this class)', () => {
    expect(isUntapProducer({ name: 'No-Text Card' })).toBe(false);
  });
});

// isBlinkProducer (iter-8 Slice B) — every oracle_text below verified live
// against the Scryfall API before being written in.
describe('isBlinkProducer', () => {
  it('anaphoric "it" (Ephemerate)', () => {
    expect(
      isBlinkProducer({
        name: 'Ephemerate',
        oracle_text:
          "Exile target creature you control, then return it to the battlefield under its owner's control.\nRebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)",
      })
    ).toBe(true);
  });

  it('anaphoric "it" (Momentary Blink)', () => {
    expect(
      isBlinkProducer({
        name: 'Momentary Blink',
        oracle_text:
          "Exile target creature you control, then return it to the battlefield under its owner's control.\nFlashback {3}{U} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
      })
    ).toBe(true);
  });

  it('anaphoric "that card" (Conjurer\'s Closet)', () => {
    expect(
      isBlinkProducer({
        name: "Conjurer's Closet",
        oracle_text:
          'At the beginning of your end step, you may exile target creature you control, then return that card to the battlefield under your control.',
      })
    ).toBe(true);
  });

  it('anaphoric "that card" (Thassa, Deep-Dwelling)', () => {
    expect(
      isBlinkProducer({
        name: 'Thassa, Deep-Dwelling',
        oracle_text:
          "Indestructible\nAs long as your devotion to blue is less than five, Thassa isn't a creature.\nAt the beginning of your end step, exile up to one other target creature you control, then return that card to the battlefield under your control.\n{3}{U}: Tap another target creature.",
      })
    ).toBe(true);
  });

  it('anaphoric "that card" (Teleportation Circle)', () => {
    expect(
      isBlinkProducer({
        name: 'Teleportation Circle',
        oracle_text:
          "At the beginning of your end step, exile up to one target artifact or creature you control, then return that card to the battlefield under its owner's control.",
      })
    ).toBe(true);
  });

  it('anaphoric "it" on an ETB modal choice (Charming Prince)', () => {
    expect(
      isBlinkProducer({
        name: 'Charming Prince',
        oracle_text:
          'When this creature enters, choose one —\n• Scry 2.\n• You gain 3 life.\n• Exile another target creature you own. Return it to the battlefield under your control at the beginning of the next end step.',
      })
    ).toBe(true);
  });

  it('anaphoric "that card" (Restoration Angel)', () => {
    expect(
      isBlinkProducer({
        name: 'Restoration Angel',
        oracle_text:
          'Flash\nFlying\nWhen this creature enters, you may exile target non-Angel creature you control, then return that card to the battlefield under your control.',
      })
    ).toBe(true);
  });

  it('anaphoric "that card" (Felidar Guardian)', () => {
    expect(
      isBlinkProducer({
        name: 'Felidar Guardian',
        oracle_text:
          "When this creature enters, you may exile another target permanent you control, then return that card to the battlefield under its owner's control.",
      })
    ).toBe(true);
  });

  it('anaphoric "those cards" (Ghostly Flicker)', () => {
    expect(
      isBlinkProducer({
        name: 'Ghostly Flicker',
        oracle_text:
          'Exile two target artifacts, creatures, and/or lands you control, then return those cards to the battlefield under your control.',
      })
    ).toBe(true);
  });

  it('anaphoric "that card" on a triggered ability (Displacer Kitten)', () => {
    expect(
      isBlinkProducer({
        name: 'Displacer Kitten',
        oracle_text:
          "Avoidance — Whenever you cast a noncreature spell, exile up to one target nonland permanent you control, then return that card to the battlefield under its owner's control.",
      })
    ).toBe(true);
  });

  it('anaphoric "those cards" on combat damage (Brago, King Eternal)', () => {
    expect(
      isBlinkProducer({
        name: 'Brago, King Eternal',
        oracle_text:
          "Flying\nWhenever Brago deals combat damage to a player, exile any number of target nonland permanents you control, then return those cards to the battlefield under their owner's control.",
      })
    ).toBe(true);
  });

  it('anaphoric "it" on a loyalty ability (Aminatou, the Fateshifter)', () => {
    expect(
      isBlinkProducer({
        name: 'Aminatou, the Fateshifter',
        oracle_text:
          '+1: Draw a card, then put a card from your hand on top of your library.\n−1: Exile another target permanent you own, then return it to the battlefield under your control.\n−6: Choose left or right. Each player gains control of all nonland permanents other than Aminatou controlled by the next player in the chosen direction.',
      })
    ).toBe(true);
  });

  it('anaphoric "that card" with no possessive qualifier (Flickerwisp)', () => {
    expect(
      isBlinkProducer({
        name: 'Flickerwisp',
        oracle_text:
          "Flying\nWhen this creature enters, exile another target permanent. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
      })
    ).toBe(true);
  });

  it('anaphoric "those cards" (Eerie Interlude)', () => {
    expect(
      isBlinkProducer({
        name: 'Eerie Interlude',
        oracle_text:
          "Exile any number of target creatures you control. Return those cards to the battlefield under their owner's control at the beginning of the next end step.",
      })
    ).toBe(true);
  });

  it('anaphoric "that card" (Cloudshift)', () => {
    expect(
      isBlinkProducer({
        name: 'Cloudshift',
        oracle_text:
          'Exile target creature you control, then return that card to the battlefield under your control.',
      })
    ).toBe(true);
  });

  it('does NOT match the O-Ring shape whose return object is a noun phrase, not a pronoun (Fiend Hunter)', () => {
    expect(
      isBlinkProducer({
        name: 'Fiend Hunter',
        oracle_text:
          "When this creature enters, you may exile another target creature.\nWhen this creature leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
      })
    ).toBe(false);
  });

  it('does NOT match graveyard reanimation, object is a noun phrase (Nethroi, Apex of Death)', () => {
    expect(
      isBlinkProducer({
        name: 'Nethroi, Apex of Death',
        oracle_text:
          'Mutate {4}{G/W}{B}{B} (If you cast this spell for its mutate cost, put it over or under target non-Human creature you own. They mutate into the creature on top plus all abilities from under it.)\nDeathtouch, lifelink\nWhenever this creature mutates, return any number of target creature cards with total power 10 or less from your graveyard to the battlefield.',
      })
    ).toBe(false);
  });

  it('does NOT match "until leaves the battlefield" soft removal with no return text (Cast Out)', () => {
    expect(
      isBlinkProducer({
        name: 'Cast Out',
        oracle_text:
          'Flash\nWhen this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.\nCycling {W} ({W}, Discard this card: Draw a card.)',
      })
    ).toBe(false);
  });

  it('does NOT match "until leaves the battlefield" soft removal with no return text (Banisher Priest)', () => {
    expect(
      isBlinkProducer({
        name: 'Banisher Priest',
        oracle_text:
          'When this creature enters, exile target creature an opponent controls until this creature leaves the battlefield.',
      })
    ).toBe(false);
  });

  it('does NOT match an ETB-doubler with no "exile" text at all (Yarok, the Desecrated)', () => {
    expect(
      isBlinkProducer({
        name: 'Yarok, the Desecrated',
        oracle_text:
          'Deathtouch, lifelink\nIf a permanent entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
      })
    ).toBe(false);
  });

  it('does NOT match a plain ETB lifegain trigger with no exile/return shape (Soul Warden)', () => {
    expect(
      isBlinkProducer({
        name: 'Soul Warden',
        oracle_text: 'Whenever another creature enters, you gain 1 life.',
      })
    ).toBe(false);
  });

  it('does NOT match unrelated exile removal (Path to Exile)', () => {
    expect(
      isBlinkProducer({
        name: 'Path to Exile',
        oracle_text:
          'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
      })
    ).toBe(false);
  });

  it('returns false for a text-less card (no tag to trust — there is no tag for this class)', () => {
    expect(isBlinkProducer({ name: 'No-Text Card' })).toBe(false);
  });
});

// isExileProducer (iter-8 Slice B) — every oracle_text below verified live
// against the Scryfall API before being written in.
describe('isExileProducer', () => {
  it('single card, "until end of your next turn" window (Prosper, Tome-Bound)', () => {
    expect(
      isExileProducer({
        name: 'Prosper, Tome-Bound',
        oracle_text:
          'Deathtouch\nMystic Arcanum — At the beginning of your end step, exile the top card of your library. Until the end of your next turn, you may play that card.\nPact Boon — Whenever you play a card from exile, create a Treasure token.',
      })
    ).toBe(true);
  });

  it('plural count word (Light Up the Stage)', () => {
    expect(
      isExileProducer({
        name: 'Light Up the Stage',
        oracle_text:
          'Spectacle {R} (You may cast this spell for its spectacle cost rather than its mana cost if an opponent lost life this turn.)\nExile the top two cards of your library. Until the end of your next turn, you may play those cards.',
      })
    ).toBe(true);
  });

  it('plural count word, "this turn" window (Jeska\'s Will)', () => {
    expect(
      isExileProducer({
        name: "Jeska's Will",
        oracle_text:
          "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Add {R} for each card in target opponent's hand.\n• Exile the top three cards of your library. You may play them this turn.",
      })
    ).toBe(true);
  });

  it('landfall trigger, "remains exiled" window (Valakut Exploration)', () => {
    expect(
      isExileProducer({
        name: 'Valakut Exploration',
        oracle_text:
          "Landfall — Whenever a land you control enters, exile the top card of your library. You may play that card for as long as it remains exiled.\nAt the beginning of your end step, if there are cards exiled with this enchantment, put them into their owner's graveyard, then this enchantment deals that much damage to each opponent.",
      })
    ).toBe(true);
  });

  it('attack trigger (Laelia, the Blade Reforged)', () => {
    expect(
      isExileProducer({
        name: 'Laelia, the Blade Reforged',
        oracle_text:
          'Haste\nWhenever Laelia attacks, exile the top card of your library. You may play that card this turn.\nWhenever one or more cards are put into exile from your library and/or your graveyard, put a +1/+1 counter on Laelia.',
      })
    ).toBe(true);
  });

  it('does NOT match Urianger Augurelt\'s Draw Arcanum ("exile" is not followed by "the top ... library")', () => {
    expect(
      isExileProducer({
        name: 'Urianger Augurelt',
        oracle_text:
          'Draw Arcanum — {T}: Look at the top card of your library. You may exile it face down.',
      })
    ).toBe(false);
  });

  it('does NOT match Urianger Augurelt\'s Play Arcanum (no "top ... library" phrase at all)', () => {
    expect(
      isExileProducer({
        name: 'Urianger Augurelt',
        oracle_text:
          'Play Arcanum — {T}: Until end of turn, you may play cards exiled with Urianger Augurelt. Spells you cast this way cost {2} less to cast.',
      })
    ).toBe(false);
  });

  it('returns false for a text-less card (no tag to trust — there is no tag for this class)', () => {
    expect(isExileProducer({ name: 'No-Text Card' })).toBe(false);
  });
});

// isExtraCombatPiece (E102, iter-11 Slice C): "additional combat phase"
// producers. All oracle text below is live-verified against Scryfall.
describe('isExtraCombatPiece', () => {
  it('sorcery-speed repeatable combat (Aggravated Assault)', () => {
    expect(
      isExtraCombatPiece({
        name: 'Aggravated Assault',
        oracle_text:
          '{3}{R}{R}: Untap all creatures you control. After this main phase, there is an additional combat phase followed by an additional main phase. Activate only as a sorcery.',
      })
    ).toBe(true);
  });

  it('exert trigger (Combat Celebrant)', () => {
    expect(
      isExtraCombatPiece({
        name: 'Combat Celebrant',
        oracle_text:
          "If this creature hasn't been exerted this turn, you may exert it as it attacks. When you do, untap all other creatures you control and after this phase, there is an additional combat phase. (An exerted creature won't untap during your next untap step.)",
      })
    ).toBe(true);
  });

  it('landfall trigger (Moraug, Fury of Akoum)', () => {
    expect(
      isExtraCombatPiece({
        name: 'Moraug, Fury of Akoum',
        oracle_text:
          "Each creature you control gets +1/+0 for each time it has attacked this turn.\nLandfall — Whenever a land you control enters, if it's your main phase, there's an additional combat phase after this phase. At the beginning of that combat, untap all creatures you control.",
      })
    ).toBe(true);
  });

  it('combat-damage trigger (Port Razer)', () => {
    expect(
      isExtraCombatPiece({
        name: 'Port Razer',
        oracle_text:
          "Whenever this creature deals combat damage to a player, untap each creature you control. After this phase, there is an additional combat phase.\nThis creature can't attack a player it has already attacked this turn.",
      })
    ).toBe(true);
  });

  it('dethrone-adjacent attack trigger (Scourge of the Throne)', () => {
    expect(
      isExtraCombatPiece({
        name: 'Scourge of the Throne',
        oracle_text:
          "Flying\nDethrone (Whenever this creature attacks the player with the most life or tied for most life, put a +1/+1 counter on it.)\nWhenever this creature attacks for the first time each turn, if it's attacking the player with the most life or tied for most life, untap all attacking creatures. After this phase, there is an additional combat phase.",
      })
    ).toBe(true);
  });

  it('rebound sorcery (World at War)', () => {
    expect(
      isExtraCombatPiece({
        name: 'World at War',
        oracle_text:
          "After the second main phase this turn, there's an additional combat phase followed by an additional main phase. At the beginning of that combat, untap all creatures that attacked this turn.\nRebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)",
      })
    ).toBe(true);
  });

  it('legal-commander attack trigger (Aurelia, the Warleader)', () => {
    expect(
      isExtraCombatPiece({
        name: 'Aurelia, the Warleader',
        oracle_text:
          'Flying, vigilance, haste\nWhenever Aurelia attacks for the first time each turn, untap all creatures you control. After this phase, there is an additional combat phase.',
      })
    ).toBe(true);
  });

  it('legal-commander attack trigger (Karlach, Fury of Avernus)', () => {
    expect(
      isExtraCombatPiece({
        name: 'Karlach, Fury of Avernus',
        oracle_text:
          "Whenever you attack, if it's the first combat phase of the turn, untap all attacking creatures. They gain first strike until end of turn. After this phase, there is an additional combat phase.\nChoose a Background (You can have a Background as a second commander.)",
      })
    ).toBe(true);
  });

  it('split-card back half (Response // Resurgence)', () => {
    expect(
      isExtraCombatPiece({
        name: 'Response // Resurgence',
        card_faces: [
          {
            oracle_text: 'Response deals 5 damage to target attacking or blocking creature.',
          },
          {
            oracle_text:
              'Creatures you control gain first strike and vigilance until end of turn. After this main phase, there is an additional combat phase followed by an additional main phase.',
          },
        ],
      })
    ).toBe(true);
  });

  it('flashback sorcery (Seize the Day)', () => {
    expect(
      isExtraCombatPiece({
        name: 'Seize the Day',
        oracle_text:
          'Untap target creature. After this main phase, there is an additional combat phase followed by an additional main phase.\nFlashback {2}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
      })
    ).toBe(true);
  });

  it('retrace sorcery (Waves of Aggression)', () => {
    expect(
      isExtraCombatPiece({
        name: 'Waves of Aggression',
        oracle_text:
          'Untap all creatures that attacked this turn. After this main phase, there is an additional combat phase followed by an additional main phase.\nRetrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)',
      })
    ).toBe(true);
  });

  it('sacrifice-and-reattach aura (Breath of Fury)', () => {
    expect(
      isExtraCombatPiece({
        name: 'Breath of Fury',
        oracle_text:
          'Enchant creature you control\nWhen enchanted creature deals combat damage to a player, sacrifice it and attach this Aura to a creature you control. If you do, untap all creatures you control and after this phase, there is an additional combat phase.',
      })
    ).toBe(true);
  });

  it('curated inclusion: Helm of the Host (own text never says "additional combat phase")', () => {
    expect(
      isExtraCombatPiece({
        name: 'Helm of the Host',
        oracle_text:
          "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except the token isn't legendary. That token gains haste.\nEquip {5}",
      })
    ).toBe(true);
  });

  it('does NOT match a bare untap effect with no combat-phase clause (Vitalize)', () => {
    expect(
      isExtraCombatPiece({
        name: 'Vitalize',
        oracle_text: 'Untap all creatures you control.',
      })
    ).toBe(false);
  });

  it('does NOT match the attack-trigger DOUBLER idiom, no "combat phase" text (Windcrag Siege)', () => {
    expect(
      isExtraCombatPiece({
        name: 'Windcrag Siege',
        oracle_text:
          'As this enchantment enters, choose Mardu or Jeskai.\n• Mardu — If a creature attacking causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.\n• Jeskai — At the beginning of your upkeep, create a 1/1 red Goblin creature token. It gains lifelink and haste until end of turn.',
      })
    ).toBe(false);
  });

  it('returns false for a text-less card (no tag to trust — there is no tag for this class)', () => {
    expect(isExtraCombatPiece({ name: 'No-Text Card' })).toBe(false);
  });
});

// isOneSidedWipe (E109): one-sided vs symmetric board wipes. Every oracle
// text below is live-verified against Scryfall (api.scryfall.com, with a
// User-Agent header — see the module doc for the full false-positive-guard
// rationale). Ground truth:
//  - Plague Wind, In Garruk's Wake, Ruinous Ultimatum: ONE-SIDED (spare the
//    caster's own board).
//  - Farewell, Blasphemous Act, Wrath of God, Damnation, Toxic Deluge, Crux
//    of Fate, Vanquish the Horde, Austere Command, Extinction Event, Single
//    Combat: SYMMETRIC. Single Combat in particular corrects an assumption
//    in this slice's own build spec, which grouped it with the one-sided
//    cards from memory — its real printed text ("Each player chooses a
//    creature or planeswalker they control, then sacrifices the rest.")
//    hits every player equally, including the caster.
describe('isOneSidedWipe', () => {
  it.each([
    ['Plague Wind', "Destroy all creatures you don't control. They can't be regenerated."],
    [
      "In Garruk's Wake",
      "Destroy all creatures you don't control and all planeswalkers you don't control.",
    ],
    ['Ruinous Ultimatum', 'Destroy all nonland permanents your opponents control.'],
  ])('one-sided: %s', (name, oracle_text) => {
    expect(isOneSidedWipe({ name, oracle_text })).toBe(true);
  });

  it.each([
    [
      'Farewell',
      'Choose one or more —\n• Exile all artifacts.\n• Exile all creatures.\n• Exile all enchantments.\n• Exile all graveyards.',
    ],
    [
      'Blasphemous Act',
      'This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.',
    ],
    ['Wrath of God', "Destroy all creatures. They can't be regenerated."],
    ['Damnation', "Destroy all creatures. They can't be regenerated."],
    [
      'Toxic Deluge',
      'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.',
    ],
    [
      'Crux of Fate',
      'Choose one —\n• Destroy all Dragon creatures.\n• Destroy all non-Dragon creatures.',
    ],
    [
      'Vanquish the Horde',
      'This spell costs {1} less to cast for each creature on the battlefield.\nDestroy all creatures.',
    ],
    [
      'Austere Command',
      'Choose two —\n• Destroy all artifacts.\n• Destroy all enchantments.\n• Destroy all creatures with mana value 3 or less.\n• Destroy all creatures with mana value 4 or greater.',
    ],
    [
      'Extinction Event',
      'Choose odd or even. Exile each creature with mana value of the chosen quality. (Zero is even.)',
    ],
    [
      'Single Combat',
      "Each player chooses a creature or planeswalker they control, then sacrifices the rest. Players can't cast creature or planeswalker spells until the end of your next turn.",
    ],
  ])('symmetric: %s', (name, oracle_text) => {
    expect(isOneSidedWipe({ name, oracle_text })).toBe(false);
  });

  it('handles a DFC via card_faces', () => {
    expect(
      isOneSidedWipe({
        name: 'Some // Split',
        card_faces: [
          { oracle_text: 'Draw a card.' },
          { oracle_text: "Destroy all creatures you don't control." },
        ],
      })
    ).toBe(true);
  });

  it('returns false for a text-less card (no tag to trust — there is no tag for this class)', () => {
    expect(isOneSidedWipe({ name: 'No-Text Card' })).toBe(false);
  });
});

// getWipeScope (E112): which permanent types a symmetric board wipe
// destroys/exiles — a separate axis from isOneSidedWipe above (who it hits).
// Every oracle text below is live-verified against Scryfall (see the module
// doc above getWipeScope for the full false-positive-guard rationale).
describe('getWipeScope', () => {
  it.each([
    ['Wrath of God', "Destroy all creatures. They can't be regenerated."],
    ['Damnation', "Destroy all creatures. They can't be regenerated."],
    [
      'Toxic Deluge',
      'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.',
    ],
    [
      'Blasphemous Act',
      'This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.',
    ],
  ])(
    '%s: creatures only — no artifact/enchantment/planeswalker/all collateral',
    (name, oracle_text) => {
      expect(getWipeScope({ name, oracle_text })).toEqual({
        creatures: true,
        artifacts: false,
        enchantments: false,
        planeswalkers: false,
        all: false,
      });
    }
  );

  it('Farewell: modal exile hits creatures + artifacts + enchantments (not planeswalkers, not a bare "all")', () => {
    const scope = getWipeScope({
      name: 'Farewell',
      oracle_text:
        'Choose one or more — Exile all creatures. Their controllers create that many 1/1 white Spirit creature tokens. Exile all artifacts and enchantments. Exile all graveyards.',
    });
    expect(scope.creatures).toBe(true);
    expect(scope.artifacts).toBe(true);
    expect(scope.enchantments).toBe(true);
    expect(scope.planeswalkers).toBe(false);
    expect(scope.all).toBe(false);
  });

  it('Austere Command: modal destroy hits creatures + artifacts + enchantments (not planeswalkers)', () => {
    const scope = getWipeScope({
      name: 'Austere Command',
      oracle_text:
        'Choose two —\n• Destroy all artifacts.\n• Destroy all enchantments.\n• Destroy all creatures with power 3 or greater.\n• Destroy all creatures with power 2 or less.',
    });
    expect(scope.creatures).toBe(true);
    expect(scope.artifacts).toBe(true);
    expect(scope.enchantments).toBe(true);
    expect(scope.planeswalkers).toBe(false);
    expect(scope.all).toBe(false);
  });

  it('Vandalblast (overloaded): artifacts only, never flagged "all" (it never touches creatures/enchantments)', () => {
    const scope = getWipeScope({
      name: 'Vandalblast',
      oracle_text:
        'Destroy target artifact you don\'t control.\nOverload {4}{R} (You may cast this spell for its overload cost. If you do, change "target" in its text with "each.")',
    });
    expect(scope.artifacts).toBe(true);
    expect(scope.all).toBe(false);
  });

  it('Cyclonic Rift (overloaded): a bare "nonland permanent" scope reads as `all`', () => {
    const scope = getWipeScope({
      name: 'Cyclonic Rift',
      oracle_text:
        'Return target nonland permanent you don\'t control to its owner\'s hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of "target" with "each.")',
    });
    expect(scope.all).toBe(true);
  });

  it('a one-sided wipe (isOneSidedWipe) always returns the empty/no-collateral scope regardless of its printed types', () => {
    // Plague Wind hits "all creatures" but only the opponents' — since it
    // spares the caster's own board entirely, own-board collateral is zero
    // by construction, independent of how many types it prints.
    expect(
      getWipeScope({
        name: 'Plague Wind',
        oracle_text: "Destroy all creatures you don't control. They can't be regenerated.",
      })
    ).toEqual({
      creatures: false,
      artifacts: false,
      enchantments: false,
      planeswalkers: false,
      all: false,
    });
  });

  it('returns the empty scope for a text-less card', () => {
    expect(getWipeScope({ name: 'No-Text Card' })).toEqual({
      creatures: false,
      artifacts: false,
      enchantments: false,
      planeswalkers: false,
      all: false,
    });
  });
});

// isFreeInteraction (iter-10 Slice A): reflexive alt-cost interaction spells —
// see the build spec (board E82) for the full candidate table and boundary
// rationale. All oracle text below is live-verified against Scryfall.
//
// NOTE on the overlap with isProtectionPiece, verified directly against the
// real regexes (not re-derived from the build spec's narrative, which
// undercounted this): only Fierce Guardianship trips the widened
// isProtectionPiece counter-clause branch (its text literally says "without
// paying its mana cost"), so only IT flips to isFreeInteraction=false here.
// Force of Negation's live text says "rather than pay this spell's mana
// cost" (not "without paying ... mana cost"), which the isProtectionPiece
// counter-clause branch never matched by construction — it was never
// protection-boosted and correctly reads isFreeInteraction=true below.
describe('isFreeInteraction', () => {
  it.each([
    ['Commandeer', 'gain control of target', 'reflexive alt-cost, gain-control payoff'],
    ['Force of Will', 'counter target', 'reflexive alt-cost, counter payoff'],
    [
      'Force of Negation',
      'counter target',
      'reflexive alt-cost, counter payoff — NOT protection-boosted (see note above)',
    ],
    ['Misdirection', 'change the target', 'reflexive alt-cost, redirect payoff'],
    ['Foil', 'counter target', 'reflexive alt-cost (discard), counter payoff'],
    ['Daze', 'counter target', 'reflexive alt-cost (bounce a land), counter payoff'],
    ['Snuff Out', 'destroy target', 'reflexive alt-cost (life payment), destroy payoff'],
  ])('Bucket A — %s (%s)', (name) => {
    const ORACLE: Record<string, string> = {
      Commandeer:
        "You may exile two blue cards from your hand rather than pay this spell's mana cost. Gain control of target noncreature spell. You may choose new targets for it.",
      'Force of Will':
        "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost. Counter target spell.",
      'Force of Negation':
        "If it's not your turn, you may exile a blue card from your hand rather than pay this spell's mana cost. Counter target noncreature spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.",
      Misdirection:
        "You may exile a blue card from your hand rather than pay this spell's mana cost. Change the target of target spell with a single target.",
      Foil: "You may discard an Island card and another card rather than pay this spell's mana cost. Counter target spell.",
      Daze: "You may return an Island you control to its owner's hand rather than pay this spell's mana cost. Counter target spell unless its controller pays {1}.",
      'Snuff Out':
        "If you control a Swamp, you may pay 4 life rather than pay this spell's mana cost. Destroy target nonblack creature. It can't be regenerated.",
    };
    expect(isFreeInteraction({ name, oracle_text: ORACLE[name] })).toBe(true);
  });

  it('Bucket B — Deadly Rollick: commander-gated free cast, exile payoff, NOT protection-boosted', () => {
    expect(
      isFreeInteraction({
        name: 'Deadly Rollick',
        oracle_text:
          'If you control a commander, you may cast this spell without paying its mana cost. Exile target creature.',
      })
    ).toBe(true);
  });

  it('Bucket B — Deflecting Swat: commander-gated free cast, but already isProtectionPiece → false (overlap exclusion)', () => {
    const card = {
      name: 'Deflecting Swat',
      oracle_text:
        'If you control a commander, you may cast this spell without paying its mana cost.\nYou may choose new targets for target spell or ability.',
    };
    expect(isProtectionPiece(card)).toBe(true);
    expect(isFreeInteraction(card)).toBe(false);
  });

  it('Bucket B — Fierce Guardianship: commander-gated free cast + counter, but the noncreature-branch fix makes it isProtectionPiece → false (overlap exclusion)', () => {
    const card = {
      name: 'Fierce Guardianship',
      oracle_text:
        'If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.',
    };
    expect(isProtectionPiece(card)).toBe(true);
    expect(isFreeInteraction(card)).toBe(false);
  });

  it('Bucket B — Flawless Maneuver: commander-gated free cast, but already isProtectionPiece → false (overlap exclusion)', () => {
    const card = {
      name: 'Flawless Maneuver',
      oracle_text:
        'If you control a commander, you may cast this spell without paying its mana cost. Creatures you control gain indestructible until end of turn.',
    };
    expect(isProtectionPiece(card)).toBe(true);
    expect(isFreeInteraction(card)).toBe(false);
  });

  it.each([
    [
      'Fury',
      'Double strike. When this creature enters, it deals 4 damage divided as you choose among any number of target creatures and/or planeswalkers. Evoke—Exile a red card from your hand.',
    ],
    [
      'Solitude',
      "Flash. Lifelink. When this creature enters, exile up to one other target creature. That creature's controller gains life equal to its power. Evoke—Exile a white card from your hand.",
    ],
    [
      'Subtlety',
      'Flash. Flying. When this creature enters, choose up to one target creature spell or planeswalker spell. Its owner puts it on their choice of the top or bottom of their library. Evoke—Exile a blue card from your hand.',
    ],
    [
      'Endurance',
      'Flash. Reach. When this creature enters, up to one target player puts all the cards from their graveyard on the bottom of their library in a random order. Evoke—Exile a green card from your hand.',
    ],
    [
      'Grief',
      'Menace. When this creature enters, target opponent reveals their hand. You choose a nonland card from it. That player discards that card. Evoke—Exile a black card from your hand.',
    ],
  ])('Bucket D — Evoke cycle: %s', (name, oracle_text) => {
    expect(isFreeInteraction({ name, oracle_text })).toBe(true);
  });

  it.each([
    [
      'Pact of Negation',
      "Counter target spell. At the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game.",
    ],
    [
      'Slaughter Pact',
      "Destroy target nonblack creature. At the beginning of your next upkeep, pay {2}{B}. If you don't, you lose the game.",
    ],
  ])('Bucket E — Pact deferred-payment cycle: %s', (name, oracle_text) => {
    expect(isFreeInteraction({ name, oracle_text })).toBe(true);
  });

  it('negative controls: enablers-for-other-spells, cost reductions, and non-interaction all read false', () => {
    const NEGATIVE_CONTROLS: Array<{ name: string; oracle_text: string }> = [
      {
        name: 'Dream Halls',
        oracle_text:
          'Rather than pay the mana cost for a spell, its controller may discard a card that shares a color with that spell.',
      },
      {
        name: 'As Foretold',
        oracle_text:
          'At the beginning of your upkeep, put a time counter on this enchantment. Once each turn, you may pay {0} rather than pay the mana cost for a spell you cast with mana value X or less, where X is the number of time counters on this enchantment.',
      },
      {
        name: 'Fist of Suns',
        oracle_text:
          'You may pay {W}{U}{B}{R}{G} rather than pay the mana cost for spells you cast.',
      },
      {
        name: 'Omniscience',
        oracle_text: 'You may cast spells from your hand without paying their mana costs.',
      },
      {
        name: 'Aluren',
        oracle_text:
          'Any player may cast creature spells with mana value 3 or less without paying their mana costs and as though they had flash.',
      },
      {
        name: 'Bolt Bend',
        oracle_text:
          'This spell costs {3} less to cast if you control a creature with power 4 or greater.\nChange the target of target spell or ability with a single target.',
      },
      {
        name: 'Cavern Harpy',
        oracle_text:
          "Flying\nWhen this creature enters, return a blue or black creature you control to its owner's hand.\nPay 1 life: Return this creature to its owner's hand.",
      },
      {
        name: 'Chrome Mox',
        oracle_text:
          "Imprint — When this artifact enters, you may exile a nonartifact, nonland card from your hand.\n{T}: Add one mana of any of the exiled card's colors.",
      },
      {
        name: 'Mox Diamond',
        oracle_text:
          "If this artifact would enter, you may discard a land card instead. If you do, this artifact enters. If you don't, put this artifact into its owner's graveyard.\n{T}: Add one mana of any color.",
      },
      {
        name: 'Lotus Petal',
        oracle_text: '{T}, Sacrifice Lotus Petal: Add one mana of any color.',
      },
      {
        name: 'Allosaurus Shepherd',
        oracle_text:
          "This spell can't be countered.\nGreen spells you control can't be countered.\n{X}{G}, Discard a card: Allosaurus Shepherd gets +X/+X until end of turn.",
      },
      {
        name: 'Gitaxian Probe',
        oracle_text:
          "({U/P} can be paid with either {U} or 2 life.)\nLook at target player's hand. Draw a card.",
      },
      { name: 'Mental Misstep', oracle_text: 'Counter target spell with mana value 1.' },
      {
        name: "Teferi's Protection",
        oracle_text:
          "Until your next turn, your life total can't change and you gain protection from everything. All permanents you control phase out. (They phase in before you untap during your next untap step.)",
      },
    ];
    for (const card of NEGATIVE_CONTROLS) {
      expect(isFreeInteraction(card)).toBe(false);
    }
  });

  it('overlap invariant: no card is ever true for both isProtectionPiece and isFreeInteraction', () => {
    const ALL_LIVE_CANDIDATES: Array<{ name: string; oracle_text: string }> = [
      {
        name: 'Commandeer',
        oracle_text:
          "You may exile two blue cards from your hand rather than pay this spell's mana cost. Gain control of target noncreature spell. You may choose new targets for it.",
      },
      {
        name: 'Deflecting Swat',
        oracle_text:
          'If you control a commander, you may cast this spell without paying its mana cost.\nYou may choose new targets for target spell or ability.',
      },
      {
        name: 'Fierce Guardianship',
        oracle_text:
          'If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.',
      },
      {
        name: 'Flawless Maneuver',
        oracle_text:
          'If you control a commander, you may cast this spell without paying its mana cost. Creatures you control gain indestructible until end of turn.',
      },
      {
        name: "Teferi's Protection",
        oracle_text:
          "Until your next turn, your life total can't change and you gain protection from everything. All permanents you control phase out.",
      },
      {
        name: 'Allosaurus Shepherd',
        oracle_text: "This spell can't be countered.\nGreen spells you control can't be countered.",
      },
    ];
    for (const card of ALL_LIVE_CANDIDATES) {
      expect(isProtectionPiece(card) && isFreeInteraction(card)).toBe(false);
    }
  });

  it('returns false for a text-less card (no tag to trust — same fallback direction as isProtectionPiece)', () => {
    expect(isFreeInteraction({ name: 'No-Text Card' })).toBe(false);
  });
});
