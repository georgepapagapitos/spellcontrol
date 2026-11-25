import { Wand2 } from 'lucide-react';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { isCommanderEligible } from '@spellcontrol/binder-routing';
import type { CardPreviewAction } from './CardPreview';
import type { EnrichedCard } from '@/types/index';

/**
 * "Build a deck" for the collection's card preview. Only a card that can lead
 * a Commander deck gets it. Binders don't offer it: their row already holds
 * Move and Set cover, and a fifth button wraps on every phone width.
 * It opens the generator with that commander picked, where Start blank and
 * Generate sit side by side, so one screen covers building by hand and
 * generating. Owned-first, like the post-import moment: the player came from
 * their collection, so the generator leans on what they own.
 *
 * Same label and glyph as the Played-in carousel's action, which goes to the
 * same place.
 */
export function useBuildDeckAction(): (card: EnrichedCard | undefined) => CardPreviewAction | null {
  const navigate = useNavigate();
  return useCallback(
    (card) => {
      if (!card || !isCommanderEligible(card)) return null;
      return {
        key: 'build-deck',
        label: 'Build a deck',
        shortLabel: 'Build',
        icon: <Wand2 width={18} height={18} strokeWidth={2} aria-hidden />,
        closesPreview: true,
        onClick: () =>
          navigate(`/decks/new/generate?commander=${encodeURIComponent(card.name)}`, {
            state: { ownedFirst: true },
          }),
      };
    },
    [navigate]
  );
}
