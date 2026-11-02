// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OWNED_ALERTS,
  RESULT_FRESH_DAYS,
  _resetOwnedAlertsForTests,
  findOwnedPriceAlerts,
  readOwnedAlertResult,
  saveOwnedAlertResult,
  useOwnedAlertStore,
  type OwnedAlertSettings,
} from './owned-price-alerts';

const on: OwnedAlertSettings = { ...DEFAULT_OWNED_ALERTS, enabled: true };
const card = (scryfallId: string, purchasePrice: number, finish = 'nonfoil') => ({
  scryfallId,
  finish,
  purchasePrice,
  name: `Card ${scryfallId}`,
  setCode: 'tst',
});

describe('findOwnedPriceAlerts', () => {
  it('is silent while the alerts are off', () => {
    expect(findOwnedPriceAlerts([card('a', 10)], [card('a', 20)], DEFAULT_OWNED_ALERTS)).toEqual(
      []
    );
  });

  it('reports a spike and a dip past both limits', () => {
    const hits = findOwnedPriceAlerts(
      [card('a', 10), card('b', 20)],
      [card('a', 15), card('b', 10)],
      on
    );
    expect(hits.map((h) => h.scryfallId)).toEqual(['b', 'a']);
    expect(hits[1]).toMatchObject({ before: 10, after: 15, copies: 1 });
  });

  it('needs the percent AND the per-copy amount', () => {
    // +60% but only $0.30; +10% on $50 is $5 but under 25%.
    expect(
      findOwnedPriceAlerts([card('a', 0.5), card('b', 50)], [card('a', 0.8), card('b', 55)], on)
    ).toEqual([]);
  });

  it('honors the direction', () => {
    const before = [card('a', 10), card('b', 20)];
    const after = [card('a', 20), card('b', 10)];
    expect(
      findOwnedPriceAlerts(before, after, { ...on, direction: 'up' }).map((h) => h.scryfallId)
    ).toEqual(['a']);
    expect(
      findOwnedPriceAlerts(before, after, { ...on, direction: 'down' }).map((h) => h.scryfallId)
    ).toEqual(['b']);
  });

  it('counts copies and ignores a first pricing', () => {
    const hits = findOwnedPriceAlerts(
      [card('a', 10), card('a', 10), card('n', 0)],
      [card('a', 20), card('a', 20), card('n', 30)],
      on
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].copies).toBe(2);
  });

  it('keeps foil and nonfoil apart', () => {
    const hits = findOwnedPriceAlerts([card('a', 10, 'foil')], [card('a', 20, 'nonfoil')], on);
    expect(hits).toEqual([]);
  });
});

describe('settings and result storage', () => {
  beforeEach(() => _resetOwnedAlertsForTests());

  it('persists settings and repairs junk', () => {
    useOwnedAlertStore.getState().update({ enabled: true, minPercent: 50 });
    expect(JSON.parse(localStorage.getItem('spellcontrol:owned-price-alerts')!)).toMatchObject({
      enabled: true,
      minPercent: 50,
    });
    useOwnedAlertStore.getState().update({ minAmount: -3, direction: 'sideways' as never });
    expect(useOwnedAlertStore.getState().settings).toMatchObject({
      minAmount: DEFAULT_OWNED_ALERTS.minAmount,
      direction: 'both',
    });
  });

  it('serves a fresh same-currency result, drops stale or foreign ones, and an empty save keeps it', () => {
    const hit = {
      scryfallId: 'a',
      finish: 'nonfoil',
      name: 'A',
      setCode: 't',
      before: 1,
      after: 9,
      copies: 1,
    };
    saveOwnedAlertResult([hit], 'USD', 1_000);
    saveOwnedAlertResult([], 'USD', 2_000);
    expect(readOwnedAlertResult('USD', 5_000)?.hits).toHaveLength(1);
    expect(readOwnedAlertResult('EUR', 5_000)).toBeNull();
    expect(readOwnedAlertResult('USD', 1_000 + (RESULT_FRESH_DAYS * 86_400_000 + 1))).toBeNull();
  });
});
