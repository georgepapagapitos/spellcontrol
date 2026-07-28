import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { Deck, DeckCard } from '../store/decks';
import type { EnrichedCard } from '../types';
import { parseBulkEditText, findPendingNames, buildBulkEditPlan } from './deck-bulk-edit';

function card(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: overrides.name ? `sf-${overrides.name}` : 'sf-1',
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

function owned(name: string, copyId: string): EnrichedCard {
  return {
    copyId,
    name,
    scryfallId: `sf-${name}`,
    finish: 'nonfoil',
    foil: false,
  } as unknown as EnrichedCard;
}

function slot(c: ScryfallCard, allocatedCopyId: string | null = null, slotId?: string): DeckCard {
  return { slotId: slotId ?? `slot-${c.name}-${Math.random()}`, card: c, allocatedCopyId };
}

function baseDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Test Deck',
    source: 'manual',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as Deck;
}

const commanderConfig = DECK_FORMAT_CONFIGS.commander;
const emptyCtx = { decks: [] as Deck[], collectionCards: [] as EnrichedCard[] };

describe('parseBulkEditText', () => {
  it('parses plain "qty name" lines into the main zone', () => {
    const parsed = parseBulkEditText('1 Sol Ring\n1 Arcane Signet\n10 Forest');
    expect(parsed.main).toEqual([
      { name: 'Sol Ring', qty: 1 },
      { name: 'Arcane Signet', qty: 1 },
      { name: 'Forest', qty: 10 },
    ]);
    expect(parsed.malformedLines).toEqual([]);
  });

  it('routes Commander / Sideboard / Maybeboard sections to their own buckets', () => {
    const text = [
      'Commander',
      '1 Korvold, Fae-Cursed King',
      '',
      'Deck',
      '1 Sol Ring',
      '',
      'Sideboard',
      '1 Negate',
      '',
      'Maybeboard',
      '1 Rhystic Study',
    ].join('\n');
    const parsed = parseBulkEditText(text);
    expect(parsed.commanderLines).toEqual([{ name: 'Korvold, Fae-Cursed King', qty: 1 }]);
    expect(parsed.main).toEqual([{ name: 'Sol Ring', qty: 1 }]);
    expect(parsed.sideboard).toEqual([{ name: 'Negate', qty: 1 }]);
    expect(parsed.considering).toEqual([{ name: 'Rhystic Study', qty: 1 }]);
  });

  it('takes a 2nd Commander line as the partner', () => {
    const parsed = parseBulkEditText(
      'Commander\n1 Thrasios, Triton Hero\n1 Vial Smasher the Fierce'
    );
    expect(parsed.commanderLines.map((l) => l.name)).toEqual([
      'Thrasios, Triton Hero',
      'Vial Smasher the Fierce',
    ]);
  });

  it('strips a trailing (SET) NUM printing suffix and Moxfield finish tags', () => {
    const parsed = parseBulkEditText('1 Sol Ring (CMR) 472\n1 Rhystic Study (P02) 46 *F*');
    expect(parsed.main).toEqual([
      { name: 'Sol Ring', qty: 1 },
      { name: 'Rhystic Study', qty: 1 },
    ]);
  });

  it('collects lines that are not blank, not a header, and do not parse as "qty name"', () => {
    const parsed = parseBulkEditText('1 Sol Ring\nnot a real line\nSol Ring 1');
    expect(parsed.malformedLines).toEqual(['not a real line', 'Sol Ring 1']);
  });

  it('recognizes Companion as a header and silently drops its lines (never malformed)', () => {
    const parsed = parseBulkEditText('Companion\n1 Lurrus of the Dream-Den\n\nDeck\n1 Sol Ring');
    expect(parsed.malformedLines).toEqual([]);
    expect(parsed.main).toEqual([{ name: 'Sol Ring', qty: 1 }]);
  });
});

describe('findPendingNames', () => {
  it('is empty when every parsed name already exists somewhere in the deck', () => {
    const deck = baseDeck({
      commander: card({ name: 'Korvold, Fae-Cursed King' }),
      cards: [slot(card({ name: 'Sol Ring' }))],
      sideboard: [slot(card({ name: 'Negate' }))],
    });
    const parsed = parseBulkEditText(
      'Commander\n1 Korvold, Fae-Cursed King\n\nDeck\n1 Sol Ring\n\nSideboard\n1 Negate'
    );
    expect(findPendingNames(deck, parsed)).toEqual([]);
  });

  it('lists only genuinely new names, deduped', () => {
    const deck = baseDeck({ cards: [slot(card({ name: 'Sol Ring' }))] });
    const parsed = parseBulkEditText('1 Sol Ring\n1 Mana Crypt\n1 Mana Crypt');
    expect(findPendingNames(deck, parsed)).toEqual(['Mana Crypt']);
  });
});

