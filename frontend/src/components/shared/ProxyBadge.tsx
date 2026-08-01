import './ProxyBadge.css';
import type { JSX } from 'react';

export interface ProxyBadgeProps {
  card: { proxy?: boolean };
  className?: string;
}

/**
 * Proxy indicator — a small "P" chip, warn-toned so it reads distinct from
 * the accent-toned deck/binder badges (WCAG 1.4.1: the letter carries the
 * meaning, the tint reinforces it). Sized/shaped like `FoilBadge` so the two
 * per-copy authenticity chips read as a family.
 *
 * Scoped to `proxy` only, not its siblings `altered`/`misprint`: a proxy is
 * force-priced to $0 by `applyPrices` (lib/card-prices.ts), so it changes
 * every downstream computation that reads `purchasePrice` — collection
 * total, budget/binder price rules, price filters. `altered`/`misprint` are
 * cosmetic-only and stay inspector-only (CardPreview's " · ALTERED" line);
 * add the same treatment here if a real ask for at-a-glance altered/misprint
 * ever lands. ponytail: one flag, one chip — no config for a variant nobody
 * asked for.
 */
export function ProxyBadge({ card, className }: ProxyBadgeProps): JSX.Element | null {
  if (!card.proxy) return null;
  return (
    <span
      className={`proxy-badge${className ? ` ${className}` : ''}`}
      role="img"
      aria-label="Proxy"
      title="Proxy — priced at $0, not a real printing"
    />
  );
}
