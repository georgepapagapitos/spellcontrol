import { Image as ImageIcon, ImageOff, Notebook } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { useCollectionStore } from '../store/collection';
import { useToastsStore } from '../store/toasts';
import { AddToBinderSheet } from './AddToBinderSheet';
import { BinderCardWhy } from './BinderCardWhy';
import type { CardPreviewAction } from './CardPreview';
import type { EnrichedCard, MaterializedBinder } from '../types';

/**
 * What a card preview opened from a binder offers, for every binder surface
 * (page grid, page viewer, list): why the card is here as the panel's lead,
 * and Move to binder / Set cover in its action row. BinderView and
 * BinderListView each carried their own copy of the cover action; the move
 * lived only in the list's row menu and a pocket's ⋮, never in the preview.
 *
 * Returns the preview props and the move sheet, which the host renders.
 */
export function useBinderCardPreview(binder: MaterializedBinder | undefined): {
  getCardActions: (card: EnrichedCard | undefined) => CardPreviewAction[];
  renderCardMeta: (card: EnrichedCard | undefined) => ReactNode;
  sheet: ReactNode;
} {
  const defs = useCollectionStore((s) => s.binders);
  const updateBinder = useCollectionStore((s) => s.updateBinder);
  const pushToast = useToastsStore((s) => s.push);
  const [moving, setMoving] = useState<EnrichedCard | null>(null);
  const binderId = binder?.def.id;
  const coverScryfallId = binder?.def.coverScryfallId;

  const getCardActions = useCallback(
    (card: EnrichedCard | undefined): CardPreviewAction[] => {
      if (!card || !binderId) return [];
      const actions: CardPreviewAction[] = [
        {
          key: 'move',
          label: 'Move to binder',
          shortLabel: 'Move',
          icon: <Notebook width={18} height={18} strokeWidth={2} aria-hidden />,
          closesPreview: true,
          onClick: () => setMoving(card),
        },
      ];
      // The override for the index tile's cover art (lib/binder-cover.ts),
      // only for cards that have art to show.
      if (card.imageNormal) {
        const isCover = coverScryfallId === card.scryfallId;
        actions.push({
          key: 'cover',
          label: isCover ? 'Remove cover' : 'Set cover',
          // Only when a 360px phone has no room for every label.
          shortLabel: isCover ? undefined : 'Cover',
          icon: isCover ? (
            <ImageOff width={18} height={18} strokeWidth={2} aria-hidden />
          ) : (
            <ImageIcon width={18} height={18} strokeWidth={2} aria-hidden />
          ),
          onClick: () => {
            updateBinder(binderId, { coverScryfallId: isCover ? undefined : card.scryfallId });
            pushToast({
              message: isCover
                ? 'Cover follows the most valuable card again.'
                : `${card.name} is now this binder's cover.`,
              tone: 'success',
            });
          },
        });
      }
      return actions;
    },
    [binderId, coverScryfallId, updateBinder, pushToast]
  );

  const renderCardMeta = useCallback(
    (card: EnrichedCard | undefined) =>
      card && binder ? <BinderCardWhy card={card} binder={binder} defs={defs} /> : null,
    [binder, defs]
  );

  const sheet = moving ? (
    <AddToBinderSheet
      card={moving}
      currentBinderId={binderId ?? null}
      onClose={() => setMoving(null)}
    />
  ) : null;

  return { getCardActions, renderCardMeta, sheet };
}
