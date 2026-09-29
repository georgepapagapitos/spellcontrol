import { Wand2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCardCarousel } from '@/components/deck/useCardCarousel';
import type { BrowseItem, BrowseListDef } from '@/lib/browse-lists';
import { browsePreviewLabel } from './browse-labels';

/**
 * The card preview for a browse list: swipe through the list from the tapped
 * card, each card captioned with what the list ranks it by. A commander list
 * adds "Build a deck", which opens the generator with that commander picked.
 */
export function useBrowsePreview(def: BrowseListDef) {
  const navigate = useNavigate();
  const carousel = useCardCarousel(
    def.title,
    def.commanders
      ? (entry) => [
          {
            key: 'build',
            icon: <Wand2 width={16} height={16} strokeWidth={2} />,
            label: 'Build a deck',
            closesPreview: true,
            onClick: () =>
              navigate(`/decks/new/generate?commander=${encodeURIComponent(entry.name)}`),
          },
        ]
      : undefined
  );
  const open = (items: readonly BrowseItem[], tappedName: string) =>
    carousel.open(
      items.map((item) => ({
        name: item.name,
        label: browsePreviewLabel(def.id, item, def.title),
        card: item.card,
      })),
      tappedName
    );
  return { open, preview: carousel.preview };
}
