import { describe, it, expect } from 'vitest';
import {
  isCardLegal,
  getMaxCopies,
  fitsColorIdentity,
  deckColorIdentity,
  validateDeck,
  validateDeckSize,
  validateGeneratedDeckUnderSize,
  validateGeneratedLandFloor,
  validateGeneratedDeck,
  effectiveDeckColors,
  deckColorFrequency,
  countFlaggedCards,
} from './deck-validation';
import { DECK_FORMAT_CONFIGS } from '../deck-builder/lib/constants/archetypes';
import type { ScryfallCard } from '../deck-builder/types';
import type { DeckCard } from '../store/decks';

function card(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'sf-1',
    oracle_id: 'oid-1',
    name: 'Test Card',
    cmc: 1,
    type_line: 'Creature',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    legalities: { commander: 'legal' },
    prices: {},
    ...overrides,
  } as ScryfallCard;
}

function slot(c: ScryfallCard, slotId = 's'): DeckCard {
  return { slotId, card: c, allocatedCopyId: null };
}

describe('isCardLegal', () => {
  it('treats legal and restricted as legal', () => {
    expect(isCardLegal(card({ legalities: { commander: 'legal' } }), 'commander')).toBe(true);
    expect(isCardLegal(card({ legalities: { commander: 'restricted' } }), 'commander')).toBe(true);
  });

  it('treats banned, not_legal, and missing keys as illegal', () => {
    expect(
      isCardLegal(card({ legalities: { commander: 'legal', pauper: 'banned' } }), 'pauper')
    ).toBe(false);
    expect(
      isCardLegal(card({ legalities: { commander: 'legal', pauper: 'not_legal' } }), 'pauper')
    ).toBe(false);
    expect(isCardLegal(card({ legalities: { commander: 'legal' } }), 'pauper')).toBe(false);
  });
});

describe('getMaxCopies', () => {
  it('returns 99 for basic lands regardless of singleton mode', () => {
    expect(getMaxCopies(card({ name: 'Forest' }), true)).toBe(99);
    expect(getMaxCopies(card({ name: 'Snow-Covered Plains' }), false)).toBe(99);
  });

  it('honors "any number of cards named" oracle text', () => {
    const relentless = card({
      name: 'Relentless Rats',
      oracle_text: 'A deck can have any number of cards named Relentless Rats.',
    });
    expect(getMaxCopies(relentless, false)).toBe(99);
    expect(getMaxCopies(relentless, true)).toBe(99);
  });

  it('honors "up to N" oracle text (Seven Dwarves style)', () => {
    const seven = card({
      name: 'Seven Dwarves',
      oracle_text: 'A deck can have up to 7 cards named Seven Dwarves.',
    });
    expect(getMaxCopies(seven, false)).toBe(7);
  });

  it('returns 1 for singleton, 4 for non-singleton by default', () => {
    expect(getMaxCopies(card(), true)).toBe(1);
    expect(getMaxCopies(card(), false)).toBe(4);
  });
});

describe('fitsColorIdentity', () => {
  it('accepts colorless cards in any identity', () => {
    expect(fitsColorIdentity(card({ color_identity: [] }), new Set(['W']))).toBe(true);
    expect(fitsColorIdentity(card({ color_identity: [] }), new Set())).toBe(true);
  });

  it('rejects cards whose colors fall outside allowed', () => {
    expect(fitsColorIdentity(card({ color_identity: ['R'] }), new Set(['U']))).toBe(false);
    expect(fitsColorIdentity(card({ color_identity: ['U', 'R'] }), new Set(['U']))).toBe(false);
  });

  it('accepts cards whose colors are a subset of allowed', () => {
    expect(fitsColorIdentity(card({ color_identity: ['U'] }), new Set(['U', 'R']))).toBe(true);
    expect(fitsColorIdentity(card({ color_identity: ['U', 'R'] }), new Set(['U', 'R']))).toBe(true);
  });
});

