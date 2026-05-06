import { describe, it, expect } from 'vitest';
import { cardMatchesRules, cardMatchesSingleRule, isRuleEmpty, hasEmptyRule } from './rules';
import type { EnrichedCard, BinderRule } from '../types';

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    name: 'Test Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'abc-123',
    purchasePrice: 0.5,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    cmc: 2,
    typeLine: 'Instant',
    colorIdentity: ['R'],
    colors: ['R'],
    ...overrides,
  };
}

describe('cardMatchesSingleRule', () => {
  it('matches when rule has no constraints', () => {
    expect(cardMatchesSingleRule(makeCard(), {})).toBe(true);
  });

  describe('rarity', () => {
    it('matches card with matching rarity', () => {
      expect(cardMatchesSingleRule(makeCard({ rarity: 'rare' }), { rarities: ['rare'] })).toBe(
        true
      );
    });

    it('rejects card with non-matching rarity', () => {
      expect(cardMatchesSingleRule(makeCard({ rarity: 'common' }), { rarities: ['rare'] })).toBe(
        false
      );
    });

    it('matches when rarity is in a list of rarities', () => {
      const rule: BinderRule = { rarities: ['rare', 'mythic'] };
      expect(cardMatchesSingleRule(makeCard({ rarity: 'mythic' }), rule)).toBe(true);
    });

    it('is case-insensitive for rarity', () => {
      expect(cardMatchesSingleRule(makeCard({ rarity: 'Rare' }), { rarities: ['rare'] })).toBe(
        true
      );
    });
  });

  describe('price range', () => {
    it('matches card within price range', () => {
      const rule: BinderRule = { priceMin: 1, priceMax: 10 };
      expect(cardMatchesSingleRule(makeCard({ purchasePrice: 5 }), rule)).toBe(true);
    });

    it('rejects card below priceMin', () => {
      expect(cardMatchesSingleRule(makeCard({ purchasePrice: 0.5 }), { priceMin: 1 })).toBe(false);
    });

    it('rejects card above priceMax', () => {
      expect(cardMatchesSingleRule(makeCard({ purchasePrice: 20 }), { priceMax: 10 })).toBe(false);
    });

    it('matches card exactly at priceMin boundary', () => {
      expect(cardMatchesSingleRule(makeCard({ purchasePrice: 1 }), { priceMin: 1 })).toBe(true);
    });

    it('matches card exactly at priceMax boundary', () => {
      expect(cardMatchesSingleRule(makeCard({ purchasePrice: 10 }), { priceMax: 10 })).toBe(true);
    });
  });

  describe('colors', () => {
    it('matches mono-red card against red rule', () => {
      const card = makeCard({ colorIdentity: ['R'], typeLine: 'Instant' });
      expect(cardMatchesSingleRule(card, { colors: ['R'] })).toBe(true);
    });

    it('rejects mono-red card against blue rule', () => {
      const card = makeCard({ colorIdentity: ['R'], typeLine: 'Instant' });
      expect(cardMatchesSingleRule(card, { colors: ['U'] })).toBe(false);
    });

    it('matches lands by their color identity', () => {
      const card = makeCard({ typeLine: 'Basic Land — Mountain', colorIdentity: ['R'] });
      expect(cardMatchesSingleRule(card, { colors: ['R'] })).toBe(true);
    });

    it('matches colorless lands as C', () => {
      const card = makeCard({ typeLine: 'Basic Land — Wastes', colorIdentity: [] });
      expect(cardMatchesSingleRule(card, { colors: ['C'] })).toBe(true);
    });

    it('rejects cards with unknown color (no colorIdentity)', () => {
      const card = makeCard({ colorIdentity: undefined, typeLine: 'Instant' });
      expect(cardMatchesSingleRule(card, { colors: ['R'] })).toBe(false);
    });
  });

  describe('types', () => {
    it('matches card whose type line includes the rule type', () => {
      const card = makeCard({ typeLine: 'Legendary Creature — Human Wizard' });
      expect(cardMatchesSingleRule(card, { types: ['creature'] })).toBe(true);
    });

    it('matches when any listed type matches', () => {
      const card = makeCard({ typeLine: 'Instant' });
      expect(cardMatchesSingleRule(card, { types: ['creature', 'instant'] })).toBe(true);
    });

    it('rejects when no listed type matches', () => {
      const card = makeCard({ typeLine: 'Sorcery' });
      expect(cardMatchesSingleRule(card, { types: ['creature', 'instant'] })).toBe(false);
    });

    it('is case-insensitive for type matching', () => {
      const card = makeCard({ typeLine: 'Enchantment' });
      expect(cardMatchesSingleRule(card, { types: ['ENCHANTMENT'] })).toBe(true);
    });
  });

  describe('CMC range', () => {
    it('matches card within CMC range', () => {
      expect(cardMatchesSingleRule(makeCard({ cmc: 3 }), { cmcMin: 2, cmcMax: 5 })).toBe(true);
    });

    it('rejects card below cmcMin', () => {
      expect(cardMatchesSingleRule(makeCard({ cmc: 1 }), { cmcMin: 2 })).toBe(false);
    });

    it('rejects card above cmcMax', () => {
      expect(cardMatchesSingleRule(makeCard({ cmc: 8 }), { cmcMax: 5 })).toBe(false);
    });

    it('treats missing cmc as 0', () => {
      expect(cardMatchesSingleRule(makeCard({ cmc: undefined }), { cmcMin: 1 })).toBe(false);
      expect(cardMatchesSingleRule(makeCard({ cmc: undefined }), { cmcMax: 0 })).toBe(true);
    });
  });

  describe('nameContains', () => {
    it('matches when name contains the substring (case-insensitive)', () => {
      expect(
        cardMatchesSingleRule(makeCard({ name: 'Lightning Bolt' }), { nameContains: 'bolt' })
      ).toBe(true);
    });

    it('rejects when name does not contain the substring', () => {
      expect(cardMatchesSingleRule(makeCard({ name: 'Sol Ring' }), { nameContains: 'bolt' })).toBe(
        false
      );
    });

    it('ignores whitespace-only nameContains', () => {
      expect(cardMatchesSingleRule(makeCard({ name: 'Sol Ring' }), { nameContains: '   ' })).toBe(
        true
      );
    });
  });

  describe('setCodes', () => {
    it('matches card with matching set code', () => {
      expect(cardMatchesSingleRule(makeCard({ setCode: 'CMR' }), { setCodes: ['cmr'] })).toBe(true);
    });

    it('rejects card with non-matching set code', () => {
      expect(cardMatchesSingleRule(makeCard({ setCode: 'IKO' }), { setCodes: ['CMR'] })).toBe(
        false
      );
    });

    it('is case-insensitive for set codes', () => {
      expect(cardMatchesSingleRule(makeCard({ setCode: 'CMR' }), { setCodes: ['CMR'] })).toBe(true);
    });
  });

  describe('foil', () => {
    it('matches foil card against foil rule', () => {
      expect(cardMatchesSingleRule(makeCard({ foil: true }), { foil: 'foil' })).toBe(true);
    });

    it('rejects non-foil card against foil rule', () => {
      expect(cardMatchesSingleRule(makeCard({ foil: false }), { foil: 'foil' })).toBe(false);
    });

    it('matches non-foil card against nonfoil rule', () => {
      expect(cardMatchesSingleRule(makeCard({ foil: false }), { foil: 'nonfoil' })).toBe(true);
    });

    it('rejects foil card against nonfoil rule', () => {
      expect(cardMatchesSingleRule(makeCard({ foil: true }), { foil: 'nonfoil' })).toBe(false);
    });

    it('accepts any card when foil is "any"', () => {
      expect(cardMatchesSingleRule(makeCard({ foil: true }), { foil: 'any' })).toBe(true);
      expect(cardMatchesSingleRule(makeCard({ foil: false }), { foil: 'any' })).toBe(true);
    });
  });

  describe('sourceCategoryContains', () => {
    it('matches when sourceCategory contains the substring', () => {
      const card = makeCard({ sourceCategory: 'Commander Deck' });
      expect(cardMatchesSingleRule(card, { sourceCategoryContains: 'commander' })).toBe(true);
    });

    it('rejects when sourceCategory does not contain the substring', () => {
      const card = makeCard({ sourceCategory: 'Cube' });
      expect(cardMatchesSingleRule(card, { sourceCategoryContains: 'commander' })).toBe(false);
    });
  });

  describe('edhrecRankMax', () => {
    it('matches card with rank at or below the threshold', () => {
      expect(cardMatchesSingleRule(makeCard({ edhrecRank: 500 }), { edhrecRankMax: 1000 })).toBe(
        true
      );
      expect(cardMatchesSingleRule(makeCard({ edhrecRank: 1000 }), { edhrecRankMax: 1000 })).toBe(
        true
      );
    });

    it('rejects card with rank above the threshold', () => {
      expect(cardMatchesSingleRule(makeCard({ edhrecRank: 2000 }), { edhrecRankMax: 1000 })).toBe(
        false
      );
    });

    it('rejects card without an edhrec rank', () => {
      expect(
        cardMatchesSingleRule(makeCard({ edhrecRank: undefined }), { edhrecRankMax: 1000 })
      ).toBe(false);
    });
  });

  describe('treatments', () => {
    it('matches fullart via the fullArt flag', () => {
      expect(cardMatchesSingleRule(makeCard({ fullArt: true }), { treatments: ['fullart'] })).toBe(
        true
      );
    });

    it('matches fullart via the frameEffects array', () => {
      expect(
        cardMatchesSingleRule(makeCard({ frameEffects: ['fullart'] }), { treatments: ['fullart'] })
      ).toBe(true);
    });

    it('matches showcase via frameEffects', () => {
      expect(
        cardMatchesSingleRule(makeCard({ frameEffects: ['showcase'] }), {
          treatments: ['showcase'],
        })
      ).toBe(true);
    });

    it('matches if ANY selected treatment is on the card', () => {
      expect(
        cardMatchesSingleRule(makeCard({ frameEffects: ['extendedart'] }), {
          treatments: ['showcase', 'extendedart'],
        })
      ).toBe(true);
    });

    it('rejects card without the treatment', () => {
      expect(
        cardMatchesSingleRule(makeCard({ frameEffects: ['etched'] }), { treatments: ['fullart'] })
      ).toBe(false);
    });

    it('rejects card with no frame data when treatment filter is active', () => {
      expect(cardMatchesSingleRule(makeCard(), { treatments: ['fullart'] })).toBe(false);
    });
  });

  describe('borderColors', () => {
    it('matches card with matching border', () => {
      expect(
        cardMatchesSingleRule(makeCard({ borderColor: 'borderless' }), {
          borderColors: ['borderless'],
        })
      ).toBe(true);
    });

    it('rejects card with non-matching border', () => {
      expect(
        cardMatchesSingleRule(makeCard({ borderColor: 'black' }), { borderColors: ['borderless'] })
      ).toBe(false);
    });

    it('rejects card with no border data when filter is active', () => {
      expect(cardMatchesSingleRule(makeCard(), { borderColors: ['black'] })).toBe(false);
    });
  });

  describe('multiple constraints combined', () => {
    it('requires ALL constraints to pass (AND logic within a rule)', () => {
      const rule: BinderRule = { rarities: ['rare'], priceMin: 5 };
      expect(cardMatchesSingleRule(makeCard({ rarity: 'rare', purchasePrice: 10 }), rule)).toBe(
        true
      );
      expect(cardMatchesSingleRule(makeCard({ rarity: 'rare', purchasePrice: 1 }), rule)).toBe(
        false
      );
      expect(cardMatchesSingleRule(makeCard({ rarity: 'common', purchasePrice: 10 }), rule)).toBe(
        false
      );
    });
  });
});

