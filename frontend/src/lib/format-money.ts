/**
 * Shared money formatter (T35/UX-104).
 *
 * One `Intl.NumberFormat`-backed helper replacing the dozen-plus ad-hoc
 * `` `$${x.toFixed(2)}` `` snippets that had drifted across the app
 * (no thousands separators, inconsistent zero/unknown handling, a local
 * currency-aware `fmtMoney` in DeckDisplay, …). Always renders thousands
 * separators (`$12,482.50`), uses the en-US locale so output is stable
 * regardless of device locale (and matches the strings tests assert on).
 */

export interface FormatMoneyOptions {
  /** ISO 4217 currency code. Defaults to USD; EUR is the other code in use. */
  currency?: string;
  /** Round to whole units and drop cents — `$12,482` (hero tallies). */
  wholeDollars?: boolean;
  /** Render exactly-zero as `—` instead of `$0.00` (unknown-price rows). */
  zeroAsDash?: boolean;
}

/**
 * `Intl.NumberFormat` construction is expensive and these run inside
 * virtualized rows, so instances are memoized per currency/fraction combo.
 */
const formatters = new Map<string, Intl.NumberFormat>();

function getFormatter(currency: string, wholeDollars: boolean): Intl.NumberFormat {
  const key = `${currency}|${wholeDollars ? '0' : '2'}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: wholeDollars ? 0 : 2,
      maximumFractionDigits: wholeDollars ? 0 : 2,
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Format a money amount.
 *
 * - `null` / `undefined` / `NaN` → `'—'` (price unknown)
 * - `0` → `'$0.00'`, or `'—'` with `zeroAsDash`
 * - otherwise → `'$1,234.56'` (or `'$1,234'` with `wholeDollars`),
 *   currency symbol per `opts.currency` (default USD).
 */
export function formatMoney(
  value: number | null | undefined,
  opts: FormatMoneyOptions = {}
): string {
  const { currency = 'USD', wholeDollars = false, zeroAsDash = false } = opts;
  if (value == null || Number.isNaN(value)) return '—';
  if (value === 0 && zeroAsDash) return '—';
  return getFormatter(currency, wholeDollars).format(value);
}