describe('deckColorIdentity', () => {
  it('returns empty set when no commanders', () => {
    expect(deckColorIdentity(null, null).size).toBe(0);
  });

  it('combines commander and partner identities', () => {
    const a = card({ color_identity: ['W'] });
    const b = card({ color_identity: ['U', 'R'] });
    const result = deckColorIdentity(a, b);
    expect([...result].sort()).toEqual(['R', 'U', 'W']);
  });
});

describe('validateDeck', () => {
  const commander = DECK_FORMAT_CONFIGS.commander;
  const standard = DECK_FORMAT_CONFIGS.standard;

  it('returns no issues for a legal commander deck within color identity', () => {
    const cmdr = card({ name: 'Talrand', color_identity: ['U'] });
    const inDeck = card({ name: 'Counterspell', color_identity: ['U'] });
    const issues = validateDeck([slot(inDeck, 'a')], [], commander, { commander: cmdr });
    expect(issues).toHaveLength(0);
  });

  it('flags cards outside commander color identity', () => {
    const cmdr = card({ name: 'Talrand', color_identity: ['U'] });
    const offColor = card({ name: 'Lightning Bolt', color_identity: ['R'] });
    const issues = validateDeck([slot(offColor, 'a')], [], commander, { commander: cmdr });
    expect(issues.some((i) => i.issue === 'color-identity')).toBe(true);
  });

  it('does not flag a card that is in the partner commander color identity', () => {
    // Mirrors the Frodo (G) + Sam (W) partner pairing: a white card is legal
    // once Sam is added as the partner, even though Frodo alone is mono-green.
    const frodo = card({ name: 'Frodo, Adventurous Hobbit', color_identity: ['G'] });
    const sam = card({ name: 'Sam, Loyal Attendant', color_identity: ['W'] });
    const whiteCard = card({ name: 'Swords to Plowshares', color_identity: ['W'] });
    const withoutPartner = validateDeck([slot(whiteCard, 'a')], [], commander, {
      commander: frodo,
    });
    expect(withoutPartner.some((i) => i.issue === 'color-identity')).toBe(true);
    const withPartner = validateDeck([slot(whiteCard, 'a')], [], commander, {
      commander: frodo,
      partnerCommander: sam,
    });
    expect(withPartner.some((i) => i.issue === 'color-identity')).toBe(false);
  });

  it('flags cards not legal in the format', () => {
    const bad = card({
      name: 'Black Lotus',
      legalities: { commander: 'banned', standard: 'not_legal' },
    });
    const issues = validateDeck([slot(bad, 'a')], [], standard);
    expect(issues.some((i) => i.issue === 'not-legal' && i.cardName === 'Black Lotus')).toBe(true);
  });

  it('flags over-copy-limit in singleton formats', () => {
    const c = card({ name: 'Sol Ring' });
    const issues = validateDeck([slot(c, 'a'), slot(c, 'b')], [], commander);
    const overLimit = issues.filter((i) => i.issue === 'over-copy-limit');
    expect(overLimit).toHaveLength(2); // one per slot
  });

  it('allows up to 4 copies in non-singleton formats and flags the 5th', () => {
    const c = card({
      name: 'Lightning Bolt',
      legalities: { commander: 'legal', standard: 'legal' },
    });
    const four = [slot(c, 'a'), slot(c, 'b'), slot(c, 'c'), slot(c, 'd')];
    expect(
      validateDeck(four, [], standard).filter((i) => i.issue === 'over-copy-limit')
    ).toHaveLength(0);
    const five = [...four, slot(c, 'e')];
    expect(
      validateDeck(five, [], standard).filter((i) => i.issue === 'over-copy-limit').length
    ).toBeGreaterThan(0);
  });

  it('counts copies across mainboard and sideboard combined', () => {
    const c = card({
      name: 'Lightning Bolt',
      legalities: { commander: 'legal', standard: 'legal' },
    });
    const main = [slot(c, 'a'), slot(c, 'b'), slot(c, 'c')];
    const side = [slot(c, 'd'), slot(c, 'e')]; // total 5 across both
    const issues = validateDeck(main, side, standard);
    expect(issues.filter((i) => i.issue === 'over-copy-limit').length).toBeGreaterThan(0);
  });

  it('allows unlimited basics regardless of format', () => {
    const plains = card({ name: 'Plains', legalities: { commander: 'legal', standard: 'legal' } });
    const issues = validateDeck(
      Array.from({ length: 24 }, (_, i) => slot(plains, `p${i}`)),
      [],
      standard
    );
    expect(issues.filter((i) => i.issue === 'over-copy-limit')).toHaveLength(0);
  });

  it('does not enforce color identity for non-commander formats', () => {
    const c = card({
      name: 'Lightning Bolt',
      color_identity: ['R'],
      legalities: { commander: 'legal', standard: 'legal' },
    });
    const issues = validateDeck([slot(c, 'a')], [], standard);
    expect(issues.some((i) => i.issue === 'color-identity')).toBe(false);
  });

  it('skips color identity check when no commanders are provided', () => {
    const c = card({ name: 'Lightning Bolt', color_identity: ['R'] });
    // commander format but no commander passed in — should not error
    const issues = validateDeck([slot(c, 'a')], [], commander);
    expect(issues.some((i) => i.issue === 'color-identity')).toBe(false);
  });
});

