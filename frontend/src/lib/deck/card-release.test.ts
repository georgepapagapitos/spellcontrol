import { describe, it, expect } from 'vitest';
import {
  isPreviewOnlyIllegal,
  readsFormatLegal,
  upcomingReleaseDate,
  localIsoDate,
} from './card-release';

// Temporal Tribulation (Star Trek Commander, TRC #51) as Scryfall served it on
// 2026-11-06, a week before the set released on 2026-11-13: not_legal in every
// format until then.
const temporalTribulation = {
  released_at: '2026-11-13',
  legalities: { commander: 'not_legal', legacy: 'not_legal', standard: 'not_legal' },
};
const before = new Date(2026, 10, 6);
const releaseDay = new Date(2026, 10, 13);

describe('card release', () => {
  it('writes the local calendar date the way Scryfall does', () => {
    expect(localIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('names the release date only while it is in the future', () => {
    expect(upcomingReleaseDate(temporalTribulation, before)).toBe('2026-11-13');
    expect(upcomingReleaseDate(temporalTribulation, releaseDay)).toBeNull();
    expect(upcomingReleaseDate({}, before)).toBeNull();
  });

  it('reads a preview card as legal-on-release in formats that take every set', () => {
    expect(isPreviewOnlyIllegal(temporalTribulation, 'commander', before)).toBe(true);
    expect(isPreviewOnlyIllegal(temporalTribulation, 'legacy', before)).toBe(true);
  });

  it('keeps the flag where release does not make it legal', () => {
    // A commander product never reaches Standard.
    expect(isPreviewOnlyIllegal(temporalTribulation, 'standard', before)).toBe(false);
    // Released and still not legal: a real verdict.
    expect(isPreviewOnlyIllegal(temporalTribulation, 'commander', releaseDay)).toBe(false);
    // Banned is never a preview.
    expect(
      isPreviewOnlyIllegal(
        { released_at: '2026-11-13', legalities: { commander: 'banned' } },
        'commander',
        before
      )
    ).toBe(false);
  });
});

describe('readsFormatLegal', () => {
  it('passes legal, restricted, unknown and preview-only cards', () => {
    expect(readsFormatLegal({ legalities: { vintage: 'restricted' } }, 'vintage')).toBe(true);
    expect(readsFormatLegal({}, 'commander')).toBe(true);
    expect(readsFormatLegal(temporalTribulation, 'commander', before)).toBe(true);
  });

  it('hides banned and released not-legal cards', () => {
    expect(readsFormatLegal({ legalities: { commander: 'banned' } }, 'commander')).toBe(false);
    expect(readsFormatLegal(temporalTribulation, 'commander', releaseDay)).toBe(false);
  });
});
