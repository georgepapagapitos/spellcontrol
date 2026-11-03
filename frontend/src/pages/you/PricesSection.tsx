import { useMemo } from 'react';
import { useCollectionStore } from '@/store/collection';
import { toast } from '@/store/toasts';
import { formatPricedDate, newestPricedAt } from '@/lib/collection/price-freshness';
import { useCurrencyStore, type Currency } from '@/lib/collection/currency';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { Field, SegmentedControl, SwitchRow } from '@/components/shared/form';
import { formatMoney } from '@/lib/collection/format-money';
import {
  AMOUNT_CHOICES,
  PERCENT_CHOICES,
  useOwnedAlertStore,
  type AlertDirection,
} from '@/lib/collection/owned-price-alerts';
import { userMessage } from '@/lib/util/user-error';
import { Button } from '@/components/shared/Button';
import { NEEDS_CARDS } from './sections';

/** Which market prices the app shows, and fetching them fresh. */
export function PricesSection() {
  const cards = useCollectionStore((s) => s.cards);
  const cardCount = cards.length;
  const pricesUpdated = useMemo(() => formatPricedDate(newestPricedAt(cards)), [cards]);
  const isRefreshingPrices = useCollectionStore((s) => s.isRefreshingPrices);
  const refreshPrices = useCollectionStore((s) => s.refreshPrices);
  const reapplyCardPrices = useCollectionStore((s) => s.reapplyCardPrices);
  const currency = useCurrencyStore((s) => s.currency);
  const setCurrency = useCurrencyStore((s) => s.setCurrency);
  const alerts = useOwnedAlertStore((s) => s.settings);
  const updateAlerts = useOwnedAlertStore((s) => s.update);

  function handleCurrencyChange(next: Currency) {
    if (next === currency) return;
    setCurrency(next);
    // Flip the whole UI instantly from cached values in the new currency…
    reapplyCardPrices();
    // …then backfill anything the device hasn't fetched in that currency yet
    // (cache entries from before EUR support come back unpriced). Tracked so
    // the global progress pill shows why numbers are filling in.
    if (useCollectionStore.getState().cards.some((c) => !c.pricedAt)) {
      refreshPrices(undefined, { track: true }).catch((err: unknown) => {
        toast.show({
          message: userMessage(err, "Couldn't refresh prices. Try again in a moment."),
          tone: 'error',
        });
      });
    }
  }

  async function handleRefreshPrices() {
    if (isRefreshingPrices || cardCount === 0) return;
    try {
      // track: surface the global "Refreshing prices (n/m)…" pill so progress
      // stays visible after the user navigates away.
      await refreshPrices(undefined, { track: true });
      toast.show({ message: 'Prices refreshed.', tone: 'success' });
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't refresh prices. Try again in a moment."),
        tone: 'error',
      });
    }
  }

  return (
    <>
      <SettingsSection
        id="settings-collection-prefs-title"
        title="Currency"
        hint="USD prices come from TCGplayer, EUR from Cardmarket."
      >
        <SegmentedControl<Currency>
          ariaLabel="Price currency"
          value={currency}
          onChange={handleCurrencyChange}
          options={(['USD', 'EUR'] as const).map((c) => ({
            value: c,
            label: c === 'USD' ? '$ USD' : '€ EUR',
          }))}
        />
      </SettingsSection>

      <SettingsSection
        id="settings-owned-alerts-title"
        title="Price alerts"
        hint="Checked each time prices refresh, on this device. Your want-list target prices alert separately."
      >
        <SwitchRow
          label="Alert on cards you own"
          hint={
            alerts.enabled
              ? 'Cards that move past both limits show in Waiting on you.'
              : 'Flags cards you own that spike or dip, in Waiting on you.'
          }
          checked={alerts.enabled}
          onChange={(enabled) => updateAlerts({ enabled })}
        />
        {alerts.enabled && (
          <>
            <Field label="Alert me when a price" hint="Spikes are rises, dips are drops.">
              <SegmentedControl<AlertDirection>
                ariaLabel="Price direction"
                value={alerts.direction}
                onChange={(direction) => updateAlerts({ direction })}
                options={[
                  { value: 'up', label: 'Spikes' },
                  { value: 'down', label: 'Dips' },
                  { value: 'both', label: 'Either' },
                ]}
              />
            </Field>
            <Field label="By at least" hint="A share of the old price.">
              <SegmentedControl<number>
                ariaLabel="Minimum percent move"
                value={alerts.minPercent}
                onChange={(minPercent) => updateAlerts({ minPercent })}
                options={PERCENT_CHOICES.map((p) => ({ value: p, label: `${p}%` }))}
              />
            </Field>
            <Field label="And at least" hint="Per copy, so cheap cards stay quiet.">
              <SegmentedControl<number>
                ariaLabel="Minimum amount per copy"
                value={alerts.minAmount}
                onChange={(minAmount) => updateAlerts({ minAmount })}
                options={AMOUNT_CHOICES.map((a) => ({ value: a, label: formatMoney(a) }))}
              />
            </Field>
          </>
        )}
      </SettingsSection>

      <SettingsSection id="settings-card-prices-title" title="Card prices">
        <SettingsRow
          value="Refresh card prices"
          hint={
            cardCount === 0 ? (
              NEEDS_CARDS
            ) : (
              <>
                Fetches {currency} prices from Scryfall.
                {pricesUpdated && ` Last updated ${pricesUpdated}.`}
              </>
            )
          }
          actions={
            <Button
              onClick={() => void handleRefreshPrices()}
              disabled={cardCount === 0 || isRefreshingPrices}
            >
              {isRefreshingPrices ? 'Refreshing…' : 'Refresh prices'}
            </Button>
          }
        />
      </SettingsSection>
    </>
  );
}
