import { describe, expect, it } from 'vitest';
import type { DeckFormat, ScryfallCard } from '@/deck-builder/types';
import type { Deck, DeckCard } from '@/store/decks';
import { convertDeckFormat, describeFormatSwitch } from './convert-deck-format';

const ALL_LEGAL = {
  commander: 'legal',
  brawl: 'legal',
  paupercommander: 'legal',
  modern: 'legal',
  standard: 'legal',
  pioneer: 'legal',
  legacy: 'legal',
  vintage: 'legal',
  pauper: 'legal',
};

function card(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: `sf-${name}`,
    name,
    type_line: 'Instant',
    oracle_text: '',
    rarity: 'common',
    color_identity: ['R'],
    legalities: { ...ALL_LEGAL },
    ...over,
  } as unknown as ScryfallCard;
}

const legend = (name: string, over: Partial<ScryfallCard> = {}) =>
  card(name, { type_line: 'Legendary Creature — Goblin Warrior', rarity: 'rare', ...over });

const KRENKO = legend('Krenko, Tin Street Kingpin');
// "Partner" on both, so they pair (partnerUtils) and either could lead.
const PIR = legend('Pir, Imaginative Rascal', { oracle_text: 'Partner' });
const TOOTH = legend('Toothy, Imaginary Friend', { oracle_text: 'Partner' });
// An uncommon creature: a legal Pauper Commander commander.
const FYNN = card('Fynn, the Fangbearer', {
  type_line: 'Legendary Creature — Human Warrior',
  rarity: 'uncommon',
  color_identity: ['G'],
});

const slot = (c: ScryfallCard, i: number, allocatedCopyId: string | null = null): DeckCard => ({
  slotId: `s${i}`,
  card: c,
  allocatedCopyId,
  addedAt: i,
});

function deck(over: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Krenko',
    format: 'commander',
    source: 'generated',
    commander: KRENKO,
    partnerCommander: null,
    commanderAllocatedCopyId: 'copy-krenko',
    partnerCommanderAllocatedCopyId: null,
    cards: [slot(card('Lightning Bolt'), 1, 'copy-bolt'), slot(card('Goblin Matron'), 2)],
    sideboard: [slot(card('Pyroblast'), 3)],
    considering: [slot(card('Shock'), 4)],
    generationContext: null,
    color: '#c00',
    createdAt: 0,
    updatedAt: 0,
    bracketEstimation: { bracket: 3 } as Deck['bracketEstimation'],
    bracketOverride: 2,
    deckGrade: { letter: 'B', headline: 'solid' },
    planScore: { total: 70 } as unknown as Deck['planScore'],
    gapAnalysis: [],
    optimizeSwaps: {} as Deck['optimizeSwaps'],
    bracketFit: null,
    gradeBracketSignature: 'v16|Krenko',
    categoryTargets: { ramp: 10 },
    ...over,
  };
}

const total = (d: Deck) =>
  d.cards.length +
  d.sideboard.length +
  d.considering.length +
  (d.commander ? 1 : 0) +
  (d.partnerCommander ? 1 : 0);

