import { describe, expect, it } from 'vitest';
import { decodeCard, encodeSnapshot, VOCAB, type SnapshotMeta } from './codec';
import { extractCardFacts } from './extract';
import { GOLD } from './gold.fixtures';
import { HOLDOUT } from './gold.holdout.fixtures';
import { TEST_CARDS } from './test-cards.fixtures';
import { CARD_FACTS_VERSION, type CardFacts } from './schema';

const META: SnapshotMeta = {
  generatedAt: '2026-09-29T09:01:56.000Z',
  sources: {
    scryfallOracleCards: {
      updatedAt: '2026-09-29T09:01:56.000Z',
      file: 'oracle-cards-20260929090156.jsonl.gz',
    },
    taggerTags: { generatedAt: '2026-09-01T22:03:33.453Z' },
  },
  extractor: { version: CARD_FACTS_VERSION, name: 'cardFacts/extract.ts' },
  llm: null,
  seeds: { bootstrap: 512 },
  universe: 'test',
  cards: 0,
};

const all: CardFacts[] = [
  ...[...GOLD, ...HOLDOUT].map((g) => extractCardFacts(g.card, g.tags)),
  ...Object.values(TEST_CARDS).map((c) => extractCardFacts(c)),
];

describe('card facts codec', () => {
  it('round-trips every fixture card exactly', () => {
    const snapshot = encodeSnapshot(META, all);
    snapshot.cards.forEach((c, i) => expect(decodeCard(snapshot, c)).toEqual(all[i]));
  });

  it('survives JSON serialization (what the app actually fetches)', () => {
    const snapshot = JSON.parse(JSON.stringify(encodeSnapshot(META, all)));
    snapshot.cards.forEach((c: [string, string, string], i: number) =>
      expect(decodeCard(snapshot, c)).toEqual(all[i])
    );
  });

  it('keeps the oracle id and full name outside the packed body', () => {
    const snapshot = encodeSnapshot(META, all.slice(0, 3));
    expect(snapshot.cards[0][0]).toBe(all[0].oracleId);
    expect(snapshot.cards[0][1]).toBe(all[0].name);
    expect(snapshot.version).toBe(CARD_FACTS_VERSION);
    expect(snapshot.meta).toEqual(META);
  });

  it("decodes with the vocabulary the file carries, not the code's", () => {
    expect(encodeSnapshot(META, all).vocab).toEqual(VOCAB);
    // A file written by a build whose vocabularies were ordered differently
    // (every list reversed) still decodes to the same records.
    const reversed = Object.fromEntries(
      Object.entries(VOCAB).map(([k, list]) => [k, [...list].reverse()])
    ) as unknown as typeof VOCAB;
    const snapshot = JSON.parse(JSON.stringify(encodeSnapshot(META, all, reversed)));
    expect(snapshot.vocab).toEqual(reversed);
    snapshot.cards.forEach((c: [string, string, string], i: number) =>
      expect(decodeCard(snapshot, c)).toEqual(all[i])
    );
  });

  it('refuses a value that is not in its vocabulary', () => {
    const bad = { ...all[0], roles: [{ ...all[0].roles[0], role: 'nonsense' as never }] };
    expect(() => encodeSnapshot(META, [bad])).toThrow(/not in its vocabulary/);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(encodeSnapshot(META, all))).toBe(
      JSON.stringify(encodeSnapshot(META, all))
    );
  });
});
