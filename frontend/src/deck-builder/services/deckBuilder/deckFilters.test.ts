import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fitsColorIdentity,
  exceedsMaxPrice,
  exceedsMaxRarity,
  constrainsToCollection,
  notInCollection,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
  isDeadInIdentity,
  notOnArena,
  exceedsCmcCap,
  notCommanderLegal,
  notPauperCommanderLegal,
  notLegalForFormat,
  violatesUserCaps,
  userCapsWithoutPrice,
  fitsLandSlot,
  fitsSpellSlot,
  type UserCapsConfig,
} from './deckFilters';
import type { ScryfallCard } from '@/deck-builder/types';

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id-1',
    oracle_id: 'oracle-1',
    name: 'Test Card',
    cmc: 3,
    type_line: 'Creature',
    oracle_text: '',
    color_identity: ['W', 'B'],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

describe('fitsColorIdentity', () => {
  it('passes when card identity is a subset of the commander identity', () => {
    expect(fitsColorIdentity(makeCard({ color_identity: ['W'] }), ['W', 'B'])).toBe(true);
  });

  it('treats colorless (empty identity) as always fitting', () => {
    expect(fitsColorIdentity(makeCard({ color_identity: [] }), ['G'])).toBe(true);
  });

  it('fails when the card has a color outside the commander identity', () => {
    expect(fitsColorIdentity(makeCard({ color_identity: ['W', 'R'] }), ['W', 'B'])).toBe(false);
  });

  // E524, the real cards the live stress panel seated: The Prismatic Piper
  // (chosen green) shipped both reducers off an EDHREC page that mixes every
  // color its players chose, through pick paths that gated on this alone.
  it('fails a colorless cost reducer for a color the deck cannot cast', () => {
    expect(fitsColorIdentity(real('Ruby Medallion'), ['G'])).toBe(false);
    expect(fitsColorIdentity(real("Hazoret's Monument"), ['G'])).toBe(false);
    expect(fitsColorIdentity(real('Ruby Medallion'), ['W'])).toBe(false);
  });

  it('passes the same reducers in a deck that casts their color', () => {
    expect(fitsColorIdentity(real('Ruby Medallion'), ['R'])).toBe(true);
    expect(fitsColorIdentity(real("Hazoret's Monument"), ['R', 'G'])).toBe(true);
  });
});

const REAL_CARDS = new Map<string, ScryfallCard>();
for (const file of ['commander-cards.fixture.json', 'invariant-cards.fixture.json']) {
  const { cards } = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__', file), 'utf8')
  ) as { cards: ScryfallCard[] };
  for (const c of cards) REAL_CARDS.set(c.name, c);
}
function real(name: string): ScryfallCard {
  const c = REAL_CARDS.get(name);
  if (!c) throw new Error(`no fixture card named ${name}`);
  return c;
}

describe('isDeadInIdentity (E282)', () => {
  const rubyMedallion = makeCard({
    name: 'Ruby Medallion',
    type_line: 'Artifact',
    color_identity: [],
    oracle_text: 'Red spells you cast cost {1} less to cast.',
  });

  it('flags a colorless cost reducer whose color the deck cannot cast', () => {
    expect(isDeadInIdentity(rubyMedallion, ['W'])).toBe(true);
  });

  it('passes the same card in a deck that casts that color', () => {
    expect(isDeadInIdentity(rubyMedallion, ['R'])).toBe(false);
    expect(isDeadInIdentity(rubyMedallion, ['W', 'R'])).toBe(false);
  });

  it('ignores cards whose text does not name a color payoff', () => {
    expect(
      isDeadInIdentity(makeCard({ oracle_text: 'Artifact spells you cast cost {1} less.' }), ['W'])
    ).toBe(false);
    expect(isDeadInIdentity(makeCard({ oracle_text: '' }), ['W'])).toBe(false);
  });

  it('reads the back face of a double-faced card too', () => {
    const dfc = makeCard({
      oracle_text: undefined,
      card_faces: [
        { name: 'Front', oracle_text: 'Flying.' },
        { name: 'Back', oracle_text: 'Green spells you cast cost {1} less to cast.' },
      ],
    } as Partial<ScryfallCard>);
    expect(isDeadInIdentity(dfc, ['U'])).toBe(true);
  });

  it('keeps a reducer that names several colors while the deck casts any of them', () => {
    // "White spells and black spells you cast cost {1} less to cast."
    const familiar = real('Stormscape Familiar');
    expect(isDeadInIdentity(familiar, ['U'])).toBe(true);
    expect(isDeadInIdentity(familiar, ['U', 'B'])).toBe(false);
    expect(isDeadInIdentity(familiar, ['W', 'U'])).toBe(false);
  });

  it('never reads "non<color>" as a payoff for that color', () => {
    expect(
      isDeadInIdentity(makeCard({ oracle_text: 'Nonred spells you cast cost {1} more.' }), ['G'])
    ).toBe(false);
    expect(
      isDeadInIdentity(makeCard({ oracle_text: 'Non-red spells you cast cost {1} more.' }), ['G'])
    ).toBe(false);
  });
});