describe('buildBulkEditPlan — allocation preservation (the critical contract)', () => {
  it('byte-identical round trip: hasChanges is false and every allocatedCopyId survives', () => {
    const solRing = card({ name: 'Sol Ring' });
    const deck = baseDeck({
      commander: card({ name: 'Korvold, Fae-Cursed King' }),
      commanderAllocatedCopyId: 'copy-cmdr',
      cards: [slot(solRing, 'copy-1', 's1')],
    });
    const parsed = parseBulkEditText('Commander\n1 Korvold, Fae-Cursed King\n\nDeck\n1 Sol Ring');
    const plan = buildBulkEditPlan(deck, parsed, new Map(), commanderConfig, emptyCtx);
    expect(plan.hasChanges).toBe(false);
    expect(plan.cards).toEqual(deck.cards);
    expect(plan.commanderAllocatedCopyId).toBe('copy-cmdr');
    expect(plan.added).toEqual([]);
    expect(plan.removed).toEqual([]);
  });

  it('quantity increase: the surviving slot keeps its allocatedCopyId; the new one allocates fresh', () => {
    const forest = card({ name: 'Forest' });
    const deck = baseDeck({
      format: 'standard',
      cards: [slot(forest, 'copy-1', 's1')],
    });
    const parsed = parseBulkEditText('2 Forest');
    const ctx = { decks: [deck], collectionCards: [owned('Forest', 'copy-2')] };
    const plan = buildBulkEditPlan(deck, parsed, new Map(), DECK_FORMAT_CONFIGS.standard, ctx);
    const copyIds = plan.cards.map((c) => c.allocatedCopyId).sort();
    expect(copyIds).toEqual(['copy-1', 'copy-2']);
    expect(plan.cards.find((c) => c.slotId === 's1')).toBeDefined();
    expect(plan.added).toEqual([{ name: 'Forest', qty: 1 }]);
  });

  it('quantity decrease: releases the excess, the remaining slot keeps its allocatedCopyId', () => {
    const bolt = card({ name: 'Lightning Bolt' });
    const deck = baseDeck({
      format: 'standard',
      cards: [slot(bolt, 'copy-1', 's1'), slot(bolt, 'copy-2', 's2'), slot(bolt, null, 's3')],
    });
    const parsed = parseBulkEditText('1 Lightning Bolt');
    const plan = buildBulkEditPlan(deck, parsed, new Map(), DECK_FORMAT_CONFIGS.standard, emptyCtx);
    expect(plan.cards).toHaveLength(1);
    expect(['copy-1', 'copy-2', null]).toContain(plan.cards[0].allocatedCopyId);
    expect(plan.removed).toEqual([{ name: 'Lightning Bolt', qty: 2 }]);
  });

  it('a card removed entirely from the text is dropped from the plan (its claim is freed by omission)', () => {
    const solRing = card({ name: 'Sol Ring' });
    const signet = card({ name: 'Arcane Signet' });
    const deck = baseDeck({
      cards: [slot(solRing, 'copy-1', 's1'), slot(signet, 'copy-2', 's2')],
    });
    const parsed = parseBulkEditText('1 Sol Ring');
    const plan = buildBulkEditPlan(deck, parsed, new Map(), commanderConfig, emptyCtx);
    expect(plan.cards.map((c) => c.card.name)).toEqual(['Sol Ring']);
    expect(plan.cards[0].allocatedCopyId).toBe('copy-1');
    expect(plan.removed).toEqual([{ name: 'Arcane Signet', qty: 1 }]);
  });

  it('a card moved from mainboard to sideboard keeps its allocatedCopyId (pool spans zones)', () => {
    const negate = card({ name: 'Negate' });
    const deck = baseDeck({
      format: 'standard',
      cards: [slot(negate, 'copy-1', 's1')],
      sideboard: [],
    });
    const parsed = parseBulkEditText('Sideboard\n1 Negate');
    const plan = buildBulkEditPlan(deck, parsed, new Map(), DECK_FORMAT_CONFIGS.standard, emptyCtx);
    expect(plan.cards).toEqual([]);
    expect(plan.sideboard).toHaveLength(1);
    expect(plan.sideboard[0].allocatedCopyId).toBe('copy-1');
    expect(plan.sideboard[0].slotId).toBe('s1');
    // Net qty-by-name unchanged, so this doesn't count as an add/remove —
    // but the zone move itself must still flip hasChanges.
    expect(plan.added).toEqual([]);
    expect(plan.removed).toEqual([]);
    expect(plan.hasChanges).toBe(true);
  });

  it('a brand-new resolved name allocates an owned copy when the collection has one', () => {
    const deck = baseDeck({ cards: [] });
    const crypt = card({ name: 'Mana Crypt' });
    const parsed = parseBulkEditText('1 Mana Crypt');
    const resolved = new Map([['mana crypt', crypt]]);
    const ctx = { decks: [deck], collectionCards: [owned('Mana Crypt', 'copy-crypt')] };
    const plan = buildBulkEditPlan(deck, parsed, resolved, commanderConfig, ctx);
    expect(plan.cards).toEqual([
      {
        slotId: expect.any(String),
        card: crypt,
        allocatedCopyId: 'copy-crypt',
        addedAt: expect.any(Number),
      },
    ]);
    expect(plan.added).toEqual([{ name: 'Mana Crypt', qty: 1 }]);
  });

  it('a brand-new name with no owned copy lands unbound, not blocked', () => {
    const deck = baseDeck({ cards: [] });
    const crypt = card({ name: 'Mana Crypt' });
    const parsed = parseBulkEditText('1 Mana Crypt');
    const plan = buildBulkEditPlan(
      deck,
      parsed,
      new Map([['mana crypt', crypt]]),
      commanderConfig,
      emptyCtx
    );
    expect(plan.cards[0].allocatedCopyId).toBeNull();
    expect(plan.unresolvedNames).toEqual([]);
  });

  it('a name resolved nowhere (not in deck, not fetched) is reported unresolved and skipped', () => {
    const deck = baseDeck({ cards: [] });
    const parsed = parseBulkEditText('1 Totally Fake Card');
    const plan = buildBulkEditPlan(deck, parsed, new Map(), commanderConfig, emptyCtx);
    expect(plan.cards).toEqual([]);
    expect(plan.unresolvedNames).toEqual(['Totally Fake Card']);
  });

  it('commander unchanged (same name) preserves commanderAllocatedCopyId exactly', () => {
    const cmdr = card({ name: 'Korvold, Fae-Cursed King' });
    const deck = baseDeck({ commander: cmdr, commanderAllocatedCopyId: 'copy-cmdr' });
    const parsed = parseBulkEditText('Commander\n1 Korvold, Fae-Cursed King');
    const plan = buildBulkEditPlan(deck, parsed, new Map(), commanderConfig, emptyCtx);
    expect(plan.commanderAllocatedCopyId).toBe('copy-cmdr');
    expect(plan.commanderMissing).toBe(false);
  });

  it('commander changed to a different (owned) name reallocates instead of carrying the old copyId', () => {
    const oldCmdr = card({ name: 'Korvold, Fae-Cursed King' });
    const newCmdr = card({ name: 'The Ur-Dragon' });
    const deck = baseDeck({ commander: oldCmdr, commanderAllocatedCopyId: 'copy-old' });
    const parsed = parseBulkEditText('Commander\n1 The Ur-Dragon');
    const resolved = new Map([['the ur-dragon', newCmdr]]);
    const ctx = { decks: [deck], collectionCards: [owned('The Ur-Dragon', 'copy-new')] };
    const plan = buildBulkEditPlan(deck, parsed, resolved, commanderConfig, ctx);
    expect(plan.commander).toBe(newCmdr);
    expect(plan.commanderAllocatedCopyId).toBe('copy-new');
  });

  it('emptying the Commander section on a deck that had one blocks via commanderMissing', () => {
    const cmdr = card({ name: 'Korvold, Fae-Cursed King' });
    const deck = baseDeck({ commander: cmdr, commanderAllocatedCopyId: 'copy-cmdr' });
    const parsed = parseBulkEditText('1 Sol Ring'); // no Commander section at all
    const plan = buildBulkEditPlan(deck, parsed, new Map(), commanderConfig, emptyCtx);
    expect(plan.commanderMissing).toBe(true);
  });

  it('a deck with no commander yet and none in the paste is not blocked', () => {
    const deck = baseDeck({ commander: null });
    const parsed = parseBulkEditText('1 Sol Ring');
    const plan = buildBulkEditPlan(deck, parsed, new Map(), commanderConfig, emptyCtx);
    expect(plan.commanderMissing).toBe(false);
    expect(plan.commander).toBeNull();
  });

  it('surfaces a color-identity violation introduced by the edit as a legality issue, non-blocking', () => {
    const cmdr = card({ name: 'Korvold, Fae-Cursed King', color_identity: ['B', 'G', 'R'] });
    const deck = baseDeck({ commander: cmdr });
    const outOfColor = card({ name: 'Counterspell', color_identity: ['U'] });
    const parsed = parseBulkEditText(
      'Commander\n1 Korvold, Fae-Cursed King\n\nDeck\n1 Counterspell'
    );
    const plan = buildBulkEditPlan(
      deck,
      parsed,
      new Map([['counterspell', outOfColor]]),
      commanderConfig,
      emptyCtx
    );
    expect(plan.legalityIssues.some((i) => i.issue === 'color-identity')).toBe(true);
  });

  it('passes malformed lines through to the plan untouched', () => {
    const deck = baseDeck({ cards: [] });
    const parsed = parseBulkEditText('1 Sol Ring\ngarbage line here');
    const plan = buildBulkEditPlan(deck, parsed, new Map(), commanderConfig, emptyCtx);
    expect(plan.malformedLines).toEqual(['garbage line here']);
  });
});
