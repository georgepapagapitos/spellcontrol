import './PriceOverrideBadge.css';
import type { JSX } from 'react';
import { getCurrency } from '../../lib/currency';

export interface PriceOverrideBadgeProps {
  card: { priceOverride?: number; priceOverrideCurrency?: string };
  className?: string;
}

/**
 * Manual market-price override indicator (E204) — a small "M" chip, same
 * shape family as `ProxyBadge`/`FoilBadge`. ALWAYS visible wherever a card's
 * price renders, never hover-gated: an overridden number that looks
 * identical to a live market price is a data-integrity trap, not a
 * nice-to-have detail.
 *
 * Two states share the one chip rather than splitting into two components:
 *   - active (default look): the override is denominated in the currently
 *     active display currency, so it IS the number on screen right now.
 *   - dormant (`.is-dormant`, dimmed): the override is set but recorded in
 *     the OTHER currency. There's no FX conversion in this app (EUR is
 *     Cardmarket's own quote, not a USD conversion — see `applyPrices` in
 *     `lib/card-prices.ts`), so the price shown is the real market price,
 *     not the override. The dim chip + title tell the user why, rather than
 *     the override silently vanishing with no explanation.
 */
export function PriceOverrideBadge({
  card,
  className,
}: PriceOverrideBadgeProps): JSX.Element | null {
  if (card.priceOverride === undefined) return null;
  const overrideCurrency = card.priceOverrideCurrency ?? 'USD';
  const active = overrideCurrency === getCurrency();
  return (
    <span
      className={`price-override-badge${active ? '' : ' is-dormant'}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={active ? 'Manually priced' : `Manually priced in ${overrideCurrency}`}
      title={
        active
          ? "Manually priced — overrides Scryfall's market price"
          : `Manually priced in ${overrideCurrency} — switch display currency to see it`
      }
    />
  );
}
