import { describe, it, expect } from 'vitest';
import type { BracketEstimation } from '@spellcontrol/deck-metrics';
import { buildFactsSheet, renderFactsSheet } from './facts-sheet';
import { buildUserMessage, type DeckReviewRequest, type OracleEntry } from './deck-review';

// Oracle lines copied verbatim from the eval fixtures' Card reference blocks,
// which come from Scryfall's oracle data (never author-written).
const FIERY: OracleEntry = {
  name: 'Fiery Confluence',
  manaCost: '{2}{R}{R}',
  typeLine: 'Sorcery',
  oracleText:
    'Choose three. You may choose the same mode more than once. • Fiery Confluence deals 1 damage to each creature. • Fiery Confluence deals 2 damage to each opponent. • Destroy target artifact.',
};
const SOL_RING: OracleEntry = {
  name: 'Sol Ring',
  manaCost: '{1}',
  typeLine: 'Artifact',
  oracleText: '{T}: Add {C}{C}.',
};
const TROPHY: OracleEntry = {
  name: "Assassin's Trophy",
  manaCost: '{B}{G}',
  typeLine: 'Instant',
  oracleText:
    'Destroy target permanent an opponent controls. Its controller may search their library for a basic land card, put it onto the battlefield, then shuffle.',
};
const TOWER: OracleEntry = {
  name: 'Command Tower',
  typeLine: 'Land',
  oracleText: "{T}: Add one mana of any color in your commander's color identity.",
};
const FOOTHILLS: OracleEntry = {
  name: 'Wooded Foothills',
  typeLine: 'Land',
  oracleText:
    '{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or Forest card, put it onto the battlefield, then shuffle.',
};
const CULTIVATE: OracleEntry = {
  name: 'Cultivate',
  manaCost: '{2}{G}',
  typeLine: 'Sorcery',
  oracleText:
    'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
};
const KRENKO: OracleEntry = {
  name: 'Krenko, Mob Boss',
  manaCost: '{2}{R}{R}',
  typeLine: 'Legendary Creature — Goblin Warrior',
  oracleText:
    '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
};

const MOUNTAIN: OracleEntry = {
  name: 'Mountain',
  typeLine: 'Basic Land — Mountain',
  oracleText: '({T}: Add {R}.)',
};

const oracle = [MOUNTAIN, FIERY, SOL_RING, TROPHY, TOWER, FOOTHILLS, CULTIVATE, KRENKO];
const cards = [
  { name: 'Fiery Confluence', qty: 1 },
  { name: 'Sol Ring', qty: 1 },
  { name: "Assassin's Trophy", qty: 1 },
  { name: 'Command Tower', qty: 1 },
  { name: 'Wooded Foothills', qty: 1 },
  { name: 'Cultivate', qty: 1 },
  { name: 'Mountain', qty: 20 },
];

const noTags = () => false;
const tagSet =
  (m: Record<string, string[]>) =>
  (name: string, tag: string): boolean =>
    m[name]?.includes(tag) ?? false;

const base = { commanders: ['Krenko, Mob Boss'], cards, oracle, taggerHas: noTags };
const line = (sheet: string, label: string) =>
  sheet.split('\n').find((l) => l.startsWith(`- ${label}`)) ?? '';

