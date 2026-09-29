// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currencySymbol, getCurrency, useCurrencyStore } from './currency';

beforeEach(() => {
  localStorage.clear();
  useCurrencyStore.getState().setCurrency('USD');
  localStorage.clear();
});

afterEach(() => {
  vi.resetModules();
});

describe('currency store', () => {
  it('setCurrency updates state and persists to localStorage', () => {
    useCurrencyStore.getState().setCurrency('EUR');
    expect(getCurrency()).toBe('EUR');
    expect(localStorage.getItem('spellcontrol:currency')).toBe('EUR');
  });

  it('boots from the persisted key', async () => {
    localStorage.setItem('spellcontrol:currency', 'EUR');
    vi.resetModules();
    const fresh = await import('./currency');
    expect(fresh.getCurrency()).toBe('EUR');
  });

  it('migrates the legacy deck-builder key when the new key is absent', async () => {
    localStorage.setItem('mtg-deck-builder-currency', 'EUR');
    vi.resetModules();
    const fresh = await import('./currency');
    expect(fresh.getCurrency()).toBe('EUR');
  });

  it('the new key wins over the legacy key', async () => {
    localStorage.setItem('spellcontrol:currency', 'USD');
    localStorage.setItem('mtg-deck-builder-currency', 'EUR');
    vi.resetModules();
    const fresh = await import('./currency');
    expect(fresh.getCurrency()).toBe('USD');
  });

  it('ignores a garbage stored value', async () => {
    localStorage.setItem('spellcontrol:currency', 'GBP');
    vi.resetModules();
    const fresh = await import('./currency');
    expect(['USD', 'EUR']).toContain(fresh.getCurrency()); // falls back to region default
  });
});

describe('region-based default (no stored preference)', () => {
  function stubTimeZone(timeZone: string | undefined): void {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone }),
    } as unknown as Intl.DateTimeFormat);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to EUR for a Europe timezone', async () => {
    stubTimeZone('Europe/Berlin');
    vi.resetModules();
    const fresh = await import('./currency');
    expect(fresh.getCurrency()).toBe('EUR');
  });

  it('defaults to USD for an Americas timezone', async () => {
    stubTimeZone('America/New_York');
    vi.resetModules();
    const fresh = await import('./currency');
    expect(fresh.getCurrency()).toBe('USD');
  });

  it('defaults to USD when the timezone is unrecognized or undefined', async () => {
    stubTimeZone(undefined);
    vi.resetModules();
    const fresh = await import('./currency');
    expect(fresh.getCurrency()).toBe('USD');
  });

  it('an explicit stored preference beats the region default', async () => {
    stubTimeZone('Europe/Berlin'); // would default to EUR
    localStorage.setItem('spellcontrol:currency', 'USD');
    vi.resetModules();
    const fresh = await import('./currency');
    expect(fresh.getCurrency()).toBe('USD');
  });
});

describe('currencySymbol', () => {
  it('maps the code to its symbol, defaulting to the active currency', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('EUR')).toBe('€');
    useCurrencyStore.getState().setCurrency('EUR');
    expect(currencySymbol()).toBe('€');
  });
});
