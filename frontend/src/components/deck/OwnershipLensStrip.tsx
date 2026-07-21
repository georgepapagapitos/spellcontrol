import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import './OwnershipLensStrip.css';
import type { OwnershipLens } from '../../lib/ownership-lens';
import { formatMoney } from '../../lib/format-money';
import { OwnershipLensSheet } from './OwnershipLensSheet';

interface Props {
  lens: OwnershipLens | null;
  missingCost: number | null;
  missingCardPrices: Map<string, number | null>;
  loading: boolean;
}

/**
 * One-row summary + sheet for the ownership lens (w1-ownership-lens) — the
 * social program's flagship differentiator: cross-references a public deck's
 * cards against the SIGNED-IN VIEWER's own collection, entirely client-side
 * (see lib/ownership-lens.ts). Follows the Index-page insight-strip pattern
 * (STYLE_GUIDE UX-334): one-row summary that opens a sheet on tap, never
 * displacing the deck content below it.
 *
 * `lens`/`missingCost`/`loading` come from the page's `useOwnershipLens()`
 * call (data-fetching lives there, per w1-ownership-lens.md); this component
 * owns only the sheet's open/close UI state. Three mutually exclusive,
 * exhaustive branches: `loading` -> skeleton; `!lens` -> guest sign-in hook;
 * else -> the real strip.
 */
export function OwnershipLensStrip({ lens, missingCost, missingCardPrices, loading }: Props) {
  const [open, setOpen] = useState(false);
  const sheetId = useId();

  if (loading) {
    return <div className="ownership-lens-skeleton" aria-hidden="true" />;
  }

  if (!lens) {
    return (
      <Link to="/auth" className="ownership-lens-strip ownership-lens-strip--guest">
        <span className="ownership-lens-strip-label">
          Sign in to see what you own from this deck
        </span>
        <ChevronRight className="ownership-lens-strip-chevron" aria-hidden width={16} height={16} />
      </Link>
    );
  }

  // Ground-truth booleans (not the rounded percentOwned) decide the branch,
  // so a large deck where the rounded percent lands on 0/100 by coincidence
  // never claims "every card" or "0% owned" dishonestly.
  const fullyOwned = lens.missingCardNames.length === 0;
  const noneOwned = lens.ownedCount === 0;
  const cost = missingCost ?? 0;
  const costText = cost > 0 ? `~${formatMoney(cost, { wholeDollars: true })}` : null;

  return (
    <>
      <button
        type="button"
        className="ownership-lens-strip"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={open ? sheetId : undefined}
      >
        {!noneOwned && (
          <span className="ownership-lens-strip-glyph" aria-hidden="true">
            ✓
          </span>
        )}
        <span className="ownership-lens-strip-label">
          {fullyOwned
            ? 'You own every card in this deck'
            : noneOwned
              ? `0% owned${costText ? ` · ${costText} to build` : ''}`
              : `${lens.percentOwned}% owned in your collection${costText ? ` · ${costText} to finish` : ''}`}
        </span>
        <ChevronRight className="ownership-lens-strip-chevron" aria-hidden width={16} height={16} />
      </button>
      {open && (
        <OwnershipLensSheet
          id={sheetId}
          lens={lens}
          missingCardPrices={missingCardPrices}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
