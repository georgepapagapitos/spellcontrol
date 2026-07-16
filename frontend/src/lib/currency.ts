import { create } from 'zustand';
import { isEuropean } from '@/deck-builder/lib/region';

/**
 * App-wide display currency (USD ⇄ EUR), device-local like the theme.
 *
 * Prices are device-local reference data (see `card-prices.ts`), so this
 * setting never syncs either — two devices on one account can legitimately
 * show different currencies. The deck builder had its own currency preference
 * before this existed (`mtg-deck-builder-currency`, timezone-defaulted); that
 * key is read as a migration fallback so existing EUR users keep their choice,
 * and the deck-builder store now mirrors this store (see its subscribe).
 */

export type Currency = 'USD' | 'EUR';

const LS_KEY = 'spellcontrol:currency';
/** Pre-global deck-builder key, read once as a migration fallback. */
const LEGACY_KEY = 'mtg-deck-builder-currency';

function loadCurrency(): Currency {
  try {
    const stored = localStorage.getItem(LS_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (stored === 'USD' || stored === 'EUR') return stored;
  } catch {
    /* node test env / blocked storage */
  }
  return isEuropean() ? 'EUR' : 'USD';
}

interface CurrencyState {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
}

export const useCurrencyStore = create<CurrencyState>((set) => ({
  currency: loadCurrency(),
  setCurrency: (currency) => {
    set({ currency });
    try {
      localStorage.setItem(LS_KEY, currency);
    } catch {
      /* ignore */
    }
  },
}));

/** Current currency for non-React code (formatters, price stamping). */
export function getCurrency(): Currency {
  return useCurrencyStore.getState().currency;
}

/** Reactive currency for components. */
export function useCurrency(): Currency {
  return useCurrencyStore((s) => s.currency);
}

/** Bare symbol for compact labels ("€5–20" filter chips) where the full
 *  formatMoney rendering ("€5.00–€20.00") is too heavy. */
export function currencySymbol(currency: Currency = getCurrency()): string {
  return currency === 'EUR' ? '€' : '$';
}
