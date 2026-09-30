import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useLinkDrop } from '@/lib/import-export/use-link-drop';

/**
 * The editor's drop target for cards dragged in from Scryfall (useLinkDrop): a
 * full-window veil naming the zone the card lands in, shown while a link drag
 * is over the window and while the drop is looked up. Purely visual
 * (aria-hidden, pointer-events off); the toast after the drop is the
 * announcement.
 */
export function DeckScryfallDropOverlay({
  zoneLabel,
  onDropText,
}: {
  zoneLabel: string;
  onDropText: (text: string) => Promise<void>;
}) {
  const [finding, setFinding] = useState(false);
  const dragging = useLinkDrop((text) => {
    setFinding(true);
    void onDropText(text).finally(() => setFinding(false));
  });
  if (!dragging && !finding) return null;
  return (
    <div className="deck-link-drop" aria-hidden="true">
      <p className="deck-link-drop-message">
        <Plus width={20} height={20} strokeWidth={1.8} aria-hidden />
        {dragging ? `Drop to add to ${zoneLabel}` : 'Finding the card on Scryfall…'}
      </p>
    </div>
  );
}