// E525: seating follows the card's front face, not the query that found it.
describe('fitsSpellSlot / fitsLandSlot (E525)', () => {
  it.each([
    // Scryfall's `t:creature` returns all three; each is a land drop.
    ['Dryad Arbor', false, true],
    ['Westvale Abbey // Ormendahl, Profane Prince', false, true],
    ['Hostile Hostel // Creeping Inn', false, true],
    // EDHREC's nonland lists carry these; still lands.
    ['Nykthos, Shrine to Nyx', false, true],
    ['Seat of the Synod', false, true],
    // A spell // land MDFC fits either slot.
    ["Emeria's Call // Emeria, Shattered Skyclave", true, true],
    ['Sink into Stupor // Soporific Springs', true, true],
    // `t:land` returns a transform card whose back face is a land: a spell.
    ["Legion's Landing // Adanto, the First Fort", true, false],
    ['Llanowar Elves', true, false],
    ['Bonecrusher Giant // Stomp', true, false],
  ])('%s: spell slot %s, land slot %s', (name, spell, land) => {
    expect(fitsSpellSlot(real(name))).toBe(spell);
    expect(fitsLandSlot(real(name))).toBe(land);
  });
});

describe('exceedsCmcCap on a reversible printing (E527)', () => {
  it("caps the real Secret Lair Krark's Thumb by its front-face mana value", () => {
    const thumb = real("Krark's Thumb // Krark's Thumb");
    expect(thumb.cmc).toBeUndefined();
    expect(exceedsCmcCap(thumb, 1)).toBe(true);
    expect(exceedsCmcCap(thumb, 3)).toBe(false);
  });
});

describe('exceedsMaxPrice', () => {
  it('returns false when no budget is set', () => {
    expect(exceedsMaxPrice(makeCard({ prices: { usd: '99.99' } }), null)).toBe(false);
  });

  it('treats missing price data as over-budget when a budget is active', () => {
    expect(exceedsMaxPrice(makeCard({ prices: {} }), 5)).toBe(true);
  });

  it('compares against the price for the requested currency', () => {
    const card = makeCard({ prices: { usd: '3.00', eur: '8.00' } });
    expect(exceedsMaxPrice(card, 5, 'USD')).toBe(false);
    expect(exceedsMaxPrice(card, 5, 'EUR')).toBe(true);
  });
});

describe('exceedsMaxRarity', () => {
  it('returns false when no rarity cap is set', () => {
    expect(exceedsMaxRarity(makeCard({ rarity: 'mythic' }), null)).toBe(false);
  });

  it('allows cards at or below the cap and rejects above it', () => {
    expect(exceedsMaxRarity(makeCard({ rarity: 'uncommon' }), 'rare')).toBe(false);
    expect(exceedsMaxRarity(makeCard({ rarity: 'rare' }), 'rare')).toBe(false);
    expect(exceedsMaxRarity(makeCard({ rarity: 'mythic' }), 'rare')).toBe(true);
  });

  it('treats unknown rarities as the highest tier', () => {
    expect(exceedsMaxRarity(makeCard({ rarity: 'special' }), 'rare')).toBe(true);
  });
});

