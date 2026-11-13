import { Check } from 'lucide-react';
import { useCardCarousel } from './useCardCarousel';
import { formatDeckCount } from './CommanderResultCard';

interface Inspectable {
  name: string;
  numDecks?: number;
}

/**
 * The finder's View: the one card preview over the commanders on screen,
 * swipeable from the one tapped, with Choose commander as its action. Lets a
 * player read a commander's rules before picking; the tile itself still picks.
 */
export function useCommanderInspect<E extends Inspectable>(
  entries: readonly E[],
  onChoose: (entry: E) => void
) {
  const carousel = useCardCarousel('Commanders', (shown) => {
    const entry = entries.find((e) => e.name === shown.name);
    return entry
      ? [
          {
            key: 'choose',
            icon: <Check width={16} height={16} strokeWidth={2} />,
            label: 'Choose commander',
            closesPreview: true,
            onClick: () => onChoose(entry),
          },
        ]
      : [];
  });
  const open = (name: string) =>
    carousel.open(
      entries.map((e) => ({ name: e.name, label: e.numDecks ? formatDeckCount(e.numDecks) : '' })),
      name
    );
  return { open, preview: carousel.preview };
}
