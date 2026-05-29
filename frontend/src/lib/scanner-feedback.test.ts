// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

const { hapticsMock } = vi.hoisted(() => ({
  hapticsMock: {
    tap: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    lethal: vi.fn(),
    eliminate: vi.fn(),
  },
}));
vi.mock('./haptics', () => ({ haptics: hapticsMock }));

import {
  FINISH_LABELS,
  availableFinishes,
  finishUnitPrice,
  nextFinish,
  priceTier,
  pulseValueHaptic,
} from './scanner-feedback';

function card(prices: Partial<ScryfallCard['prices']>): Pick<ScryfallCard, 'prices'> {
  return { prices: { ...prices } as ScryfallCard['prices'] };
}

describe('priceTier', () => {
  it('falls back to tier 0 for missing / non-numeric prices', () => {
    expect(priceTier(null)).toBe(0);
    expect(priceTier(undefined)).toBe(0);
    expect(priceTier(card({}))).toBe(0);
    expect(priceTier(card({ usd: null }))).toBe(0);
    expect(priceTier(card({ usd: 'oops' }))).toBe(0);
  });

  it('buckets by USD price', () => {
    expect(priceTier(card({ usd: '0.10' }))).toBe(0);
    expect(priceTier(card({ usd: '0.99' }))).toBe(0);
    expect(priceTier(card({ usd: '1.00' }))).toBe(1);
    expect(priceTier(card({ usd: '4.99' }))).toBe(1);
    expect(priceTier(card({ usd: '5.00' }))).toBe(2);
    expect(priceTier(card({ usd: '19.99' }))).toBe(2);
    expect(priceTier(card({ usd: '20.00' }))).toBe(3);
    expect(priceTier(card({ usd: '250.00' }))).toBe(3);
  });

  it('falls through to usd_foil and usd_etched when usd is missing', () => {
    expect(priceTier(card({ usd_foil: '8.00' }))).toBe(2);
    expect(priceTier(card({ usd_etched: '25.00' }))).toBe(3);
  });

  it('prefers usd over fallback fields', () => {
    expect(priceTier(card({ usd: '0.50', usd_foil: '100.00' }))).toBe(0);
  });
});

describe('availableFinishes', () => {
  it('returns only the tracked finishes the printing offers, in display order', () => {
    expect(availableFinishes(['foil', 'nonfoil'])).toEqual(['nonfoil', 'foil']);
    expect(availableFinishes(['nonfoil', 'etched'])).toEqual(['nonfoil', 'etched']);
    expect(availableFinishes(['nonfoil', 'foil', 'etched'])).toEqual(['nonfoil', 'foil', 'etched']);
  });

  it('falls back to [nonfoil] for missing / empty / unknown finishes', () => {
    expect(availableFinishes(undefined)).toEqual(['nonfoil']);
    expect(availableFinishes(null)).toEqual(['nonfoil']);
    expect(availableFinishes([])).toEqual(['nonfoil']);
    expect(availableFinishes(['glitterfoil'])).toEqual(['nonfoil']);
  });
});

describe('nextFinish', () => {
  it('cycles through the available finishes and wraps', () => {
    const avail = ['nonfoil', 'foil', 'etched'] as const;
    expect(nextFinish('nonfoil', [...avail])).toBe('foil');
    expect(nextFinish('foil', [...avail])).toBe('etched');
    expect(nextFinish('etched', [...avail])).toBe('nonfoil');
  });

  it('is a no-op when only one finish is available', () => {
    expect(nextFinish('nonfoil', ['nonfoil'])).toBe('nonfoil');
  });

  it('has a human label for every finish', () => {
    expect(FINISH_LABELS.nonfoil).toBe('Normal');
    expect(FINISH_LABELS.foil).toBe('Foil');
    expect(FINISH_LABELS.etched).toBe('Etched');
  });
});

describe('finishUnitPrice', () => {
  it('returns the finish-specific price when present', () => {
    const prices = { usd: '1.00', usd_foil: '6.00', usd_etched: '9.00' } as ScryfallCard['prices'];
    expect(finishUnitPrice(prices, 'nonfoil')).toBeCloseTo(1.0);
    expect(finishUnitPrice(prices, 'foil')).toBeCloseTo(6.0);
    expect(finishUnitPrice(prices, 'etched')).toBeCloseTo(9.0);
  });

  it('falls back across finishes when the preferred one is missing', () => {
    expect(finishUnitPrice({ usd: '2.00' } as ScryfallCard['prices'], 'foil')).toBeCloseTo(2.0);
    expect(finishUnitPrice({ usd_foil: '5.00' } as ScryfallCard['prices'], 'etched')).toBeCloseTo(
      5.0
    );
  });

  it('returns null when no usable price exists', () => {
    expect(finishUnitPrice(null, 'nonfoil')).toBeNull();
    expect(finishUnitPrice(undefined, 'foil')).toBeNull();
    expect(finishUnitPrice({} as ScryfallCard['prices'], 'nonfoil')).toBeNull();
    expect(finishUnitPrice({ usd: 'oops' } as ScryfallCard['prices'], 'nonfoil')).toBeNull();
  });
});

