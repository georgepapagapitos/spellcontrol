import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '../types';
import {
  bracketFor,
  buildOrderXml,
  hasPrintedBack,
  parseMpcList,
  planOrder,
  queriesFor,
} from './order';
import twoNameCards from './__fixtures__/scryfall-two-name-cards.json';

const [delver, fireIce] = twoNameCards as unknown as ScryfallCard[];

describe('parseMpcList', () => {
  it('reads Nx and N lines, merges repeats, skips headers', () => {
    expect(parseMpcList('Commander\n1x Sol Ring\n2 Island\r\n1x sol ring\n\n0x Nothing')).toEqual([
      { name: 'Sol Ring', qty: 2 },
      { name: 'Island', qty: 2 },
    ]);
  });
});

describe('hasPrintedBack', () => {
  it('is true for a transform card and false for a split card (real Scryfall data)', () => {
    expect(hasPrintedBack(delver)).toBe(true);
    expect(hasPrintedBack(fireIce)).toBe(false);
    expect(hasPrintedBack(undefined)).toBe(false);
  });
});

describe('planOrder', () => {
  it('splits only a card with a printed back; an unknown two-name card stays one query', () => {
    const plan = planOrder(
      [
        { name: delver.name, qty: 1 },
        { name: fireIce.name, qty: 1 },
        { name: 'Mystery // Card', qty: 1 },
      ],
      (names) =>
        Object.fromEntries(
          [delver, fireIce].filter((c) => names.includes(c.name)).map((c) => [c.name, c])
        )
    );
    expect(plan.map((p) => [p.front, p.back])).toEqual([
      ['delver of secrets', 'insectile aberration'],
      ['fire // ice', undefined],
      ['mystery // card', undefined],
    ]);
    expect(queriesFor(plan[2])).toEqual(['mystery // card', 'mystery', 'card']);
  });
});

describe('bracketFor', () => {
  it('picks the smallest order size that fits', () => {
    expect(bracketFor(1)).toBe(18);
    expect(bracketFor(18)).toBe(18);
    expect(bracketFor(19)).toBe(36);
    expect(bracketFor(100)).toBe(108);
    expect(bracketFor(612)).toBe(612);
  });
});

describe('buildOrderXml', () => {
  it('falls back to the faces of an unknown two-name card, and drops it when a face has no image', () => {
    const images = new Map<string, never>();
    const unknownDfc = (name: string) => planOrder([{ name, qty: 1 }], () => ({}))[0];
    // Real index answers (2026-11-06): no hit for the whole DFC name, one per face.
    const out = buildOrderXml(
      [
        unknownDfc('Delver of Secrets // Insectile Aberration'),
        unknownDfc('Front Only // Nothing'),
      ],
      images,
      new Map([
        ['delver of secrets', 'd'],
        ['insectile aberration', 'i'],
        ['front only', 'f'],
      ]),
      null
    );
    expect(out.slots).toBe(1);
    expect(out.missing).toEqual(['Front Only // Nothing']);
    expect(out.xml).toMatch(
      /<fronts>[\s\S]*<id>d<\/id>[\s\S]*<\/fronts>\s*<backs>[\s\S]*<id>i<\/id>/
    );
  });

  it('escapes names and drops a DFC whose back has no image', () => {
    const images = new Map([
      [
        'a',
        { identifier: 'a', name: 'Rock & Roll <alt>', extension: 'png', searchq: 'rock & roll' },
      ],
    ]);
    const hits = new Map([
      ['rock & roll', 'a'],
      ['front', 'a'],
    ]);
    const out = buildOrderXml(
      [
        { name: 'Rock & Roll', qty: 1, front: 'rock & roll' },
        { name: 'Front // Back', qty: 1, front: 'front', back: 'back' },
      ],
      images,
      hits,
      null
    );
    expect(out.missing).toEqual(['Front // Back']);
    expect(out.slots).toBe(1);
    expect(out.xml).toContain('<name>Rock &amp; Roll &lt;alt&gt;.png</name>');
    expect(out.xml).not.toContain('<backs>');
    expect(out.xml).not.toContain('<cardback>');
  });
});