// Modern/Pioneer/Legacy/Vintage are 60-card 4-of constructed formats that
// differ only by which Scryfall legality key they check. The validation logic
// is shared with Standard (covered above); these assert each new format is
// wired to the correct legalityKey and inherits the 4-of / no-color-identity
// behavior — and that Vintage honors the restricted list.
describe('validateDeck — Modern/Pioneer/Legacy/Vintage', () => {
  const NEW_FORMATS = ['modern', 'pioneer', 'legacy', 'vintage'] as const;

  it.each(NEW_FORMATS)('%s checks its own legality key', (fmt) => {
    const cfg = DECK_FORMAT_CONFIGS[fmt];
    expect(cfg.legalityKey).toBe(fmt);
    const bad = card({ name: 'Channel', legalities: { commander: 'legal', [fmt]: 'not_legal' } });
    const issues = validateDeck([slot(bad, 'a')], [], cfg);
    expect(issues.some((i) => i.issue === 'not-legal' && i.cardName === 'Channel')).toBe(true);
  });

  it.each(NEW_FORMATS)('%s allows up to 4 copies and flags the 5th', (fmt) => {
    const cfg = DECK_FORMAT_CONFIGS[fmt];
    const c = card({ name: 'Lightning Bolt', legalities: { commander: 'legal', [fmt]: 'legal' } });
    const four = ['a', 'b', 'c', 'd'].map((id) => slot(c, id));
    expect(validateDeck(four, [], cfg).filter((i) => i.issue === 'over-copy-limit')).toHaveLength(
      0
    );
    const five = [...four, slot(c, 'e')];
    expect(
      validateDeck(five, [], cfg).filter((i) => i.issue === 'over-copy-limit').length
    ).toBeGreaterThan(0);
  });

  it.each(NEW_FORMATS)('%s does not enforce color identity', (fmt) => {
    const cfg = DECK_FORMAT_CONFIGS[fmt];
    const c = card({
      name: 'Lightning Bolt',
      color_identity: ['R'],
      legalities: { commander: 'legal', [fmt]: 'legal' },
    });
    expect(validateDeck([slot(c, 'a')], [], cfg).some((i) => i.issue === 'color-identity')).toBe(
      false
    );
  });

  it('Vintage honors the restricted list (restricted = legal)', () => {
    const cfg = DECK_FORMAT_CONFIGS.vintage;
    const lotus = card({
      name: 'Black Lotus',
      legalities: { commander: 'legal', vintage: 'restricted' },
    });
    expect(validateDeck([slot(lotus, 'a')], [], cfg).some((i) => i.issue === 'not-legal')).toBe(
      false
    );
  });
});