describe('pulseValueHaptic', () => {
  beforeEach(() => {
    hapticsMock.tap.mockClear();
    hapticsMock.success.mockClear();
    hapticsMock.lethal.mockClear();
  });

  it('plays the lightest tap for tier 0', () => {
    pulseValueHaptic(0);
    expect(hapticsMock.tap).toHaveBeenCalledTimes(1);
    expect(hapticsMock.success).not.toHaveBeenCalled();
    expect(hapticsMock.lethal).not.toHaveBeenCalled();
  });

  it('plays the success notification for tiers 1 and 2', () => {
    pulseValueHaptic(1);
    expect(hapticsMock.success).toHaveBeenCalledTimes(1);
    pulseValueHaptic(2);
    expect(hapticsMock.success).toHaveBeenCalledTimes(2);
    expect(hapticsMock.lethal).not.toHaveBeenCalled();
  });

  it('plays the heavy impact for tier 3 (jackpot)', () => {
    pulseValueHaptic(3);
    expect(hapticsMock.lethal).toHaveBeenCalledTimes(1);
    expect(hapticsMock.tap).not.toHaveBeenCalled();
  });
});

/**
 * playValueChime synthesises a WebAudio flourish. We only verify here
 * that each tier wires up *at least one* oscillator → gain → destination
 * chain — the exact note choices are tuning, not contract. A no-op
 * AudioContext stand-in keeps the test pure; missing/broken WebAudio
 * (older test environments) is also exercised to confirm we no-op
 * silently.
 */
describe('playValueChime', () => {
  let originalAudioCtx: typeof window.AudioContext | undefined;
  let oscillatorCount: number;

  function installFakeAudio() {
    oscillatorCount = 0;
    const oscFactory = () => {
      oscillatorCount += 1;
      return {
        type: 'sine',
        frequency: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
    };
    const gainFactory = () => ({
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    });
    class FakeCtx {
      currentTime = 0;
      destination = {};
      createOscillator = oscFactory;
      createGain = gainFactory;
    }
    (window as unknown as { AudioContext: typeof window.AudioContext }).AudioContext =
      FakeCtx as unknown as typeof window.AudioContext;
  }

  beforeEach(() => {
    originalAudioCtx = (window as unknown as { AudioContext?: typeof window.AudioContext })
      .AudioContext;
    // Force a fresh module so the cached audioCtx singleton is rebuilt
    // against the freshly-installed fake.
    vi.resetModules();
  });

  afterEach(() => {
    if (originalAudioCtx) {
      (window as unknown as { AudioContext: typeof window.AudioContext }).AudioContext =
        originalAudioCtx;
    }
  });

  it('plays a single-note ding for tier 0', async () => {
    installFakeAudio();
    const { playValueChime: fresh } = await import('./scanner-feedback');
    fresh(0);
    expect(oscillatorCount).toBe(1);
  });

  it('layers more oscillators as the tier escalates', async () => {
    installFakeAudio();
    const { playValueChime: fresh } = await import('./scanner-feedback');
    fresh(1);
    const tier1 = oscillatorCount;
    fresh(2);
    const tier2 = oscillatorCount - tier1;
    fresh(3);
    const tier3 = oscillatorCount - tier1 - tier2;
    expect(tier1).toBeGreaterThanOrEqual(2);
    expect(tier2).toBeGreaterThan(tier1);
    expect(tier3).toBeGreaterThan(tier2);
  });

  it('no-ops silently when WebAudio is unavailable', async () => {
    (window as unknown as { AudioContext?: typeof window.AudioContext }).AudioContext =
      undefined as unknown as typeof window.AudioContext;
    const { playValueChime: fresh } = await import('./scanner-feedback');
    expect(() => fresh(3)).not.toThrow();
  });

  it('no-ops silently when AudioContext construction throws', async () => {
    class ThrowingCtx {
      constructor() {
        throw new Error('blocked by autoplay policy');
      }
    }
    (window as unknown as { AudioContext: typeof window.AudioContext }).AudioContext =
      ThrowingCtx as unknown as typeof window.AudioContext;
    const { playValueChime: fresh } = await import('./scanner-feedback');
    expect(() => fresh(2)).not.toThrow();
  });
});
