import { Chip } from '@/components/shared/Chip';
import { inDeckStatus } from '@/lib/search/row-announcement';

/** The row's caution badges. Each carries its own spoken status (`data-status`),
 *  which the keyboard announcement reads back (`lib/search/row-announcement`). */
export function OffColorBadge() {
  return (
    <Chip
      className="card-search-badge"
      tone="warn"
      title="Outside your commander's color identity"
      data-status="Off-color"
    >
      Off-color
    </Chip>
  );
}

export function NotLegalBadge() {
  return (
    <Chip
      className="card-search-badge"
      tone="warn"
      title="Not legal in this format"
      data-status="Not legal"
    >
      Not legal
    </Chip>
  );
}

/** "in deck × 2": the count of copies already in the deck. */
export function InDeckCount({ count }: { count: number }) {
  return (
    <>
      {' · '}
      <span className="card-search-indeck" data-status={inDeckStatus(count)}>
        in deck × {count}
      </span>
    </>
  );
}