describe('effectiveDeckColors', () => {
  it('returns commander color identity for commander decks', () => {
    const cmdr = card({ name: 'Atraxa', color_identity: ['W', 'U', 'B', 'G'] });
    const colors = effectiveDeckColors({
      commander: cmdr,
      partnerCommander: null,
      cards: [slot(card({ color_identity: ['R'] }), 'a')],
    });
    expect([...colors].sort()).toEqual(['B', 'G', 'U', 'W']);
  });

  it('unions commander + partner color identity', () => {
    const a = card({ name: 'A', color_identity: ['W'] });
    const b = card({ name: 'B', color_identity: ['U'] });
    const colors = effectiveDeckColors({
      commander: a,
      partnerCommander: b,
      cards: [],
    });
    expect([...colors].sort()).toEqual(['U', 'W']);
  });

  it('aggregates from mainboard + sideboard when no commander', () => {
    const colors = effectiveDeckColors({
      commander: null,
      partnerCommander: null,
      cards: [slot(card({ color_identity: ['R'] }), 'a'), slot(card({ color_identity: [] }), 'b')],
      sideboard: [slot(card({ color_identity: ['G'] }), 'c')],
    });
    expect([...colors].sort()).toEqual(['G', 'R']);
  });

  it('returns empty set when no commander and no card colors', () => {
    const colors = effectiveDeckColors({
      commander: null,
      partnerCommander: null,
      cards: [slot(card({ color_identity: [] }), 'a')],
    });
    expect(colors.size).toBe(0);
  });
});

describe('deckColorFrequency', () => {
  it('counts each color contribution across mainboard and sideboard', () => {
    const freq = deckColorFrequency({
      cards: [
        slot(card({ color_identity: ['R'] }), 'a'),
        slot(card({ color_identity: ['R', 'G'] }), 'b'),
        slot(card({ color_identity: ['G'] }), 'c'),
      ],
      sideboard: [slot(card({ color_identity: ['R'] }), 'd')],
    });
    expect(freq.get('R')).toBe(3);
    expect(freq.get('G')).toBe(2);
  });

  it('returns an empty map for colorless decks', () => {
    const freq = deckColorFrequency({
      cards: [slot(card({ color_identity: [] }), 'a')],
    });
    expect(freq.size).toBe(0);
  });

  it('treats missing sideboard as empty', () => {
    const freq = deckColorFrequency({
      cards: [slot(card({ color_identity: ['B'] }), 'a')],
    });
    expect(freq.get('B')).toBe(1);
  });
});

describe('validateDeckSize', () => {
  const commander = DECK_FORMAT_CONFIGS.commander;

  it('returns null when mainboard is at the limit', () => {
    expect(validateDeckSize(99, commander)).toBeNull();
  });

  it('returns null when mainboard is under the limit', () => {
    expect(validateDeckSize(50, commander)).toBeNull();
  });

  it('returns singular message when exactly 1 card over', () => {
    expect(validateDeckSize(100, commander)).toBe('1 card over the Commander limit (99)');
  });

  it('returns plural message when multiple cards over', () => {
    expect(validateDeckSize(102, commander)).toBe('3 cards over the Commander limit (99)');
  });
});

describe('validateGeneratedDeckUnderSize', () => {
  const commander = DECK_FORMAT_CONFIGS.commander;

  it('returns null when mainboard meets the size', () => {
    expect(validateGeneratedDeckUnderSize(99, commander)).toBeNull();
  });

  it("returns null when mainboard is over the size (that is validateDeckSize's job)", () => {
    expect(validateGeneratedDeckUnderSize(102, commander)).toBeNull();
  });

  it('flags a generated deck that landed short, singular', () => {
    expect(validateGeneratedDeckUnderSize(98, commander)).toBe(
      '1 card short of the Commander size (99)'
    );
  });

  it('flags a generated deck that landed short, plural', () => {
    expect(validateGeneratedDeckUnderSize(90, commander)).toBe(
      '9 cards short of the Commander size (99)'
    );
  });
});