describe('collection predicates', () => {
  it('treats full and available as hard collection constraints', () => {
    expect(constrainsToCollection('full')).toBe(true);
    expect(constrainsToCollection('available')).toBe(true);
    expect(constrainsToCollection('partial')).toBe(false);
    expect(constrainsToCollection('prefer')).toBe(false);
  });

  it('notInCollection is false when no collection is provided', () => {
    expect(notInCollection('Sol Ring', undefined)).toBe(false);
  });

  it('notInCollection reflects set membership', () => {
    const owned = new Set(['Sol Ring']);
    expect(notInCollection('Sol Ring', owned)).toBe(false);
    expect(notInCollection('Mana Crypt', owned)).toBe(true);
  });

  it('owned exemptions require both the flag and ownership', () => {
    const owned = new Set(['Sol Ring']);
    expect(isOwnedBudgetExempt('Sol Ring', owned, true)).toBe(true);
    expect(isOwnedBudgetExempt('Sol Ring', owned, false)).toBe(false);
    expect(isOwnedBudgetExempt('Mana Crypt', owned, true)).toBe(false);
    expect(isOwnedRarityExempt('Sol Ring', owned, true)).toBe(true);
    expect(isOwnedRarityExempt('Sol Ring', undefined, true)).toBe(false);
  });
});

describe('notOnArena', () => {
  it('returns false when arena-only mode is off', () => {
    expect(notOnArena(makeCard({ games: [] }), false)).toBe(false);
  });

  it('filters cards not available on Arena', () => {
    expect(notOnArena(makeCard({ games: ['paper'] }), true)).toBe(true);
    expect(notOnArena(makeCard({ games: ['paper', 'arena'] }), true)).toBe(false);
  });
});

describe('notCommanderLegal', () => {
  it('passes commander-legal cards', () => {
    expect(notCommanderLegal(makeCard({ legalities: { commander: 'legal' } }))).toBe(false);
  });

  it('rejects banned/not_legal cards', () => {
    expect(notCommanderLegal(makeCard({ legalities: { commander: 'banned' } }))).toBe(true);
    expect(notCommanderLegal(makeCard({ legalities: { commander: 'not_legal' } }))).toBe(true);
  });
});

describe('notPauperCommanderLegal', () => {
  it('passes cards Scryfall stamps paupercommander-legal (incl. downshifts)', () => {
    expect(
      notPauperCommanderLegal(
        makeCard({ legalities: { commander: 'legal', paupercommander: 'legal' } })
      )
    ).toBe(false);
  });

  it('rejects banned and never-common cards', () => {
    expect(
      notPauperCommanderLegal(
        makeCard({ legalities: { commander: 'legal', paupercommander: 'banned' } })
      )
    ).toBe(true);
    expect(
      notPauperCommanderLegal(
        makeCard({ legalities: { commander: 'legal', paupercommander: 'not_legal' } })
      )
    ).toBe(true);
  });

  it('rejects cards with no paupercommander key at all', () => {
    expect(notPauperCommanderLegal(makeCard({ legalities: { commander: 'legal' } }))).toBe(true);
  });
});

describe('notLegalForFormat', () => {
  it('falls back to commander legality for undefined/commander/anything else', () => {
    const card = makeCard({ legalities: { commander: 'legal' } });
    expect(notLegalForFormat(card, undefined)).toBe(false);
    expect(notLegalForFormat(card, 'commander')).toBe(false);
    expect(notLegalForFormat(card, 'standard')).toBe(false);
    expect(notLegalForFormat(makeCard({ legalities: { commander: 'banned' } }), undefined)).toBe(
      true
    );
  });

  it('checks the paupercommander key for paupercommander', () => {
    const card = makeCard({ legalities: { commander: 'legal', paupercommander: 'legal' } });
    expect(notLegalForFormat(card, 'paupercommander')).toBe(false);
    expect(
      notLegalForFormat(makeCard({ legalities: { commander: 'legal' } }), 'paupercommander')
    ).toBe(true);
  });

  it('checks the brawl key for brawl', () => {
    const card = makeCard({ legalities: { commander: 'legal', brawl: 'legal' } });
    expect(notLegalForFormat(card, 'brawl')).toBe(false);
    expect(notLegalForFormat(makeCard({ legalities: { commander: 'legal' } }), 'brawl')).toBe(true);
  });
});

