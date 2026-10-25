import { type JSX, useMemo } from 'react';
import { DeckCardRow } from './DeckCardRow';
import { useCardPriceLookup } from './use-missing-prices';
import { rankBuys } from '@/lib/coach/coach-buys';
import type { BuyState } from '@/lib/coach/use-cut-swaps';
import type { Change } from '@/lib/coach/deck-change';

/**
 * The buys under the Cuts lane (E1038 4.2): for the weakest slots, the cards you
 * do not own that the deck's objective rates best per dollar. The lane's rows
 * above already hold the best card you own for each slot, so this only ever
 * answers "is a purchase worth it?". Cards with no price are counted, not ranked.
 */
export function CutsBuys({
  buys,
  deckNames,
  commanderName,
  onAct,
  onPreview,
  busy,
}: {
  buys: BuyState;
  /** Lowercased names in the deck: a buy whose cut or card has since moved is dropped. */
  deckNames: ReadonlySet<string>;
  commanderName?: string;
  onAct: (change: Change) => void;
  onPreview: (change: Change) => void;
  busy: (change: Change) => boolean;
}): JSX.Element | null {
  const candidates = useMemo(
    () =>
      buys.status === 'ready'
        ? buys.buys.filter(
            (b) =>
              deckNames.has(b.cutName.toLowerCase()) && !deckNames.has(b.change.name.toLowerCase())
          )
        : [],
    [buys, deckNames]
  );
  const names = useMemo(() => candidates.map((b) => b.change.name), [candidates]);
  const { prices, loaded } = useCardPriceLookup(names);
  const ranking = useMemo(
    () => rankBuys(candidates, (n) => prices.get(n.toLowerCase())),
    [candidates, prices]
  );

  if (buys.status === 'idle' || buys.status === 'error') return null;
  const waiting = buys.status === 'loading' || (candidates.length > 0 && !loaded);
  if (waiting) {
    return (
      <p className="coach-feed-buys-note" role="status">
        Looking for buys worth the money.
      </p>
    );
  }
  const { ranked, unpriced } = ranking;
  return (
    <section className="coach-feed-buys" aria-labelledby="coach-feed-buys-title">
      <h3 id="coach-feed-buys-title" className="coach-feed-buys-title">
        Best buys for these slots
      </h3>
      {ranked.length === 0 ? (
        <p className="coach-feed-buys-note">
          {unpriced > 0
            ? `${unpriced} card${unpriced === 1 ? '' : 's'} would help, but ${unpriced === 1 ? 'has' : 'have'} no price yet, so none is ranked.`
            : "Nothing you'd have to buy beats what you own for these slots."}
        </p>
      ) : (
        <>
          <p className="coach-feed-buys-note">Ranked by how much the deck gains per dollar.</p>
          <ul className="list-stack list-stack--flush coach-feed-rows" aria-label="Best buys">
            {ranked.map((b) => {
              const change: Change = { ...b.change, id: `buy:${b.change.id}`, deltaPrice: b.price };
              return (
                <li key={change.id}>
                  <DeckCardRow
                    as="div"
                    change={change}
                    commanderName={commanderName}
                    peekName={change.name}
                    artThumb
                    onPreview={() => onPreview(change)}
                    onAct={onAct}
                    acting={busy(change)}
                  />
                </li>
              );
            })}
          </ul>
          {unpriced > 0 && (
            <p className="coach-feed-buys-note">
              {unpriced} more {unpriced === 1 ? 'has' : 'have'} no price yet and{' '}
              {unpriced === 1 ? "isn't" : "aren't"} ranked.
            </p>
          )}
        </>
      )}
    </section>
  );
}
