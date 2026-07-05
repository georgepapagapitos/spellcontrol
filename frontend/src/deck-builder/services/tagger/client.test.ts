import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  loadTaggerData,
  getCardRole,
  cubeRole,
  validateCardRole,
  isProtectionPiece,
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

  it('free alt-cost counterspell (Fierce Guardianship, sentence-crossing template)', () => {
    expect(
      isProtectionPiece({
        name: 'Fierce Guardianship',
        oracle_text:
          "You may cast this spell without paying its mana cost if it targets a permanent or player you control and it isn't your turn.\nCounter target spell unless its controller pays {5}.",
      })
    ).toBe(true);
  });

  it('unconditional redirect (Deflecting Swat — "rather than pay", not "without paying")', () => {
    expect(
      isProtectionPiece({
        name: 'Deflecting Swat',
        oracle_text:
          "If it's not your turn, you may exile a card from your hand rather than pay this spell's mana cost.\nChoose new targets for target spell or ability.",
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