describe('violatesUserCaps', () => {
  const noCaps: UserCapsConfig = {
    maxRarity: null,
    maxCmc: null,
    arenaOnly: false,
    maxCardPrice: null,
    currency: 'USD',
  };

  it('is inert (false) when every cap is off — default-settings generation must be unaffected', () => {
    const card = makeCard({ rarity: 'mythic', cmc: 12, games: [], prices: {} });
    expect(violatesUserCaps(card, noCaps)).toBe(false);
  });

  it('flags a card over the rarity cap, honoring the owned exemption', () => {
    const card = makeCard({ rarity: 'mythic' });
    const caps: UserCapsConfig = { ...noCaps, maxRarity: 'rare' };
    expect(violatesUserCaps(card, caps)).toBe(true);
    const owned = new Set([card.name]);
    expect(violatesUserCaps(card, { ...caps, ignoreOwnedRarity: true }, owned)).toBe(false);
  });

  // LIVE (stress sweep 2026-09-24): bracket 5 + "No Game Changers" shipped
  // Thassa's Oracle via the combo audit and Cyclonic Rift via the fixup.
  it('flags a Game Changer once the deck is at its Game Changer limit', () => {
    const oracle = makeCard({ name: "Thassa's Oracle" });
    const plain = makeCard({ name: 'Brainstorm' });
    const gcs = new Set(["Thassa's Oracle"]);
    let atLimit = true;
    const caps: UserCapsConfig = {
      ...noCaps,
      isGameChanger: (n) => gcs.has(n),
      gameChangerLimitReached: () => atLimit,
    };
    expect(violatesUserCaps(oracle, caps)).toBe(true);
    expect(violatesUserCaps(plain, caps)).toBe(false);
    atLimit = false;
    expect(violatesUserCaps(oracle, caps)).toBe(false);
  });

  it('flags a card over the CMC cap', () => {
    const card = makeCard({ cmc: 4 });
    expect(violatesUserCaps(card, { ...noCaps, maxCmc: 3 })).toBe(true);
  });

  it('flags a card not on Arena', () => {
    const card = makeCard({ games: ['paper'] });
    expect(violatesUserCaps(card, { ...noCaps, arenaOnly: true })).toBe(true);
  });

  it('flags a card over the max price, honoring the owned exemption', () => {
    const card = makeCard({ prices: { usd: '10.00' } });
    const caps: UserCapsConfig = { ...noCaps, maxCardPrice: 1 };
    expect(violatesUserCaps(card, caps)).toBe(true);
    const owned = new Set([card.name]);
    expect(violatesUserCaps(card, { ...caps, ignoreOwnedBudget: true }, owned)).toBe(false);
  });

  it('flags a card not legal in the active format', () => {
    const card = makeCard({ legalities: { commander: 'legal' } });
    expect(violatesUserCaps(card, { ...noCaps, mtgFormat: 'brawl' })).toBe(true);
    expect(violatesUserCaps(card, noCaps)).toBe(false);
  });
});

describe('userCapsWithoutPrice', () => {
  it('disables only the price check, leaving every other cap untouched', () => {
    const caps: UserCapsConfig = {
      maxRarity: 'rare',
      maxCmc: 3,
      arenaOnly: true,
      maxCardPrice: 1,
      currency: 'USD',
    };
    const stripped = userCapsWithoutPrice(caps);
    expect(stripped.maxCardPrice).toBeNull();
    expect(stripped.maxRarity).toBe('rare');
    expect(stripped.maxCmc).toBe(3);
    expect(stripped.arenaOnly).toBe(true);
    // An expensive card no longer trips the (now-disabled) price check.
    const card = makeCard({ prices: { usd: '99.00' }, rarity: 'common', cmc: 1, games: ['arena'] });
    expect(violatesUserCaps(card, stripped)).toBe(false);
  });
});

describe('exceedsCmcCap', () => {
  it('returns false when no cap is set', () => {
    expect(exceedsCmcCap(makeCard({ cmc: 9 }), null)).toBe(false);
  });

  it('never filters lands by CMC', () => {
    expect(exceedsCmcCap(makeCard({ cmc: 9, type_line: 'Land' }), 3)).toBe(false);
  });

  it('filters non-land cards above the cap', () => {
    expect(exceedsCmcCap(makeCard({ cmc: 3 }), 3)).toBe(false);
    expect(exceedsCmcCap(makeCard({ cmc: 4 }), 3)).toBe(true);
  });
});
