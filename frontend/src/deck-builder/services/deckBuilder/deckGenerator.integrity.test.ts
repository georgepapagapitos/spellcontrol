// S1 (generation integrity): deck generation has no RNG, yet a transient
// network blip silently disabling a whole subsystem (tagger role data,
// combo data, the substitute-ranking index) makes a build LOOK random. These
// are pure-function tests against the small pieces deckGenerator.ts exports
// for this: `retryOnce` (the shared one-retry helper) and the three
// `build*IntegrityNote` composers that decide whether a disclosure fires.
// No network, no full generateDeck orchestration — that's covered by
// deckGenerator.golden.test.ts.
import { describe, it, expect, vi } from 'vitest';
import {
  retryOnce,
  buildTaggerIntegrityNote,
  buildComboIntegrityNote,
  buildSubstituteIntegrityNote,
} from './deckGenerator';

describe('retryOnce', () => {
  it('calls fn once and returns its result when it succeeds (no isOk check)', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(retryOnce(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries exactly once when fn throws, and returns the retry result', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce('recovered');
    await expect(retryOnce(fn)).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('propagates the rejection when both attempts throw', async () => {
    const fn = vi.fn(async () => {
      throw new Error('down');
    });
    await expect(retryOnce(fn)).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries once when the first result fails the isOk check, even without throwing', async () => {
    const fn = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('data');
    const result = await retryOnce(fn, (v) => v !== null);
    expect(result).toBe('data');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the first result already passes isOk', async () => {
    const fn = vi.fn(async () => 'data');
    const result = await retryOnce(fn, (v) => v !== null);
    expect(result).toBe('data');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns the second attempt even if it also fails isOk (no infinite retry loop)', async () => {
    const fn = vi.fn(async () => null as string | null);
    const result = await retryOnce(fn, (v) => v !== null);
    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('buildTaggerIntegrityNote', () => {
  it('fires when tagger data is unavailable', () => {
    const note = buildTaggerIntegrityNote(false);
    expect(note).toContain("Card-role data couldn't be loaded");
    expect(note).toContain('Regenerate to retry');
  });

  it('is absent when tagger data loaded fine', () => {
    expect(buildTaggerIntegrityNote(true)).toBeUndefined();
  });
});

describe('buildComboIntegrityNote', () => {
  it('fires only when the fetch genuinely failed AND combo seeding was requested', () => {
    const note = buildComboIntegrityNote(true, 2);
    expect(note).toContain("Combo data couldn't be loaded");
  });

  it('is absent when the fetch failed but the user asked for no combo seeding', () => {
    expect(buildComboIntegrityNote(true, 0)).toBeUndefined();
  });

  it('is absent when the fetch succeeded, even with an empty combo list (a real, valid result)', () => {
    expect(buildComboIntegrityNote(false, 2)).toBeUndefined();
  });
});

describe('buildSubstituteIntegrityNote', () => {
  it('fires only when the index is unavailable AND the build is collection-constrained', () => {
    const note = buildSubstituteIntegrityNote(false, true);
    expect(note).toContain("substitute-ranking index couldn't be loaded");
    expect(note).toContain('built-in heuristic');
  });

  it('is absent when the index is unavailable but the build is not collection-constrained', () => {
    expect(buildSubstituteIntegrityNote(false, false)).toBeUndefined();
  });

  it('is absent when the index loaded fine, even in collection mode', () => {
    expect(buildSubstituteIntegrityNote(true, true)).toBeUndefined();
  });
});
