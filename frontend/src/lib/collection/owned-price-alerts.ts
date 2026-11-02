/**
 * Owned-card price alerts (E1102): a spike / dip threshold on cards you hold,
 * evaluated at the same client-side price-refresh tick the want-list target
 * alerts use (`price-alerts.ts`). There is deliberately no server price cron
 * (see `project_price_refresh`): the server keeps no per-user price history
 * and would have to read every user's synced collection to evaluate this, so
 * the check runs on the device, against the before/after pair the refresh
 * already holds.
 *
 * Settings and the latest result are device-local, like the price cache and
 * value-history: never synced. The result is kept so the Home "Waiting on you"
 * row can show it on the next open, not only in the toast at refresh time.
 */
import { create } from 'zustand';

export type AlertDirection = 'up' | 'down' | 'both';

export interface OwnedAlertSettings {
  enabled: boolean;
  direction: AlertDirection;
  /** Smallest move, as a share of the old price, that alerts (25 = 25%). */
  minPercent: number;
  /** Smallest per-copy move, in the display currency, that alerts. */
  minAmount: number;
}

export const PERCENT_CHOICES = [10, 25, 50] as const;
export const AMOUNT_CHOICES = [1, 5, 10] as const;

export const DEFAULT_OWNED_ALERTS: OwnedAlertSettings = {
  enabled: false,
  direction: 'both',
  minPercent: 25,
  minAmount: 1,
};

const SETTINGS_KEY = 'spellcontrol:owned-price-alerts';
const RESULT_KEY = 'spellcontrol:owned-price-alerts-result';
/** A result older than this reads as stale, not news (mirrors PriceMoversCard). */
export const RESULT_FRESH_DAYS = 2;
const MAX_STORED_HITS = 20;

function sanitize(raw: unknown): OwnedAlertSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<OwnedAlertSettings>;
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
  return {
    enabled: r.enabled === true,
    direction: r.direction === 'up' || r.direction === 'down' ? r.direction : 'both',
    minPercent: num(r.minPercent, DEFAULT_OWNED_ALERTS.minPercent),
    minAmount: num(r.minAmount, DEFAULT_OWNED_ALERTS.minAmount),
  };
}

function loadSettings(): OwnedAlertSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? sanitize(JSON.parse(raw)) : { ...DEFAULT_OWNED_ALERTS };
  } catch {
    return { ...DEFAULT_OWNED_ALERTS };
  }
}

interface OwnedAlertState {
  settings: OwnedAlertSettings;
  update: (patch: Partial<OwnedAlertSettings>) => void;
}

export const useOwnedAlertStore = create<OwnedAlertState>((set, get) => ({
  settings: loadSettings(),
  update: (patch) => {
    const settings = sanitize({ ...get().settings, ...patch });
    set({ settings });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* quota / blocked: the choice still holds for this session */
    }
  },
}));

export interface OwnedPriceHit {
  scryfallId: string;
  finish: string;
  name: string;
  setCode: string;
  /** Per-copy price before/after the refresh, in the display currency. */
  before: number;
  after: number;
  copies: number;
}

interface PricedCardLike {
  scryfallId: string;
  finish?: string;
  purchasePrice?: number;
  name: string;
  setCode: string;
}

const keyOf = (c: PricedCardLike) => `${c.scryfallId}:${c.finish ?? 'nonfoil'}`;

/**
 * Pure: every printing+finish you own whose per-copy price moved past the
 * thresholds between two refreshes, biggest total impact first. Both
 * thresholds must be met, so a 40% jump on a $0.10 card stays quiet. Only
 * printings priced on both sides count (a first pricing is new data, not a
 * market move). Uncapped, unlike the movers log, which keeps only the top few.
 */
export function findOwnedPriceAlerts(
  before: readonly PricedCardLike[],
  after: readonly PricedCardLike[],
  settings: OwnedAlertSettings
): OwnedPriceHit[] {
  if (!settings.enabled) return [];
  const prior = new Map<string, number>();
  for (const c of before) {
    if ((c.purchasePrice ?? 0) > 0) prior.set(keyOf(c), c.purchasePrice as number);
  }
  const out = new Map<string, OwnedPriceHit>();
  for (const c of after) {
    const price = c.purchasePrice ?? 0;
    if (price <= 0) continue;
    const key = keyOf(c);
    const existing = out.get(key);
    if (existing) {
      existing.copies += 1;
      continue;
    }
    const was = prior.get(key);
    if (was === undefined) continue;
    const move = price - was;
    if (move === 0) continue;
    if (move > 0 && settings.direction === 'down') continue;
    if (move < 0 && settings.direction === 'up') continue;
    if (Math.abs(move) < settings.minAmount) continue;
    if ((Math.abs(move) / was) * 100 < settings.minPercent) continue;
    out.set(key, {
      scryfallId: c.scryfallId,
      finish: c.finish ?? 'nonfoil',
      name: c.name,
      setCode: c.setCode,
      before: was,
      after: price,
      copies: 1,
    });
  }
  return [...out.values()].sort(
    (a, b) => Math.abs((b.after - b.before) * b.copies) - Math.abs((a.after - a.before) * a.copies)
  );
}

export interface OwnedAlertResult {
  /** Epoch ms of the refresh that produced it. */
  at: number;
  currency: string;
  hits: OwnedPriceHit[];
}

/** Keep the latest non-empty result for the Home row. An empty refresh (a
 *  second manual refresh the same day moves nothing) never clears it. */
export function saveOwnedAlertResult(hits: OwnedPriceHit[], currency: string, at: number): void {
  if (hits.length === 0) return;
  const result: OwnedAlertResult = { at, currency, hits: hits.slice(0, MAX_STORED_HITS) };
  try {
    localStorage.setItem(RESULT_KEY, JSON.stringify(result));
  } catch {
    /* the toast already told them; the Home row is the second chance */
  }
}

/** The stored result, or null when absent, malformed, in another currency or stale. */
export function readOwnedAlertResult(currency: string, now: number): OwnedAlertResult | null {
  try {
    const raw = localStorage.getItem(RESULT_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as OwnedAlertResult;
    if (!r || !Array.isArray(r.hits) || r.hits.length === 0 || typeof r.at !== 'number')
      return null;
    if (r.currency !== currency) return null;
    if (now - r.at > RESULT_FRESH_DAYS * 86_400_000) return null;
    return r;
  } catch {
    return null;
  }
}

/** Test-only: drop the device-local settings and result. */
export function _resetOwnedAlertsForTests(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(RESULT_KEY);
  } catch {
    /* ignore */
  }
  useOwnedAlertStore.setState({ settings: { ...DEFAULT_OWNED_ALERTS } });
}
