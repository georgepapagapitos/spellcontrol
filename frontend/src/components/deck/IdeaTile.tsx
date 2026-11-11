import './IdeaTile.css';
import { Link } from 'react-router-dom';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import { formatCount } from '@/lib/util/format-count';
import type { Idea } from '@/lib/deck/idea-index';

interface Props {
  idea: Idea;
  to: string;
  /** Cards of this idea the collection holds; replaces the deck count under the name. */
  owned?: number;
}

/**
 * One deck idea as a sleeve tile: its most-built commander's art, the name, and what it
 * is worth knowing before opening it. A link to the idea's page.
 */
export function IdeaTile({ idea, to, owned }: Props) {
  const art = useCardThumb(idea.card, 'art_crop');
  const sub =
    owned !== undefined
      ? `You own ${formatCount(owned)}`
      : `${formatCount(idea.decks)} ${idea.decks === 1 ? 'deck' : 'decks'}`;
  return (
    <Link to={to} className="idea-tile" data-surface="sleeve">
      <span className="idea-tile-art" aria-hidden>
        {art ? (
          <img src={art} alt="" loading="lazy" />
        ) : (
          <span className="idea-tile-art-skeleton" />
        )}
      </span>
      <span className="idea-tile-name">{idea.name}</span>
      <span className="idea-tile-sub">{sub}</span>
    </Link>
  );
}
