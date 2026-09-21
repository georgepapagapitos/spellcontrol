import { useState } from 'react';
import { CtxMenuShell } from '@/components/shared/CtxMenuShell';
import { useMediaQuery } from '../../lib/use-media-query';
import { DeckCardMenuBody } from './DeckCardMenuBody';
import type { DeckCardActionCtx } from './deck-card-actions';
import type { Row } from './deck-display-rows';

/**
 * A card's menu, anchored to the pointer. Opened by right-clicking a card in
 * any of the three deck layouts, and by the kebab on a grid or stacks tile
 * (where there is no row to hang the list view's kebab on).
 *
 * The same `DeckCardMenuBody` the list kebab renders, in the shell the
 * playtest card menus already use, so the deck view inherits Escape, the
 * backdrop, the viewport clamp, the bottom-sheet form on a narrow screen and
 * focus-into-the-first-control without reinventing any of it.
 */
export function DeckCardMenu({
  row,
  x,
  y,
  ctx,
  deckTags,
  onClose,
}: {
  row: Row;
  x: number;
  y: number;
  ctx: DeckCardActionCtx;
  deckTags: string[];
  onClose: () => void;
}) {
  const [page, setPage] = useState<'root' | 'stack'>('root');
  // Same boundary the shell's own sheet styling assumes. A floating popover
  // anchored to a fingertip is unusable on a phone; the sheet is not.
  const narrow = useMediaQuery('(max-width: 1023px)');

  return (
    <CtxMenuShell
      x={x}
      y={y}
      title={row.name}
      variant={narrow ? 'sheet' : 'floating'}
      contentKey={page}
      onClose={onClose}
    >
      <DeckCardMenuBody
        row={row}
        ctx={ctx}
        deckTags={deckTags}
        page={page}
        onPageChange={setPage}
        onClose={onClose}
      />
    </CtxMenuShell>
  );
}
