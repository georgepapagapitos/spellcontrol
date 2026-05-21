import { describe, it, expect, afterEach, vi } from 'vitest';
import { getRegion, isEuropean } from './region';

function stubTimeZone(timeZone: string): void {
  vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
    resolvedOptions: () => ({ timeZone }),
  } as unknown as Intl.DateTimeFormat);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getRegion', () => {
  it.each([
    ['America/New_York', 'Americas'],
    ['Europe/London', 'Europe'],
    ['Asia/Tokyo', 'Asia'],
    ['Australia/Sydney', 'Oceania'],
    ['Pacific/Auckland', 'Oceania'],
    ['Africa/Cairo', 'Africa'],
    ['Antarctica/Casey', 'Other'],
  ])('maps %s to %s', (tz, region) => {
    stubTimeZone(tz);
    expect(getRegion()).toBe(region);
  });

  it('falls back to Other when the timezone lookup throws', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('no Intl');
    });
    expect(getRegion()).toBe('Other');
  });
});

describe('isEuropean', () => {
  it('is true only for European timezones', () => {
    stubTimeZone('Europe/Berlin');
    expect(isEuropean()).toBe(true);
  });

  it('is false outside Europe', () => {
    stubTimeZone('America/Chicago');
    expect(isEuropean()).toBe(false);
  });
});
