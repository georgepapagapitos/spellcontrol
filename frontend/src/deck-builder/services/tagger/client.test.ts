import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadTaggerData, getCardRole, cubeRole, validateCardRole } from './client';

// Minimal tagger dataset: a cost-reducer (which the generic classifier folds
// into "ramp"), a genuine ramp spell, and a removal spell. Also includes
// Expropriate mistagged 'ramp' (the real-world bug this sanity layer catches)
// and Divination for the cardDraw check.
const DATA = {
  generatedAt: '2026-06-21T00:00:00Z',
  tags: {
    'cost-reducer': ['Puresteel Paladin'],
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
    ],
    removal: ['Swords to Plowshares'],
    boardwipe: ['Wrath of God', 'Farewell', 'Devastation Tide'],
    'card-advantage': ['Divination'],
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
      "During your turn, activated abilities of permanents your opponents control can't be activated unless they're mana abilities. Whenever an opponent searches their library, you may search your library for a card. If you do, put that card into your hand instead of wherever it was going, then that player shuffles.",
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
