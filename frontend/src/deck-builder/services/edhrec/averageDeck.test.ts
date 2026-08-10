import { describe, expect, it } from 'vitest';
import { parseAverageDeckQuantities } from './client';

/**
 * The grouped fixture mirrors the live payload for
 * `json.edhrec.com/pages/average-decks/krenko-mob-boss.json` (captured
 * 2026-08-10): `deck` is an OBJECT with `commander` + `cards`, where `cards`
 * is keyed by type line and each row is `[name, qty]`.
 *
 * The old parser expected the flat `["1 Sol Ring"]` array and did
 * `Array.isArray(data.deck)`, so it returned null for every commander once
 * EDHREC switched — silently, because `multiCopy.ts` treats null as "endpoint
 * unreachable" and falls back to a blunt copy count.
 */
describe('parseAverageDeckQuantities', () => {
  it('parses the live grouped shape', () => {
    const payload = {
      deck: {
        commander: ['Krenko, Mob Boss'],
        cards: {
          Artifact: [
            ['Arcane Signet', 1],
            ['Sol Ring', 1],
          ],
          Creature: [['Persistent Petitioners', 24]],
        },
      },
    };
    expect(parseAverageDeckQuantities(payload)).toEqual([
      ['Arcane Signet', 1],
      ['Sol Ring', 1],
      ['Persistent Petitioners', 24],
    ]);
  });

  it('still parses the legacy flat shape', () => {
    const payload = { deck: ['1 Sol Ring', '20 Slime Against Humanity'] };
    expect(parseAverageDeckQuantities(payload)).toEqual([
      ['Sol Ring', 1],
      ['Slime Against Humanity', 20],
    ]);
  });

  it('returns null — not an empty list — for an unknown shape', () => {
    // The distinction is load-bearing: multiCopy.ts reads null as "fetch
    // failed" (blunt fallback) and [] as "no multi-copy cards" (skip).
    expect(parseAverageDeckQuantities({ deck: 42 })).toBeNull();
    expect(parseAverageDeckQuantities({})).toBeNull();
    expect(parseAverageDeckQuantities(null)).toBeNull();
  });

  it('skips malformed rows without dropping the rest of the group', () => {
    const payload = {
      deck: {
        cards: {
          Land: [['Mountain', 34], ['not-a-row'], [null, 3], ['Wastes', '2']],
        },
      },
    };
    expect(parseAverageDeckQuantities(payload)).toEqual([['Mountain', 34]]);
  });

  it('reads an empty grouped payload as "no cards", not as a failure', () => {
    expect(parseAverageDeckQuantities({ deck: { cards: {} } })).toEqual([]);
  });
});
