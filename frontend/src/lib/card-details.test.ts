import { describe, expect, it } from 'vitest';
import { cardFaces, isKeywordLine, legalityRows } from './card-details';
import type { EnrichedCard } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';

const enriched = (over: Partial<EnrichedCard> = {}): EnrichedCard =>
  ({ name: 'X', oracleText: undefined, ...over }) as EnrichedCard;
const scry = (over: Partial<ScryfallCard>): ScryfallCard =>
  ({ id: 'i', oracle_id: 'o', name: 'X', cmc: 0, ...over }) as unknown as ScryfallCard;

describe('cardFaces', () => {
  it('falls back to EnrichedCard.oracleText before the live card resolves', () => {
    const faces = cardFaces(enriched({ oracleText: 'Draw a card.' }), null);
    expect(faces).toHaveLength(1);
    expect(faces[0].oracleText).toBe('Draw a card.');
  });

  it('returns no faces when there is nothing to show', () => {
    expect(cardFaces(enriched(), null)).toEqual([]);
  });

  it('reads flavor and power/toughness from the live card', () => {
    const faces = cardFaces(
      enriched({ oracleText: 'Trample.' }),
      scry({ oracle_text: 'Trample.', flavor_text: 'Roar.', power: '4', toughness: '5' })
    );
    expect(faces[0]).toMatchObject({ flavorText: 'Roar.', pt: '4/5' });
  });

  it('surfaces planeswalker loyalty (no P/T)', () => {
    const faces = cardFaces(enriched(), scry({ oracle_text: '+1: …', loyalty: '3' }));
    expect(faces[0].pt).toBeUndefined();
    expect(faces[0].loyalty).toBe('3');
  });

  it('splits a double-faced card into per-face blocks', () => {
    const faces = cardFaces(
      enriched(),
      scry({
        card_faces: [
          { name: 'Front', type_line: 'Creature', oracle_text: 'A', power: '2', toughness: '2' },
          { name: 'Back', type_line: 'Land', oracle_text: 'B' },
        ],
      })
    );
    expect(faces).toHaveLength(2);
    expect(faces[0]).toMatchObject({ name: 'Front', pt: '2/2' });
    expect(faces[1]).toMatchObject({ name: 'Back', oracleText: 'B' });
  });
});

describe('isKeywordLine', () => {
  it('flags bare keyword lines', () => {
    expect(isKeywordLine('Menace')).toBe(true);
    expect(isKeywordLine('Flying, vigilance')).toBe(true);
    expect(isKeywordLine('Equip {2}')).toBe(true);
  });

  it('ignores reminder text when classifying', () => {
    expect(isKeywordLine('Flying (This creature can only be blocked by fliers.)')).toBe(true);
  });

  it('rejects ability sentences, mode headers, and bullets', () => {
    expect(isKeywordLine('Other enchantment creatures you control have menace.')).toBe(false);
    expect(isKeywordLine('Choose one —')).toBe(false);
    expect(isKeywordLine('• Draw a card.')).toBe(false);
    expect(isKeywordLine('')).toBe(false);
  });
});

describe('legalityRows', () => {
  it('returns nothing without legalities', () => {
    expect(legalityRows(undefined)).toEqual([]);
  });

  it('keeps only known formats, in canonical order, with mapped status', () => {
    const rows = legalityRows({
      commander: 'legal',
      modern: 'banned',
      standard: 'not_legal',
      vintage: 'restricted',
      oldschool: 'legal', // not in the curated list → dropped
    });
    expect(rows.map((r) => r.key)).toEqual(['standard', 'modern', 'vintage', 'commander']);
    expect(rows.map((r) => r.status)).toEqual(['not_legal', 'banned', 'restricted', 'legal']);
  });

  it('treats any unrecognized value as not legal', () => {
    const [row] = legalityRows({ commander: 'who_knows' });
    expect(row.status).toBe('not_legal');
    expect(row.statusLabel).toBe('Not legal');
  });
});
