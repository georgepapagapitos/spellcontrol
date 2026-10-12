import { useCallback, useMemo, useState } from 'react';
import type { PlaytestState } from '@/lib/playtest';
import { cachedCardThumb } from '@/lib/cards/card-thumbs';
import { readHoldHintSeen, writeHoldHintSeen, type HandMenuState } from '../../lib/board-support';
import type { OnlineTable } from '../../hooks/use-online-table';
import { buildOpponentPreviewNames, buildPreviewSrcs } from './board-derive';

/**
 * Hover and tap previews, and the hand card menu they hand off to: the image
 * source per card instance, the tapped-to-enlarge pin, the "hold for the
 * menu" hint's seen flag, and the hand/command menu's own open state.
 */
export function useHandPreview(
  state: PlaytestState,
  opponents: OnlineTable['opponents'] | readonly []
) {
  const [handMenu, setHandMenu] = useState<HandMenuState>(null);
  /** The hand card a finger tapped, enlarged in the hover slot. */
  const [tappedPreviewId, setTappedPreviewId] = useState<string | null>(null);
  // Until a card menu has been opened on this device, a tapped card says a
  // hold opens it (the tap that used to is the preview now). Per device, like
  // card size: the gesture is the device's, not the account's.
  const [holdHintSeen, setHoldHintSeen] = useState(readHoldHintSeen);
  const retireHoldHint = useCallback(() => {
    setHoldHintSeen(true);
    writeHoldHintSeen();
  }, []);

  // Image per card instance for the hover preview — the DOM carries only ids.
  // A two-faced card previews BOTH faces, the one showing first — EDHPlay's
  // hover shows the pair, and the face you are not looking at is exactly
  // the one you cannot read off the table.
  const previewSrcs = useMemo(
    () => buildPreviewSrcs(state.battlefield, state.zones.hand, state.zones.command),
    [state.battlefield, state.zones.hand, state.zones.command]
  );
  // The opponents' permanents, by the seat-scoped id their quadrant publishes
  // as `data-preview-id`. Names, not URLs: `PublicBoard` never carries image
  // URLs (projection.ts), so the quadrant resolves art through the shared CDN
  // cache and this reads the same cache back. Safe to read synchronously
  // because `resolve` runs at POINTER time, long after the card painted.
  const opponentPreviewNames = useMemo(() => buildOpponentPreviewNames(opponents), [opponents]);
  const resolvePreview = useCallback(
    (cardId: string) => {
      const opponentCard = opponentPreviewNames.get(cardId);
      if (opponentCard) {
        const src = cachedCardThumb(opponentCard.name, 'normal');
        return src
          ? { src, counters: opponentCard.counters, pt: opponentCard.pt ?? undefined }
          : null;
      }
      return previewSrcs.get(cardId) ?? null;
    },
    [opponentPreviewNames, previewSrcs]
  );

  const handleHandCardMenu = useCallback(
    (cardId: string, x: number, y: number) => {
      setTappedPreviewId(null);
      setHandMenu({ cardId, x, y });
      retireHoldHint();
    },
    [retireHoldHint]
  );
  // A tap enlarges the card; the same card again puts it away. A card with no
  // art to enlarge would make the tap do nothing, so it opens the menu.
  const handleHandCardPreview = useCallback(
    (cardId: string, x: number, y: number) => {
      if (!resolvePreview(cardId)) return handleHandCardMenu(cardId, x, y);
      setTappedPreviewId((prev) => (prev === cardId ? null : cardId));
    },
    [resolvePreview, handleHandCardMenu]
  );
  const unpinPreview = useCallback(() => setTappedPreviewId(null), []);
  const handMenuZone = handMenu?.zone ?? 'hand';
  const handMenuCard = handMenu
    ? state.zones[handMenuZone].find((c) => c.id === handMenu.cardId)
    : null;

  return {
    handMenu,
    setHandMenu,
    handMenuZone,
    handMenuCard,
    tappedPreviewId,
    setTappedPreviewId,
    holdHintSeen,
    retireHoldHint,
    resolvePreview,
    handleHandCardMenu,
    handleHandCardPreview,
    unpinPreview,
  };
}
