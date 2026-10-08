import './TradeReview.css';
import { useCardThumb } from '@/lib/cards/card-thumbs';

/** Thumbnail by NAME off the CDN (never the throttled Scryfall API), or the
 *  art the caller already holds, such as an owned copy's `imageSmall`. */
export function ReviewThumb({ name, src }: { name: string; src?: string }) {
  const fetched = useCardThumb(src ? undefined : name, 'small');
  const url = src ?? fetched;
  return url ? (
    <img
      className="trade-review-thumb"
      src={url}
      alt=""
      aria-hidden
      loading="lazy"
      draggable={false}
    />
  ) : (
    <span className="trade-review-thumb is-placeholder" aria-hidden />
  );
}
