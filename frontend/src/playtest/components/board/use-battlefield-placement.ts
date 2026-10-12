import type { RefObject } from 'react';
import type { PlaytestAction, PlaytestCard, PlaytestState } from '@/lib/playtest';
import { autoPlace } from '../../lib/auto-place';
import { measureBattlefieldRect } from '../../lib/board-drag';
import { resolveTokenArt } from '../../lib/token-art';
import type { MadeToken } from '../menu-entries';

/**
 * Putting cards onto the felt: where a card lands (auto-placement against the
 * live felt box), playing from hand, minting tokens, casting a commander and
 * the peek dialog's moves. Reads live DOM geometry, so the functions are
 * redefined every render by design.
 */
export function useBattlefieldPlacement(
  state: PlaytestState,
  dispatch: (action: PlaytestAction) => void,
  battlefieldRef: RefObject<HTMLDivElement | null>
) {
  const getBattlefieldRect = () => measureBattlefieldRect(battlefieldRef.current);

  function placeOnBattlefield(card: PlaytestCard) {
    return autoPlace(card, state.battlefield, getBattlefieldRect());
  }

  function playFromHand(cardId: string, opts?: { tapped?: boolean; faceDown?: boolean }) {
    const handCard = state.zones.hand.find((c) => c.id === cardId);
    if (!handCard) return;
    // A face-down permanent is a 2/2 creature (morph, manifest) whatever its
    // printed type — it belongs in the creature row.
    const { x, y } = placeOnBattlefield(
      opts?.faceDown ? { ...handCard, typeLine: 'Creature' } : handCard
    );
    dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId, x, y, ...opts });
  }

  /** A token onto the battlefield — from the token picker, or a card menu's
   *  Create token row. */
  const createToken = ({ name, typeLine, imageUrl }: MadeToken & { imageUrl?: string }) => {
    const id = `tok-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tokenCard: PlaytestCard = {
      id,
      name,
      isToken: true,
      // Carried through so auto-placement puts a creature token in the
      // creature row rather than guessing from the name.
      ...(typeLine !== undefined && { typeLine }),
      ...(imageUrl !== undefined && { imageUrl }),
    };
    const { x, y } = placeOnBattlefield(tokenCard);
    dispatch({ type: 'CREATE_TOKEN', card: tokenCard, x, y });
    // A token picked from the grid already brought its art. Anything else
    // needs resolving, and that never blocks the token appearing — the
    // placeholder renders immediately and the art swaps in when (if) it lands.
    if (imageUrl) return;
    void resolveTokenArt(name).then((url) => {
      if (url) dispatch({ type: 'SET_CARD_IMAGE', cardId: id, imageUrl: url });
    });
  };

  /** Out of the command zone onto the battlefield — the reducer bumps that
   *  commander's own tax. */
  const castCommander = (card: PlaytestCard) => {
    const pos = placeOnBattlefield(card);
    dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: card.id, x: pos.x, y: pos.y });
  };

  /** Where a randomly selected card goes from the peek dialog. */
  const handlePeekMove = (
    card: PlaytestCard,
    to: 'hand' | 'battlefield' | 'graveyard' | 'exile'
  ) => {
    if (to === 'battlefield') {
      const pos = placeOnBattlefield(card);
      dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: card.id, x: pos.x, y: pos.y });
    } else {
      dispatch({ type: 'MOVE_TO_ZONE', cardId: card.id, to });
    }
  };

  return { placeOnBattlefield, playFromHand, createToken, castCommander, handlePeekMove };
}