describe('convertDeckFormat', () => {
  it('Commander to Modern moves the commander and partner into the deck with their copies', () => {
    const d = deck({
      commander: PIR,
      partnerCommander: TOOTH,
      commanderAllocatedCopyId: 'copy-pir',
      partnerCommanderAllocatedCopyId: 'copy-toothy',
    });
    const next = convertDeckFormat(d, 'modern');

    expect(next.format).toBe('modern');
    expect(next.commander).toBeNull();
    expect(next.partnerCommander).toBeNull();
    expect(next.commanderAllocatedCopyId).toBeNull();
    expect(next.partnerCommanderAllocatedCopyId).toBeNull();
    const moved = next.cards.slice(d.cards.length);
    expect(moved.map((c) => [c.card.name, c.allocatedCopyId])).toEqual([
      [PIR.name, 'copy-pir'],
      [TOOTH.name, 'copy-toothy'],
    ]);
    // Existing rows are the same objects: tags, sortIndex, allocations untouched.
    expect(next.cards.slice(0, d.cards.length)).toEqual(d.cards);
    expect(new Set(next.cards.map((c) => c.slotId)).size).toBe(next.cards.length);
  });

  it('Commander to Modern clears the bracket and every commander-derived field', () => {
    const next = convertDeckFormat(deck(), 'modern');
    expect(next.bracketEstimation).toBeUndefined();
    expect(next.bracketOverride).toBeNull();
    expect(next.deckGrade).toBeUndefined();
    expect(next.planScore).toBeUndefined();
    expect(next.gapAnalysis).toBeUndefined();
    expect(next.optimizeSwaps).toBeUndefined();
    expect(next.bracketFit).toBeUndefined();
    expect(next.gradeBracketSignature).toBeUndefined();
    expect(next.categoryTargets).toBeUndefined();
    // Not about the format: kept.
    expect(next.name).toBe('Krenko');
    expect(next.color).toBe('#c00');
    expect(next.source).toBe('generated');
  });

  it('Modern to Commander keeps every card and leaves the commander empty', () => {
    const d = deck({
      format: 'modern',
      commander: null,
      commanderAllocatedCopyId: null,
      cards: [slot(KRENKO, 1, 'copy-krenko'), slot(card('Lightning Bolt'), 2)],
      bracketEstimation: undefined,
      bracketOverride: null,
    });
    const next = convertDeckFormat(d, 'commander');
    expect(next.format).toBe('commander');
    expect(next.commander).toBeNull();
    expect(next.cards).toBe(d.cards);
    expect(next.sideboard).toBe(d.sideboard);
    expect(next.considering).toBe(d.considering);
  });

  it('Commander to Pauper Commander moves a commander PDH cannot have', () => {
    const next = convertDeckFormat(deck(), 'paupercommander');
    expect(next.commander).toBeNull();
    const krenko = next.cards.find((c) => c.card.name === KRENKO.name);
    expect(krenko?.allocatedCopyId).toBe('copy-krenko');
    // A stated bracket survives a move between commander formats.
    expect(next.bracketOverride).toBe(2);
    expect(next.bracketEstimation).toBeUndefined();
  });

  it('keeps a commander the new commander format allows', () => {
    const d = deck({ commander: FYNN, commanderAllocatedCopyId: 'copy-fynn' });
    const next = convertDeckFormat(d, 'paupercommander');
    expect(next.commander).toBe(FYNN);
    expect(next.commanderAllocatedCopyId).toBe('copy-fynn');
    expect(next.cards).toBe(d.cards);
    // The analysis ran for the old format, so it recomputes.
    expect(next.gradeBracketSignature).toBeUndefined();
  });

  it('keeps a legal PDH commander but moves a partner PDH rejects', () => {
    const fynnPartner = { ...FYNN, oracle_text: 'Partner' } as ScryfallCard;
    const d = deck({
      commander: fynnPartner,
      partnerCommander: TOOTH,
      commanderAllocatedCopyId: null,
      partnerCommanderAllocatedCopyId: 'copy-toothy',
    });
    const next = convertDeckFormat(d, 'paupercommander');
    expect(next.commander).toBe(fynnPartner);
    expect(next.partnerCommander).toBeNull();
    expect(next.cards.at(-1)?.card.name).toBe(TOOTH.name);
    expect(next.cards.at(-1)?.allocatedCopyId).toBe('copy-toothy');
  });

  it('returns the same deck for its own format', () => {
    const d = deck();
    expect(convertDeckFormat(d, 'commander')).toBe(d);
  });

  it('never drops a card, whichever way it switches', () => {
    const formats: DeckFormat[] = [
      'commander',
      'brawl',
      'paupercommander',
      'standard',
      'pauper',
      'modern',
      'pioneer',
      'legacy',
      'vintage',
    ];
    const start = deck({ partnerCommander: TOOTH, commander: PIR });
    for (const a of formats) {
      for (const b of formats) {
        const there = convertDeckFormat(convertDeckFormat(start, a), b);
        expect(total(there), `${a} → ${b}`).toBe(total(start));
      }
    }
  });
});

