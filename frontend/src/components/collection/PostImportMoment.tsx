import './PostImportMoment.css';
import { X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, IconButton } from '@/components/shared/Button';
import { ColorPip } from '@/components/shared/ManaSymbol';
import { CommanderResultCard } from '@/components/deck/CommanderResultCard';
import { colorComboName, colorWords } from '@/lib/deck/commander-finder';
import { formatMoney } from '@/lib/collection/format-money';
import { track } from '@/lib/util/analytics';
import { usePostImportMoment } from '@/store/post-import-moment';
import { useCollectionStore } from '@/store/collection';
import type { EnrichedCard } from '@/types/index';
import { dominantColors } from '@/lib/collection/dominant-colors';
import { useOwnedCommanderPicks } from './use-owned-commander-picks';

interface Props {
  cards: EnrichedCard[];
}

/**
 * Right after an import: a short read of what the collection holds, and the
 * three commanders the player can build mostly from cards they already own,
 * each one tap from deck generation with the collection as the source. Shown
 * once per import (store/post-import-moment.ts), dismissible, and reopenable
 * from the Collection menu.
 */
export function PostImportMoment({ cards }: Props) {
  const navigate = useNavigate();
  const dismiss = usePostImportMoment((s) => s.dismiss);
  const shownCounted = usePostImportMoment((s) => s.shownCounted);
  const markShownCounted = usePostImportMoment((s) => s.markShownCounted);
  const pricesEverLoaded = useCollectionStore((s) => s.pricesEverLoaded);
  const isRefreshingPrices = useCollectionStore((s) => s.isRefreshingPrices);
  const { state, retry } = useOwnedCommanderPicks(cards);

  useEffect(() => {
    if (shownCounted) return;
    markShownCounted();
    track('post_import_shown');
  }, [shownCounted, markShownCounted]);

  const value = useMemo(() => cards.reduce((sum, c) => sum + c.purchasePrice, 0), [cards]);
  const colors = useMemo(() => dominantColors(cards), [cards]);
  const priced = pricesEverLoaded && !isRefreshingPrices && value > 0;

  const build = (name: string) => {
    track('post_import_tapped');
    // Owned-first: the generator fills from what the player owns, then from
    // EDHREC's recommendations (strategy 'prefer', "Lean on mine"); see DeckGeneratePage.
    navigate(`/decks/new/generate?commander=${encodeURIComponent(name)}`, {
      state: { ownedFirst: true },
    });
  };

  return (
    <section className="import-review post-import-moment" aria-labelledby="post-import-title">
      <div className="import-review-header">
        <h2 className="import-review-title" id="post-import-title">
          What we found in your collection
        </h2>
        <IconButton
          variant="quiet"
          className="banner-dismiss"
          onClick={dismiss}
          label="Dismiss what we found"
          icon={<X width={16} height={16} strokeWidth={2} />}
        />
      </div>

      <p className="post-import-facts">
        <span>
          {cards.length.toLocaleString()} {cards.length === 1 ? 'card' : 'cards'}
        </span>
        {priced && <span>{formatMoney(value, { wholeDollars: true })}</span>}
        {colors.length > 0 && (
          <span className="post-import-colors">
            {colors.map((c) => (
              <ColorPip key={c} color={c} />
            ))}
            <span>Mostly {colorWords(colors).toLowerCase()}</span>
          </span>
        )}
      </p>

      <div className="import-review-section">
        {state.status === 'loading' && (
          <p className="post-import-state" role="status">
            <span className="spinner" aria-hidden="true" />
            Checking your commanders against what they play…
          </p>
        )}
        {state.status === 'error' && (
          <p className="post-import-state" role="alert">
            Couldn't rate your commanders right now.
            <Button onClick={retry}>Retry</Button>
          </p>
        )}
        {state.status === 'empty' && (
          <p className="post-import-state">
            No commanders in this collection yet.
            <Button to="/decks/new/generate">Find a commander</Button>
          </p>
        )}
        {state.status === 'ready' && (
          <>
            <p className="post-import-lead">
              Commanders you can build mostly from cards you own. Each one starts a deck that uses
              your collection first.
            </p>
            <ul className="post-import-picks">
              {state.picks.map(({ card, score }) => {
                const identity = card.colorIdentity ?? [];
                return (
                  <li key={card.name}>
                    <CommanderResultCard
                      name={card.name}
                      imageUrl={card.imageNormal}
                      colors={identity.length > 0 ? identity : ['C']}
                      comboName={colorComboName(identity)}
                      typeLine={card.typeLine}
                      readiness={score}
                      coverageBar
                      onSelect={() => build(card.name)}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
