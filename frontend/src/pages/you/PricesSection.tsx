import { useMemo } from 'react';
import { useCollectionStore } from '@/store/collection';
import { toast } from '@/store/toasts';
import { formatPricedDate, newestPricedAt } from '@/lib/price-freshness';
import { useCurrencyStore, type Currency } from '@/lib/currency';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SegmentedControl } from '@/components/shared/form';
import { userMessage } from '@/lib/user-error';
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