describe('buildFactsSheet', () => {
  it('names a modal sweeper from its rules text even when no tag set knows it', () => {
    const sheet = buildFactsSheet(base);
    expect(line(sheet, 'Sweepers')).toBe('- Sweepers (1): Fiery Confluence');
  });

  it('names it from the tag data too, without double counting', () => {
    const sheet = buildFactsSheet({
      ...base,
      taggerHas: tagSet({ 'Fiery Confluence': ['boardwipe', 'spot-removal'] }),
      otagHas: tagSet({ 'Fiery Confluence': ['sweeper', 'removal-artifact'] }),
    });
    expect(line(sheet, 'Sweepers')).toBe('- Sweepers (1): Fiery Confluence');
    expect(line(sheet, 'Spot removal')).toBe(
      "- Spot removal (2): Fiery Confluence, Assassin's Trophy"
    );
  });

  it('keeps a card the tagger set calls a sweeper even when the oracle tags do not (matches the deck page roles)', () => {
    const sheet = buildFactsSheet({
      ...base,
      cards: [{ name: 'Plaguecrafter', qty: 1 }],
      oracle: [],
      taggerHas: tagSet({ Plaguecrafter: ['boardwipe'] }),
      otagHas: noTags,
    });
    expect(line(sheet, 'Sweepers')).toBe('- Sweepers (1): Plaguecrafter');
  });

  it('lists the answers by target type, and a target permanent answers every type', () => {
    const answers = line(buildFactsSheet(base), 'Answers by target type');
    expect(answers).toContain("artifact: Fiery Confluence, Assassin's Trophy");
    expect(answers).toContain("enchantment: Assassin's Trophy");
    expect(answers).toContain("planeswalker: Assassin's Trophy");
    expect(answers).toContain('graveyard: none');
  });

  it('says none for a role nothing fills, and leaves lands and the commander out of roles', () => {
    const sheet = buildFactsSheet(base);
    expect(line(sheet, 'Counterspells')).toBe('- Counterspells (0): none');
    expect(line(sheet, 'Protection')).toBe('- Protection (0): none');
    expect(sheet).not.toMatch(/Ramp[^\n]*Command Tower/);
    expect(sheet).not.toMatch(/(?:Sweepers|Spot removal)[^\n]*Krenko/);
    expect(line(sheet, 'Commander')).toBe('- Commander: Krenko, Mob Boss');
  });

  it('puts a ramp artifact in ramp from the tag and leaves a land fetch spell to the tags', () => {
    const sheet = buildFactsSheet({
      ...base,
      taggerHas: tagSet({ 'Sol Ring': ['ramp'], Cultivate: ['ramp'] }),
    });
    expect(line(sheet, 'Ramp')).toBe('- Ramp (2): Sol Ring, Cultivate');
  });

  it('counts mana symbols against lands that add the color, not fetch lands', () => {
    const mana = line(buildFactsSheet(base), 'Mana');
    // Fiery 2 + Trophy B,G + Cultivate G + Krenko 2: R 4, B 1, G 2.
    expect(mana).toContain('22 lands');
    expect(mana).toContain('B 1, R 4, G 2');
    // Command Tower adds every color; 20 Mountains add R; the fetch land adds none.
    expect(mana).toContain('B 1, R 21, G 1');
    expect(mana).toContain('fetch lands are not counted');
  });

  it('adds bracket signals when an estimate is given', () => {
    const bracket = {
      breakdown: {
        gameChangerCount: 1,
        gameChangerNames: ['Rhystic Study'],
        massLandDenialCount: 0,
        massLandDenialNames: [],
        extraTurnCount: 0,
        extraTurnNames: [],
        twoCardComboCount: 0,
        tutorCount: 0,
        tutorNames: [],
        fastManaCount: 1,
        fastManaNames: ['Sol Ring'],
      },
    } as unknown as BracketEstimation;
    const sheet = buildFactsSheet({ ...base, bracket });
    expect(line(sheet, 'Bracket signals')).toBe(
      '- Bracket signals: game changers: Rhystic Study · fast mana: Sol Ring'
    );
    expect(buildFactsSheet(base)).not.toContain('Bracket signals');
  });

  it('caps a long list but keeps the count', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Rock ${i}`, qty: 1 }));
    const sheet = buildFactsSheet({
      ...base,
      cards: many,
      oracle: [],
      taggerHas: (_n, t) => t === 'ramp',
    });
    expect(line(sheet, 'Ramp')).toMatch(/^- Ramp \(20\): Rock 0, .*Rock 13, and 6 more$/);
  });
});

describe('the sheet in the user message', () => {
  const req: DeckReviewRequest = {
    deckId: 'd',
    commander: 'Krenko, Mob Boss',
    cards: cards.map((c) => ({ ...c, oracleId: c.name })),
    scope: 'any',
    currency: 'usd',
    format: 'commander',
    analysis: { totalNonCommander: 27 },
  };

  it('sits between the statistics and the card reference', () => {
    const sheet = buildFactsSheet(base);
    const msg = buildUserMessage(req, oracle, sheet);
    const at = (h: string) => msg.indexOf(h);
    expect(at('## Statistics')).toBeLessThan(at('## Facts sheet'));
    expect(at('## Facts sheet')).toBeLessThan(at('## Card reference'));
    expect(msg).toContain(renderFactsSheet(sheet));
  });

  it('adds no section when there is no sheet', () => {
    expect(buildUserMessage(req, oracle)).not.toContain('Facts sheet');
  });
});
