import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import './CardOtagsSheet.css';
import {
  cardTagLabel,
  ensureCardTags,
  getCardTags,
  useCardTagsError,
  useCardTagsReady,
} from '@/lib/cards/card-tags';
import { describeOtag } from '@/lib/cards/otag-descriptions';
import { Sheet } from '@/components/overlays/Sheet';
import type { EnrichedCard } from '@/types/index';
import { Button } from '@/components/shared/Button';

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
  const loadError = useCardTagsError();

  const tags = ready ? getCardTags(card.name) : [];
  const taggerUrl =
    card.setCode && card.collectorNumber
      ? `https://tagger.scryfall.com/card/${card.setCode.toLowerCase()}/${encodeURIComponent(
          card.collectorNumber
        )}`
      : null;

  return (
    <Sheet
      onClose={onClose}
      eyebrow="Card tags"
      title={card.name}
      label={`Card tags for ${card.name}`}
      footer={(close) => (
        <>
          <Button variant="primary" onClick={() => close()}>
            Close
          </Button>
        </>
      )}
    >
      {!ready && loadError ? (
        <div className="card-picker-empty" role="alert">
          Couldn't load tags. Try again.{' '}
          <Button variant="link" onClick={() => void ensureCardTags()}>
            Retry
          </Button>
        </div>
      ) : !ready ? (
        <div className="card-picker-empty">Loading tags…</div>
      ) : tags.length === 0 ? (
        <div className="card-picker-empty">No function tags for this card.</div>
      ) : (
        <ul className="card-picker-list" role="list">
          {tags.map((tag) => (
            <li key={tag} className="card-otags-row">
              <div className="card-otags-row-head">
                {/* In-app first: the chip opens the tag explorer, so "what
                      else does this?" no longer has to leave for scryfall.com. */}
                <Link
                  className="card-otags-chip"
                  to={`/tags?t=${encodeURIComponent(tag)}`}
                  onClick={onClose}
                  aria-label={`Browse every ${cardTagLabel(tag)} card`}
                >
                  {cardTagLabel(tag)}
                </Link>
                <a
                  className="card-otags-search-link"
                  href={`https://scryfall.com/search?q=${encodeURIComponent(`otag:${tag}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Search on Scryfall
                  <ExternalLink width={14} height={14} strokeWidth={1.8} aria-hidden />
                </a>
              </div>
              <p className="card-otags-desc">{describeOtag(tag)}</p>
            </li>
          ))}
        </ul>
      )}

      <p className="card-otags-note">
        Tags come from Scryfall's community Tagger project.
        {taggerUrl && (
          <>
            {' '}
            <a href={taggerUrl} target="_blank" rel="noopener noreferrer">
              View this card on Tagger
            </a>
          </>
        )}
      </p>
    </Sheet>
  );
}
