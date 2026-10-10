import { type JSX, useId, useState } from 'react';
import {
  SYMBOL_WORD,
  type CastabilityReport,
  type CastabilityRow,
} from '@/lib/deck-analysis/castability';
import { InfoTip } from '@/components/overlays/InfoTip';
import { ManaCost } from '../ManaCost';

const pct = (x: number): number => Math.round(x * 100);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Rows shown before "Show all": the owner fixes, a visitor gets the worst one. */
const OWNER_ROWS = 5;
const VISITOR_ROWS = 1;

/**
 * "Can I cast my spells?" card by card, under the Color panel's mana base:
 * the spells that miss Frank Karsten's bar for having their colors on curve,
 * and the color behind them. Only the misses are listed; a deck that clears
 * the bar gets one line saying so.
 *
 * `owner` decides the voice. The owner reads advice ("Add red sources."); a
 * visitor on a shared deck reads a description of the deck instead.
 */
export function DeckCastability({
  report,
  owner,
  costChangedBy,
  onShowCard,
}: {
  report: CastabilityReport;
  owner: boolean;
  /** A commander whose cost changes (blitz, reductions) the simulation doesn't model. */
  costChangedBy?: string | null;
  onShowCard?: (name: string) => void;
}): JSX.Element {
  const titleId = useId();
  const [showAll, setShowAll] = useState(false);
  const { under, atBar, measured, average, tightSymbol } = report;
  const limit = owner ? OWNER_ROWS : VISITOR_ROWS;
  const shown = showAll ? under : under.slice(0, limit);
  const color = tightSymbol ? SYMBOL_WORD[tightSymbol] : null;
  const whose = owner ? 'your' : "this deck's";

  return (
    <section className="deck-castability" aria-labelledby={titleId}>
      <div className="deck-castability-head">
        <h5 id={titleId} className="deck-castability-title">
          Castable on curve
          <InfoTip
            label="castable on curve"
            text="Odds of having the right colors on a card's turn, when you have the mana. The bar is Frank Karsten's: 89% plus the mana value."
          />
        </h5>
        <span className="deck-castability-count">
          {under.length === 0 ? `${measured} of ${measured} pass` : `${under.length} under the bar`}
        </span>
      </div>

      {under.length === 0 ? (
        <p className="deck-castability-clear">
          <span className="deck-castability-pass" aria-hidden="true">
            ✓{' '}
          </span>
          Every spell has its colors on curve.
          {average !== null && ` ${pct(average)}% on average.`}
        </p>
      ) : (
        <>
          {color && (
            <p className="deck-castability-verdict">
              {owner
                ? `${cap(color)} is your tight color. Add ${color} sources.`
                : `${cap(color)} is this deck's tight color.`}
            </p>
          )}
          {average !== null && (
            <p className="deck-castability-lead">
              With the mana there, {whose} spells have their colors on curve {pct(average)}% of the
              time.
            </p>
          )}
          <ul className="deck-castability-list">
            {shown.map((row) => (
              <CastabilityItem key={row.name} row={row} onShowCard={onShowCard} />
            ))}
          </ul>
          {under.length > limit && (
            <button
              type="button"
              className="deck-castability-more"
              aria-expanded={showAll}
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? 'Show fewer' : `Show all ${under.length}`}
            </button>
          )}
        </>
      )}

      {atBar.length > 0 && (
        <p className="deck-castability-at-bar">
          <span className="deck-castability-at-bar-label">At the bar:</span>{' '}
          {atBar.map((row, i) => (
            <span key={row.name}>
              {i > 0 && ', '}
              <CardName name={row.name} onShowCard={onShowCard} />
            </span>
          ))}
        </p>
      )}

      <p className="deck-castability-scope">
        Over {report.games.toLocaleString('en-US')} goldfish games.
        {costChangedBy && ` ${costChangedBy}'s cost changes aren't counted.`}
      </p>
    </section>
  );
}

function CastabilityItem({
  row,
  onShowCard,
}: {
  row: CastabilityRow;
  onShowCard?: (name: string) => void;
}): JSX.Element {
  return (
    <li className="deck-castability-row">
      <span className="deck-castability-name">
        <CardName name={row.name} onShowCard={onShowCard} />
        <ManaCost cost={row.cost} />
      </span>
      <span className="deck-castability-rate">{pct(row.rate)}%</span>
      <span className="deck-castability-sub">
        <span>
          Turn {row.mv} · needs {pct(row.bar)}%
        </span>
        {row.short && (
          <span className="deck-castability-flag">
            <span aria-hidden="true">▾ </span>short on {SYMBOL_WORD[row.short.symbol]} in{' '}
            {pct(row.short.share)}% of games
          </span>
        )}
      </span>
    </li>
  );
}

/** A card name that opens its preview, or plain text where there's no preview to open. */
function CardName({
  name,
  onShowCard,
}: {
  name: string;
  onShowCard?: (name: string) => void;
}): JSX.Element {
  return onShowCard ? (
    <button type="button" className="deck-castability-card" onClick={() => onShowCard(name)}>
      {name}
    </button>
  ) : (
    <span className="deck-castability-card is-static">{name}</span>
  );
}
