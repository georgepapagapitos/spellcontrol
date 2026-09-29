import type { ScryfallCard } from '@/deck-builder/types';
import { useCardCarousel } from './useCardCarousel';

/**
 * The picked commander's (or partner's) full card image. Tapping it opens the
 * card preview, like every other card in the app: the pick card shows the
 * rules text, but not the printed card at a readable size.
 */
export function CommanderPickArt({ card, label }: { card: ScryfallCard; label: string }) {
  const carousel = useCardCarousel(label);
  const front = card.card_faces?.[0];
  return (
    <>
      <button
        type="button"
        className="commander-pick-art-btn"
        onClick={() => carousel.open([{ name: card.name, label, card }], card.name)}
        aria-label={`Preview ${card.name}`}
      >
        <img
          className="commander-pick-art"
          src={
            card.image_uris?.normal ??
            front?.image_uris?.normal ??
            card.image_uris?.large ??
            card.image_uris?.art_crop ??
            front?.image_uris?.art_crop
          }
          alt=""
        />
      </button>
      {carousel.preview}
    </>
  );
}