describe('validateGeneratedLandFloor', () => {
  const commander = DECK_FORMAT_CONFIGS.commander;
  const standard = DECK_FORMAT_CONFIGS.standard;

  it('rejects an absurdly low land count in a 99-card singleton deck', () => {
    expect(validateGeneratedLandFloor(5, commander)).toBe(
      'Only 5 lands — below the 25-land floor for a 99-card singleton deck'
    );
  });

  it('accepts a land count at or above the floor', () => {
    expect(validateGeneratedLandFloor(25, commander)).toBeNull();
    expect(validateGeneratedLandFloor(37, commander)).toBeNull();
  });

  it('scales the floor proportionally for a smaller singleton mainboard', () => {
    const brawl = DECK_FORMAT_CONFIGS.brawl; // mainboardSize 59
    expect(validateGeneratedLandFloor(14, brawl)).toBe(
      'Only 14 lands — below the 15-land floor for a 59-card singleton deck'
    );
    expect(validateGeneratedLandFloor(15, brawl)).toBeNull();
  });

  it('does not apply to non-singleton (4-of constructed) formats', () => {
    expect(validateGeneratedLandFloor(1, standard)).toBeNull();
  });
});

describe('validateGeneratedDeck', () => {
  const commander = DECK_FORMAT_CONFIGS.commander;
  const cmdr = card({ name: 'Talrand', color_identity: ['U'] });

  function legalMainboard(count: number, landCount: number): ScryfallCard[] {
    const lands = Array.from({ length: landCount }, (_, i) =>
      card({ name: `Land ${i}`, type_line: 'Land', color_identity: [] })
    );
    const spells = Array.from({ length: count - landCount }, (_, i) =>
      card({ name: `Spell ${i}`, type_line: 'Instant', color_identity: ['U'] })
    );
    return [...lands, ...spells];
  }

  it('passes a valid generated deck through untouched (no issues)', () => {
    const mainboard = legalMainboard(99, 37);
    const issues = validateGeneratedDeck(mainboard, commander, { commander: cmdr });
    expect(issues).toEqual([]);
  });

  it('rejects an illegal card', () => {
    const mainboard = legalMainboard(99, 37);
    mainboard[0] = card({
      name: 'Banned Card',
      type_line: 'Instant',
      color_identity: ['U'],
      legalities: { commander: 'banned' },
    });
    const issues = validateGeneratedDeck(mainboard, commander, { commander: cmdr });
    expect(issues.some((i) => i.issue === 'not-legal' && i.cardName === 'Banned Card')).toBe(true);
  });

  it('rejects a color-identity violation', () => {
    const mainboard = legalMainboard(99, 37);
    mainboard[0] = card({ name: 'Off Color', type_line: 'Instant', color_identity: ['R'] });
    const issues = validateGeneratedDeck(mainboard, commander, { commander: cmdr });
    expect(issues.some((i) => i.issue === 'color-identity' && i.cardName === 'Off Color')).toBe(
      true
    );
  });

  it('rejects a copy-limit violation in a singleton format', () => {
    const mainboard = legalMainboard(99, 37);
    const dupe = card({ name: 'Sol Ring', type_line: 'Artifact', color_identity: [] });
    mainboard[0] = dupe;
    mainboard[1] = dupe;
    const issues = validateGeneratedDeck(mainboard, commander, { commander: cmdr });
    expect(issues.some((i) => i.issue === 'over-copy-limit' && i.cardName === 'Sol Ring')).toBe(
      true
    );
  });

  it('rejects an over-size mainboard', () => {
    const mainboard = legalMainboard(105, 37);
    const issues = validateGeneratedDeck(mainboard, commander, { commander: cmdr });
    expect(issues.some((i) => i.issue === 'over-size')).toBe(true);
  });

  it('rejects an under-size mainboard', () => {
    const mainboard = legalMainboard(80, 30);
    const issues = validateGeneratedDeck(mainboard, commander, { commander: cmdr });
    expect(issues.some((i) => i.issue === 'under-size')).toBe(true);
  });

  it('rejects a near-landless mainboard (the land-floor gate)', () => {
    const mainboard = legalMainboard(99, 5);
    const issues = validateGeneratedDeck(mainboard, commander, { commander: cmdr });
    expect(issues.some((i) => i.issue === 'land-floor')).toBe(true);
  });
});

