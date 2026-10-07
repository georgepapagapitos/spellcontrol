import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCard } from './codec';
import { extractCardFacts } from './extract';
import { TEST_CARDS } from './test-cards.fixtures';

// E517: removal that only hits a slice of the board (Plummet's flyers, Hero's
// Demise's legends) read as unrestricted removal, so it ranked beside Murder.
// The oracle text here is the real Scryfall text (test-cards.fixtures.ts).
const facts = (name: string) => extractCardFacts(TEST_CARDS[name], []);
const limitsOf = (name: string) => facts(name).interaction.map((i) => [...i.limits].sort());

describe('object filters narrow a removal spell', () => {
  it('records the filter on the card that carries it', () => {
    expect(limitsOf('Plummet')).toEqual([['trait']]);
    expect(limitsOf("Hero's Demise")).toEqual([['legendary']]);
    expect(limitsOf('Kill Shot')).toEqual([['combat']]);
    expect(limitsOf('Doom Blade')).toEqual([['colour']]);
  });

  it('leaves an unrestricted answer unrestricted', () => {
    expect(limitsOf('Murder')).toEqual([[]]);
  });

  it('reads a filter from the target, not from the rest of the sentence', () => {
    // "permanents with the most votes" and a later "has a +1/+1 counter" are not target filters.
    expect(limitsOf("Council's Judgment")).toEqual([[]]);
    expect(limitsOf('Bring Low')).toEqual([[]]);
  });

  it('keeps the role: a filter narrows the answer, it does not remove it', () => {
    for (const name of ['Plummet', "Hero's Demise"]) {
      expect(facts(name).roles.find((r) => r.role === 'removal')).toMatchObject({
        tier: 'primary',
        sub: 'spot',
      });
    }
  });
});

describe('the shipped snapshot carries the filters', () => {
  // public/card-facts.json is built by scripts/refresh-card-facts.mjs; a snapshot
  // older than the extractor still reads Plummet as unrestricted removal.
  const snapshot = JSON.parse(
    readFileSync(join(__dirname, '../../../../public/card-facts.json'), 'utf8')
  );
  const shipped = (name: string) => {
    const row = snapshot.cards.find((c: string[]) => c[1] === name);
    return decodeCard(snapshot, row).interaction.map((i) => i.limits);
  };

  it('has Plummet and Hero’s Demise narrowed', () => {
    expect(shipped('Plummet')).toEqual([['trait']]);
    expect(shipped("Hero's Demise")).toEqual([['legendary']]);
    expect(shipped('Murder')).toEqual([[]]);
  });
});
