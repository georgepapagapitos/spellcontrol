import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeSnapshot, type Snapshot, type SnapshotMeta } from './codec';
import { extractCardFacts } from './extract';
import { GOLD } from './gold.fixtures';
import {
  allCardFacts,
  cardFactsMeta,
  getCardFacts,
  getCardFactsByOracleId,
  getRoleFacts,
  hasCardFacts,
  hasRole,
  indexSnapshot,
  loadCardFacts,
  setCardFactsSnapshot,
  strengthOf,
} from './index';
import { CARD_FACTS_VERSION, factsNameKey, type CardFacts } from './schema';

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
  seeds: {},
  universe: 'test',
  cards: GOLD.length,
};
const facts: CardFacts[] = GOLD.map((g) => extractCardFacts(g.card, g.tags));
const snapshot: Snapshot = JSON.parse(JSON.stringify(encodeSnapshot(META, facts)));
const card = (name: string) => GOLD.find((g) => g.card.name === name)!.card;

afterEach(() => {
  setCardFactsSnapshot(null);
  vi.unstubAllGlobals();
});

describe('loadCardFacts', () => {
  it('fetches once, then answers from memory', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(snapshot)));
    vi.stubGlobal('fetch', fetchMock);
    expect(hasCardFacts()).toBe(false);
    const [a, b] = await Promise.all([loadCardFacts(), loadCardFacts()]);
    expect([a, b]).toEqual([true, true]);
    expect(await loadCardFacts()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/card-facts.json');
    expect(cardFactsMeta()).toEqual(META);
  });

  it('resolves false and stays empty when the file is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 }))
    );
    expect(await loadCardFacts()).toBe(false);
    expect(hasCardFacts()).toBe(false);
    expect(getCardFacts('Sol Ring')).toBeUndefined();
    expect(getRoleFacts('Sol Ring')).toEqual([]);
    expect(allCardFacts()).toEqual([]);
    expect(cardFactsMeta()).toBeNull();
  });

  it('ignores a snapshot from another schema version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ ...snapshot, version: CARD_FACTS_VERSION + 1 }))
      )
    );
    expect(await loadCardFacts()).toBe(false);
    expect(hasCardFacts()).toBe(false);
  });

  it('resolves false on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline')))
    );
    expect(await loadCardFacts()).toBe(false);
  });
});

describe('lookups', () => {
  it('finds a card by oracle id first', () => {
    setCardFactsSnapshot(snapshot);
    const sol = card('Sol Ring');
    expect(getCardFactsByOracleId(sol.oracle_id)?.name).toBe('Sol Ring');
    // An oracle id wins over a mismatched name.
    expect(getCardFacts({ name: 'Brainstorm', oracle_id: sol.oracle_id })?.name).toBe('Sol Ring');
    // An unknown id falls back to the name.
    expect(getCardFacts({ name: 'Sol Ring', oracle_id: 'not-an-id' })?.name).toBe('Sol Ring');
  });

  it('keys by front face, case- and accent-folded, never by a back face', () => {
    setCardFactsSnapshot(snapshot);
    expect(getCardFacts('Brainstorm')?.name).toBe('Brainstorm');
    expect(getCardFacts('Harmonized Trio')?.name).toBe('Harmonized Trio // Brainstorm');
    expect(getCardFacts('Harmonized Trio // Brainstorm')?.name).toBe(
      'Harmonized Trio // Brainstorm'
    );
    expect(getCardFacts('FIRE')?.name).toBe('Fire // Ice');
    expect(getCardFacts('Ice')).toBeUndefined();
    expect(getCardFacts('Kodama’s Reach')?.name).toBe("Kodama's Reach");
    expect(factsNameKey('Lim-Dûl’s Vault')).toBe("lim-dul's vault");
  });

  it('prefers the single-faced card when two records share a front-face key', () => {
    const one = facts.find((f) => f.name === 'Brainstorm')!;
    const impostor: CardFacts = {
      ...one,
      oracleId: '00000000-impostor',
      name: 'Brainstorm // Something Else',
    };
    const clash = encodeSnapshot(META, [impostor, one]);
    const index = indexSnapshot(clash);
    expect(clash.cards[index.byName.get('brainstorm')!][1]).toBe('Brainstorm');
    const reversed = indexSnapshot(encodeSnapshot(META, [one, impostor]));
    expect(reversed.snapshot.cards[reversed.byName.get('brainstorm')!][1]).toBe('Brainstorm');
  });

  it('decodes each record once', () => {
    setCardFactsSnapshot(snapshot);
    expect(getCardFacts('Sol Ring')).toBe(getCardFacts('Sol Ring'));
  });

  it('weights role facts by tier and filters to counted ones on request', () => {
    setCardFactsSnapshot(snapshot);
    const liliana = getRoleFacts('Liliana, Dreadhorde General');
    expect(liliana.map((r) => [r.role, r.weight])).toEqual([
      ['cardDraw', 1],
      ['removal', 0.6],
      ['boardwipe', 0.25],
    ]);
    expect(
      getRoleFacts('Liliana, Dreadhorde General', { counted: true }).map((r) => r.role)
    ).toEqual(['cardDraw', 'removal']);
    expect(hasRole('Liliana, Dreadhorde General', 'boardwipe')).toBe(false);
    expect(hasRole('Counterspell', 'removal')).toBe(false);
    expect(hasRole('Counterspell', 'counterspell')).toBe(true);
  });

  it('answers a function strength, 0 when absent', () => {
    setCardFactsSnapshot(snapshot);
    expect(strengthOf('Grave Pact', 'grave-pact')).toBe(1);
    expect(strengthOf('Sol Ring', 'grave-pact')).toBe(0);
    expect(strengthOf('Not A Card', 'ramp')).toBe(0);
  });

  it('decodes the whole snapshot for offline tooling', () => {
    setCardFactsSnapshot(snapshot);
    expect(allCardFacts()).toEqual(facts);
  });
});