describe('describeFormatSwitch', () => {
  it('Commander to Modern: the commander moves, the sideboard counts, analysis goes', () => {
    expect(describeFormatSwitch(deck(), 'modern')).toEqual([
      'Krenko, Tin Street Kingpin moves into the main deck.',
      'The sideboard counts toward legality.',
      'Bracket, Coach and the upgrade plan only apply to Commander decks.',
    ]);
  });

  it('names both partners when both move', () => {
    const lines = describeFormatSwitch(deck({ commander: PIR, partnerCommander: TOOTH }), 'modern');
    expect(lines[0]).toBe(`${PIR.name} and ${TOOTH.name} move into the main deck.`);
  });

  it('Standard to Commander: choose a commander, the legends, the multi-copy count', () => {
    const bolt = card('Lightning Bolt');
    const shock = card('Shock');
    const d = deck({
      format: 'standard',
      commander: null,
      commanderAllocatedCopyId: null,
      cards: [
        slot(KRENKO, 1),
        slot(bolt, 2),
        slot(bolt, 3),
        slot(bolt, 4),
        slot(shock, 5),
        slot(shock, 6),
        slot(card('Mountain', { type_line: 'Basic Land — Mountain' }), 7),
        slot(card('Mountain', { type_line: 'Basic Land — Mountain' }), 8),
      ],
      sideboard: [slot(card('Pyroblast'), 9)],
    });
    expect(describeFormatSwitch(d, 'commander')).toEqual([
      'Choose a commander next. Legends in this deck: Krenko, Tin Street Kingpin.',
      // Bolt and Shock; basics may run any number.
      '2 cards run more than one copy and get flagged.',
      'The sideboard stops counting toward legality.',
    ]);
  });

  it('caps the legends list', () => {
    const names = ['A', 'B', 'C', 'D', 'E'].map((n) => legend(`Legend ${n}`));
    const d = deck({
      format: 'modern',
      commander: null,
      cards: names.map((c, i) => slot(c, i)),
      sideboard: [],
    });
    expect(describeFormatSwitch(d, 'brawl')[0]).toBe(
      'Choose a commander next. Legends in this deck: Legend A, Legend B, Legend C and 2 more.'
    );
  });

  it('only counts cards the switch newly flags', () => {
    const d = deck({
      cards: [
        slot(card('Lightning Bolt', { legalities: { ...ALL_LEGAL, standard: 'not_legal' } }), 1),
        slot(card('Opt'), 2),
      ],
      sideboard: [],
    });
    expect(describeFormatSwitch(d, 'standard')).toContain(
      "1 card isn't legal in Standard and gets flagged."
    );
    expect(describeFormatSwitch(d, 'modern')).not.toContainEqual(
      expect.stringContaining('legal in')
    );
  });

  it('says when the commander has to move between commander formats', () => {
    expect(describeFormatSwitch(deck(), 'paupercommander')[0]).toBe(
      "Krenko, Tin Street Kingpin can't lead a Pauper Commander deck, so it moves into the main deck."
    );
  });

  it('leaves out lines that are not true for this deck', () => {
    const d = deck({ format: 'modern', commander: null, sideboard: [] });
    expect(describeFormatSwitch(d, 'pioneer')).toEqual(['Nothing else changes.']);
  });

  // E468: the 15-card cap is enforced, so the sheet says so when the switch
  // starts flagging the sideboard, and only then.
  it('names a sideboard over 15 when switching into a 60-card format', () => {
    const side = Array.from({ length: 22 }, (_, i) => slot(card(`Side ${i}`), 100 + i));
    expect(describeFormatSwitch(deck({ sideboard: side }), 'modern')).toContain(
      'The sideboard has 22 cards. Modern allows 15.'
    );
    const fifteen = side.slice(0, 15);
    expect(describeFormatSwitch(deck({ sideboard: fifteen }), 'modern')).not.toContainEqual(
      expect.stringContaining('allows 15')
    );
    // Modern to Pioneer keeps the same cap: already flagged, nothing new.
    const modern = deck({ format: 'modern', commander: null, sideboard: side });
    expect(describeFormatSwitch(modern, 'pioneer')).not.toContainEqual(
      expect.stringContaining('allows 15')
    );
    // Into Commander the sideboard is an uncapped holding pile.
    expect(describeFormatSwitch(modern, 'commander')).not.toContainEqual(
      expect.stringContaining('allows')
    );
  });

  it('is empty for the current format', () => {
    expect(describeFormatSwitch(deck(), 'commander')).toEqual([]);
  });
});
