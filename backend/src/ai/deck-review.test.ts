import { describe, it, expect } from 'vitest';
import {
  MAX_CARDS,
  buildUserMessage,
  hashDeckReviewInput,
  parseDeckReviewRequest,
  renderAnalysis,
  type DeckReviewRequest,
} from './deck-review';

function validBody(): Record<string, unknown> {
  return {
    deckId: 'deck-1',
    commander: 'Meren of Clan Nel Toth',
    cards: [
      { name: 'Sol Ring', oracleId: 'oracle-sol-ring', qty: 1 },
      { name: 'Swamp', oracleId: 'oracle-swamp', qty: 12 },
    ],
    analysis: { totalNonCommander: 13, types: { lands: 12 } },
  };
}

describe('parseDeckReviewRequest', () => {
  it('accepts a valid body', () => {
    const res = parseDeckReviewRequest(validBody());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.commander).toBe('Meren of Clan Nel Toth');
      expect(res.value.cards).toHaveLength(2);
    }
  });

  it('rejects a non-object body', () => {
    expect(parseDeckReviewRequest(null).ok).toBe(false);
    expect(parseDeckReviewRequest('x').ok).toBe(false);
  });

  it.each([
    ['deckId', { deckId: '' }],
    ['commander', { commander: '  ' }],
    ['cards missing', { cards: [] }],
    ['analysis missing', { analysis: null }],
    ['analysis array', { analysis: [] }],
  ])('rejects invalid %s', (_label, patch) => {
    const res = parseDeckReviewRequest({ ...validBody(), ...patch });
    expect(res.ok).toBe(false);
  });

  it.each([
    ['name', { name: '' }],
    ['name too long', { name: 'x'.repeat(201) }],
    ['oracleId', { oracleId: 42 }],
    ['qty zero', { qty: 0 }],
    ['qty fractional', { qty: 1.5 }],
    ['qty over 99', { qty: 100 }],
  ])('rejects invalid card %s', (_label, patch) => {
    const body = validBody();
    (body.cards as Record<string, unknown>[])[0] = {
      ...(body.cards as Record<string, unknown>[])[0],
      ...patch,
    };
    expect(parseDeckReviewRequest(body).ok).toBe(false);
  });

  it('caps the card list', () => {
    const body = validBody();
    body.cards = Array.from({ length: MAX_CARDS + 1 }, (_, i) => ({
      name: `Card ${i}`,
      oracleId: `o-${i}`,
      qty: 1,
    }));
    const res = parseDeckReviewRequest(body);
    expect(res.ok).toBe(false);
  });

  it('caps the analysis payload size', () => {
    const body = validBody();
    body.analysis = { blob: 'x'.repeat(70 * 1024) };
    expect(parseDeckReviewRequest(body).ok).toBe(false);
  });
});

describe('hashDeckReviewInput', () => {
  const base = (): DeckReviewRequest => {
    const parsed = parseDeckReviewRequest(validBody());
    if (!parsed.ok) throw new Error('fixture invalid');
    return parsed.value;
  };

  it('is stable across card order and object key order', () => {
    const a = base();
    const b = base();
    b.cards.reverse();
    b.analysis = { types: { lands: 12 }, totalNonCommander: 13 };
    expect(hashDeckReviewInput(a)).toBe(hashDeckReviewInput(b));
  });

  it('changes when a card qty changes', () => {
    const a = base();
    const b = base();
    b.cards[0] = { ...b.cards[0], qty: 2 };
    expect(hashDeckReviewInput(a)).not.toBe(hashDeckReviewInput(b));
  });

  it('changes when the analysis changes', () => {
    const a = base();
    const b = base();
    b.analysis = { ...b.analysis, totalNonCommander: 99 };
    expect(hashDeckReviewInput(a)).not.toBe(hashDeckReviewInput(b));
  });

  it('ignores deckId — the same deck content on two decks shares a hash', () => {
    const a = base();
    const b = { ...base(), deckId: 'other-deck' };
    expect(hashDeckReviewInput(a)).toBe(hashDeckReviewInput(b));
  });
});

describe('renderAnalysis', () => {
  it('renders the known DeckAnalysisResult fields', () => {
    const out = renderAnalysis({
      totalNonCommander: 99,
      types: { lands: 36, creatures: 30, instants: 10, battles: 0 },
      curve: {
        averageCmc: 3.1,
        buckets: [
          { cmc: 1, count: 9 },
          { cmc: 7, count: 6 },
        ],
      },
      roles: [
        { label: 'Ramp', count: 10 },
        { label: 'Spot removal', count: 3 },
      ],
    });
    expect(out).toContain('Cards (excluding commander): 99');
    expect(out).toContain('Lands: 36');
    expect(out).toContain('Average mana value (nonland): 3.1');
    expect(out).toContain('1: 9 · 7+: 6');
    expect(out).toContain('Ramp 10 · Spot removal 3');
    expect(out).toContain('Creatures 30 · Instants 10');
    expect(out).not.toContain('Battles');
  });

  it('survives an empty or malformed analysis', () => {
    expect(renderAnalysis({})).toContain('no statistics');
    expect(renderAnalysis({ curve: { buckets: 'nope' }, roles: 7 } as never)).toContain(
      'no statistics'
    );
  });
});

describe('buildUserMessage', () => {
  it('includes commander, decklist, stats, and oracle reference', () => {
    const parsed = parseDeckReviewRequest(validBody());
    if (!parsed.ok) throw new Error('fixture invalid');
    const msg = buildUserMessage(parsed.value, [
      {
        name: 'Sol Ring',
        manaCost: '{1}',
        typeLine: 'Artifact',
        oracleText: '{T}: Add {C}{C}.\nSecond line.',
      },
    ]);
    expect(msg).toContain('Commander: Meren of Clan Nel Toth');
    expect(msg).toContain('## Decklist (13)');
    expect(msg).toContain('12 Swamp');
    expect(msg).toContain('Lands: 12');
    expect(msg).toContain('Sol Ring {1} — Artifact: {T}: Add {C}{C}. Second line.');
  });

  it('omits the oracle section when nothing resolved', () => {
    const parsed = parseDeckReviewRequest(validBody());
    if (!parsed.ok) throw new Error('fixture invalid');
    expect(buildUserMessage(parsed.value, [])).not.toContain('Card reference');
  });
});