describe('countFlaggedCards', () => {
  it('counts unique card names across issues, regardless of issue type', () => {
    const count = countFlaggedCards([
      { slotId: 's1', cardName: 'A', issue: 'not-legal', detail: '' },
      { slotId: 's2', cardName: 'A', issue: 'color-identity', detail: '' },
      { slotId: 's3', cardName: 'B', issue: 'over-copy-limit', detail: '' },
    ]);
    expect(count).toBe(2);
  });

  it('returns 0 for no issues', () => {
    expect(countFlaggedCards([])).toBe(0);
  });
});

describe('validateDeck — Pauper Commander', () => {
  const pdhConfig = DECK_FORMAT_CONFIGS.paupercommander;
  const pdhCommander = card({
    name: 'Fynn, the Fangbearer',
    type_line: 'Legendary Creature — Human Warrior',
    rarity: 'uncommon',
    color_identity: ['G'],
    // Real Scryfall data: uncommon commanders read not_legal under the key.
    legalities: { commander: 'legal', paupercommander: 'not_legal' },
  });

  it('gates the 99 on the paupercommander key (downshifts pass, uncommons fail)', () => {
    const downshift = card({
      name: 'Command Tower',
      type_line: 'Land',
      rarity: 'rare',
      legalities: { commander: 'legal', paupercommander: 'legal' },
    });
    const uncommonSpell = card({
      name: 'Rhystic Study',
      type_line: 'Enchantment',
      rarity: 'uncommon',
      legalities: { commander: 'legal', paupercommander: 'not_legal' },
    });
    const issues = validateDeck([slot(downshift, 'a'), slot(uncommonSpell, 'b')], [], pdhConfig, {
      commander: pdhCommander,
    });
    expect(issues.filter((i) => i.issue === 'not-legal').map((i) => i.slotId)).toEqual(['b']);
  });

  it('does NOT flag a derived-eligible commander despite its not_legal stamp', () => {
    const issues = validateDeck([], [], pdhConfig, { commander: pdhCommander });
    expect(issues).toEqual([]);
  });

  it('flags an ineligible commander on the synthetic commander slot', () => {
    const rareLegend = card({
      name: 'Atraxa, Praetors’ Voice',
      type_line: 'Legendary Creature — Phyrexian Angel Horror',
      rarity: 'mythic',
      legalities: { commander: 'legal', paupercommander: 'not_legal' },
    });
    const issues = validateDeck([], [], pdhConfig, { commander: rareLegend });
    expect(issues).toHaveLength(1);
    expect(issues[0].slotId).toBe('commander');
    expect(issues[0].issue).toBe('not-legal');
  });

  it('validates a partner commander on its own synthetic slot', () => {
    const rarePartner = card({
      name: 'Rare Partner',
      type_line: 'Legendary Creature — Human',
      rarity: 'rare',
      legalities: { commander: 'legal', paupercommander: 'not_legal' },
    });
    const issues = validateDeck([], [], pdhConfig, {
      commander: pdhCommander,
      partnerCommander: rarePartner,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].slotId).toBe('partner-commander');
  });

  it('leaves other commander formats untouched (no derived commander check)', () => {
    const issues = validateDeck([], [], DECK_FORMAT_CONFIGS.commander, {
      commander: pdhCommander,
    });
    expect(issues).toEqual([]);
  });
});
