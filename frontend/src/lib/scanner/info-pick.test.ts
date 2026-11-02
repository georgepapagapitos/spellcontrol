import { describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  MAX_SAME_ART,
  memoize,
  refinePrinting,
  sameArtPrintings,
  type RefineDeps,
} from './info-pick';
import type { GrayImage } from './info-strip';

vi.mock('@/lib/api', () => ({ fetchPrintings: vi.fn() }));

const gray: GrayImage = { data: new Uint8Array(488 * 680), width: 488, height: 680 };

function printing(id: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id,
    oracle_id: 'o1',
    name: 'Sol Ring',
    type_line: 'Artifact',
    illustration_id: 'ill-1',
    image_uris: { normal: `https://cards.scryfall.io/normal/${id}.jpg` },
    ...over,
  } as unknown as ScryfallCard;
}

const A = printing('a');
const B = printing('b');
const C = printing('c', { illustration_id: 'ill-2' });

function deps(printings: ScryfallCard[]): RefineDeps {
  return {
    fetchPrintings: vi.fn().mockResolvedValue(printings),
    loadGray: vi.fn().mockResolvedValue(gray),
  };
}

describe('sameArtPrintings', () => {
  it('keeps only printings that share the illustration', () => {
    expect(sameArtPrintings(A, [A, B, C]).map((p) => p.id)).toEqual(['a', 'b']);
  });
  it('adds the matched card when the list lacks it', () => {
    expect(sameArtPrintings(A, [B]).map((p) => p.id)).toEqual(['b', 'a']);
  });
  it('is empty with no other printing, no illustration id, a basic land, or a crowd', () => {
    expect(sameArtPrintings(A, [A, C])).toEqual([]);
    expect(sameArtPrintings(printing('x', { illustration_id: undefined }), [A, B])).toEqual([]);
    const basic = printing('s', { type_line: 'Basic Land — Swamp' });
    expect(
      sameArtPrintings(basic, [basic, printing('s2', { type_line: 'Basic Land — Swamp' })])
    ).toEqual([]);
    const crowd = Array.from({ length: MAX_SAME_ART + 1 }, (_, i) => printing(`p${i}`));
    expect(sameArtPrintings(crowd[0], crowd)).toEqual([]);
  });
});

describe('refinePrinting', () => {
  it('keeps the matcher card when there is nothing to choose between', async () => {
    const d = deps([A, C]);
    expect(await refinePrinting(A, gray, d)).toBe(A);
    expect(d.loadGray).not.toHaveBeenCalled();
  });

  it('keeps the matcher card when the printings cannot load', async () => {
    const d = deps([]);
    d.fetchPrintings = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await refinePrinting(A, gray, d)).toBe(A);
  });

  it('keeps the matcher card when a reference image cannot load', async () => {
    const d = deps([A, B]);
    d.loadGray = vi.fn().mockRejectedValue(new Error('404'));
    expect(await refinePrinting(A, gray, d)).toBe(A);
  });

  it('keeps the matcher card when the picker abstains (identical references)', async () => {
    expect(await refinePrinting(A, gray, deps([A, B]))).toBe(A);
  });

  it('returns the printing the info band agrees with', async () => {
    const d = deps([A, B]);
    const ref = (n: number): GrayImage => {
      const data = new Uint8Array(488 * 680).fill(20);
      for (let y = 616; y < 640; y++)
        for (let x = 20 + n * 40; x < 60 + n * 40; x++) data[y * 488 + x] = 230;
      return { data, width: 488, height: 680 };
    };
    d.loadGray = vi.fn((url: string) => Promise.resolve(url.includes('/a.') ? ref(0) : ref(1)));
    // The scan shows printing b's band; the matcher had said a.
    expect(await refinePrinting(A, ref(1), d)).toBe(B);
    // And when it shows a's band the matcher's pick stands.
    expect(await refinePrinting(B, ref(0), d)).toBe(A);
  });
});

describe('memoize', () => {
  it('remembers lookups but holds at most max, dropping the least recently used', async () => {
    const fn = vi.fn((k: string) => Promise.resolve(k));
    const m = memoize(fn, 2);
    await m('a');
    await m('b');
    await m('a'); // a is now the most recent
    await m('c'); // evicts b
    expect(fn).toHaveBeenCalledTimes(3);
    await m('a');
    expect(fn).toHaveBeenCalledTimes(3);
    await m('b');
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('forgets a failed lookup so the next call retries', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('ok');
    const m = memoize(fn, 2);
    await expect(m('a')).rejects.toThrow();
    await Promise.resolve();
    expect(await m('a')).toBe('ok');
  });
});