describe('cardMatchesRules', () => {
  it('returns false for an empty rules array', () => {
    expect(cardMatchesRules(makeCard(), [])).toBe(false);
  });

  it('matches when any rule group matches (OR logic)', () => {
    const rules: BinderRule[] = [{ rarities: ['rare'] }, { rarities: ['mythic'] }];
    expect(cardMatchesRules(makeCard({ rarity: 'mythic' }), rules)).toBe(true);
  });

  it('returns false when no rule group matches', () => {
    const rules: BinderRule[] = [{ rarities: ['rare'] }, { rarities: ['mythic'] }];
    expect(cardMatchesRules(makeCard({ rarity: 'common' }), rules)).toBe(false);
  });

  it('matches everything when one rule is empty', () => {
    const rules: BinderRule[] = [{}];
    expect(cardMatchesRules(makeCard(), rules)).toBe(true);
  });
});

describe('isRuleEmpty', () => {
  it('returns true for a rule with no constraints', () => {
    expect(isRuleEmpty({})).toBe(true);
  });

  it('returns false when any constraint is set', () => {
    expect(isRuleEmpty({ rarities: ['rare'] })).toBe(false);
    expect(isRuleEmpty({ priceMin: 1 })).toBe(false);
    expect(isRuleEmpty({ colors: ['R'] })).toBe(false);
    expect(isRuleEmpty({ nameContains: 'bolt' })).toBe(false);
    expect(isRuleEmpty({ treatments: ['fullart'] })).toBe(false);
    expect(isRuleEmpty({ borderColors: ['borderless'] })).toBe(false);
  });

  it('treats empty arrays and "any" foil as empty', () => {
    expect(isRuleEmpty({ rarities: [], colors: [], types: [], setCodes: [], foil: 'any' })).toBe(
      true
    );
  });

  it('treats whitespace-only nameContains as empty', () => {
    expect(isRuleEmpty({ nameContains: '   ' })).toBe(true);
  });
});

describe('hasEmptyRule', () => {
  it('returns true when at least one rule is empty', () => {
    expect(hasEmptyRule([{ rarities: ['rare'] }, {}])).toBe(true);
  });

  it('returns false when all rules have constraints', () => {
    expect(hasEmptyRule([{ rarities: ['rare'] }, { priceMin: 5 }])).toBe(false);
  });

  it('returns false for an empty array', () => {
    expect(hasEmptyRule([])).toBe(false);
  });
});
