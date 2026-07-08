import { ExternalLink } from 'lucide-react';
import { useCallback } from 'react';
import './CardOtagsSheet.css';
import { cardTagLabel, getCardTags, useCardTagsReady } from '../lib/card-tags';
import { describeOtag } from '../lib/otag-descriptions';
import { useEscapeKey } from '../lib/use-escape-key';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useSheetExit } from '../lib/use-sheet-exit';
import type { EnrichedCard } from '../types';

interface Props {
  /** Needs only the name (tag lookup) plus set/collector for the Tagger deep link. */
  card: Pick<EnrichedCard, 'name' | 'setCode' | 'collectorNumber'>;
  onClose: () => void;
}

/**
 * Bottom sheet listing the Scryfall oracle tags (otags) a card carries in the
 * bundled tagger snapshot — a chip + one-line description per tag, each with a
 * "Search on Scryfall" link so the user can browse everything with the same
 * function. Rides the shared `.card-picker-*` shell (scrim, slide-up entry,
 * `binder-sheet-slide-out` exit) exactly like {@link AddToBinderSheet}.
 */
export function CardOtagsSheet({ card, onClose }: Props) {
  const ready = useCardTagsReady();

  useLockBodyScroll();

  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = useCallback(() => {
    // Desktop renders the shell as a centered panel with `animation: none`,
    // so there is no exit keyframe to wait on — close immediately there.
    if (window.matchMedia('(min-width: 1024px)').matches) onClose();
    else beginClose();
  }, [beginClose, onClose]);
  useEscapeKey(dismiss);

  const tags = ready ? getCardTags(card.name) : [];
  const taggerUrl =
    card.setCode && card.collectorNumber
      ? `https://tagger.scryfall.com/card/${card.setCode.toLowerCase()}/${encodeURIComponent(
          card.collectorNumber
        )}`
      : null;

  return (
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        dismiss();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Card tags for ${card.name}`}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <p className="card-otags-eyebrow">Card tags</p>
          <p className="card-otags-card-name">{card.name}</p>
        </div>

        {!ready ? (
          <div className="card-picker-empty">Loading tags…</div>
        ) : tags.length === 0 ? (
          <div className="card-picker-empty">
            No function tags in the local snapshot for this card.
          </div>
        ) : (
          <ul className="card-picker-list" role="list">
            {tags.map((tag) => (
              <li key={tag} className="card-otags-row">
                <div className="card-otags-row-head">
                  <span className="card-otags-chip">{cardTagLabel(tag)}</span>
                  <a
                    className="card-otags-search-link"
                    href={`https://scryfall.com/search?q=${encodeURIComponent(`otag:${tag}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Search on Scryfall
                    <ExternalLink width={11} height={11} strokeWidth={2} aria-hidden />
                  </a>
                </div>
                <p className="card-otags-desc">{describeOtag(tag)}</p>
              </li>
            ))}
          </ul>
        )}

        <p className="card-otags-note">
          Tags come from Scryfall’s community Tagger project; this app bundles a snapshot of
          curated function tags.
          {taggerUrl && (
            <>
              {' '}
              <a href={taggerUrl} target="_blank" rel="noopener noreferrer">
                View this card on Tagger
              </a>
            </>
          )}
        </p>

        <div className="card-picker-footer">
          <button type="button" className="btn btn-primary" onClick={() => dismiss()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
