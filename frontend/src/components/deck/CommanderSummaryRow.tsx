import './CommanderSummaryRow.css';
import type { ReactNode } from 'react';
import { Button } from '@/components/shared/Button';
import { ColorPip } from '@/components/shared/ManaSymbol';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import type { ScryfallCard } from '@/deck-builder/types';

interface Props {
  card: ScryfallCard;
  /** "From the Angels idea · 175 decks" when the commander came from an idea. */
  note?: string | null;
  onChange: () => void;
  /** An action beside Change commander, such as "Add a partner". */
  extra?: ReactNode;
}

const identityOf = (card: ScryfallCard): string[] =>
  card.color_identity.length > 0 ? card.color_identity : ['C'];

/**
 * Step 1 once a commander is chosen (E1113): one row, with the way back to the finder. The
 * finder stays mounted behind it, so Change commander returns to the same filters and idea.
 */
export function CommanderSummaryRow({ card, note, onChange, extra }: Props) {
  const art = useCardThumb(card.name, 'art_crop');
  return (
    <div className="commander-summary">
      <span className="commander-summary-art" aria-hidden>
        {art && <img src={art} alt="" />}
      </span>
      <div className="commander-summary-body">
        <span className="commander-summary-name">{card.name}</span>
        <span className="commander-summary-meta">
          <span className="commander-result-pips" aria-hidden>
            {identityOf(card).map((c) => (
              <ColorPip key={c} color={c} />
            ))}
          </span>
          {note && <span className="commander-summary-note">{note}</span>}
        </span>
      </div>
      <div className="commander-summary-actions">
        {extra}
        <Button onClick={onChange}>Change commander</Button>
      </div>
    </div>
  );
}
