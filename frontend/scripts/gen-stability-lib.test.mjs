// Pins the churn arithmetic of gen-stability-lib.mjs on a hand-built pair of dumps.
import { describe, expect, it } from 'vitest';
import {
  deckChurn,
  finalNames,
  marginRead,
  preLateNames,
  searchDivergence,
  stapleLosses,
} from './gen-stability-lib.mjs';

const card = (name, incl) => ({ name, edhrec_inclusion: incl });
const dump = (names, report = {}, extra = {}) => ({
  decklist: { creatures: names.map(([n, i]) => card(n, i)) },
  buildReport: report,
  ...extra,
});

const ref = dump(
  [
    ['Mana Drain', 60],
    ['Sol Ring', 90],
    ['Filler', 5],
  ],
  { wholeDeckSearchSwaps: [{ cut: 'Old', added: 'Mana Drain' }] }
);
const run = dump(
  [
    ['Sol Ring', 90],
    ['Filler', 5],
    ['Anticipate', 36],
  ],
  { surplusConversions: [{ cut: 'Mana Drain', added: 'Anticipate' }] }
);

describe('deckChurn', () => {
  it('counts the cards that left, the staples among them, and names the pass', () => {
    const c = deckChurn(ref, run);
    expect(c.changed).toBe(1);
    expect(c.dropped).toEqual([{ name: 'Mana Drain', incl: 60, why: 'surplus cut it' }]);
    expect(c.gained).toEqual([{ name: 'Anticipate', incl: 36, why: 'surplus added it' }]);
    expect(c.staplesLost.map((s) => s.name)).toEqual(['Mana Drain']);
  });

  it('reads an identical rerun as zero churn', () => {
    const c = deckChurn(ref, ref);
    expect(c.changed).toBe(0);
    expect(c.staplesLost).toEqual([]);
  });

  it('says earlier when no late pass touched the card', () => {
    const a = dump([
      ['A', 50],
      ['B', 50],
    ]);
    const b = dump([
      ['A', 50],
      ['C', 50],
    ]);
    const c = deckChurn(a, b);
    expect(c.dropped[0].why).toBe('earlier');
    expect(c.gained[0].why).toBe('earlier');
    expect(c.preLateChanged).toBe(1);
  });
});

describe('late-pass reads', () => {
  it('undoes the passes last first to get the deck before them', () => {
    expect([...preLateNames(ref)].sort()).toEqual(['Filler', 'Old', 'Sol Ring']);
  });

  it('flags a late cut of a 40%+ card for a less-played one', () => {
    const d = dump(
      [['Anticipate', 36]],
      { surplusConversions: [{ cut: 'Mana Drain', added: 'Anticipate' }] },
      {
        swapInclusion: { 'Mana Drain': 60 },
      }
    );
    expect(stapleLosses(d).map((s) => s.cut)).toEqual(['Mana Drain']);
    expect([...finalNames(d)]).toEqual(['Anticipate']);
  });

  it('counts search swaps near MIN_GAIN', () => {
    const d = dump(
      [],
      {},
      {
        searchTrace: {
          swaps: [
            { kind: 'improve', delta: 0.35 },
            { kind: 'improve', delta: 1.4 },
          ],
          undone: [],
          stoppedBy: 'local-optimum',
        },
      }
    );
    expect(marginRead(d).nearMargin).toBe(1);
    expect(marginRead(dump([]))).toBeNull();
  });
});

describe('searchDivergence', () => {
  const trace = (swaps) => ({ searchTrace: { swaps, stoppedBy: 'max-swaps' }, decklist: {} });
  const sw = (out, inn) => ({ out: [out], in: [inn], kind: 'improve', delta: 1 });
  it('finds the first swap where two searches part', () => {
    const a = trace([sw('A', 'B'), sw('C', 'D')]);
    const b = trace([sw('A', 'B'), sw('C', 'E')]);
    expect(searchDivergence(a, b)).toMatchObject({
      both: 1,
      firstDivergence: 1,
      refOnly: ['C>D'],
      runOnly: ['C>E'],
    });
    expect(searchDivergence(a, { decklist: {} })).toBeNull();
  });
});
