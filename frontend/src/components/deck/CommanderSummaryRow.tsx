import './CommanderSummaryRow.css';
import type { ReactNode } from 'react';
import { Button } from '@/components/shared/Button';
import { ColorPip } from '@/components/shared/ManaSymbol';
import { RulesTextParagraphs } from '@/components/card/RulesText';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import { cardCoverArt } from '@/lib/deck/deck-cover';
import type { ScryfallCard } from '@/deck-builder/types';
import { useCardCarousel } from './useCardCarousel';

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

const rulesOf = (card: ScryfallCard): string =>
  card.oracle_text ??
  (card.card_faces ?? [])
    .map((f) => f.oracle_text)
    .filter(Boolean)
    .join('\n');

/**
 * Step 1 once a commander is chosen (E1113): one row, with the way back to the finder. The
 * finder stays mounted behind it, so Change commander returns to the same filters and idea.
 * The art is this printing's (the copy you own, when you picked one) and opens the card
 * preview; the type line and rules text say what the commander does before you build.
 */
export function CommanderSummaryRow({ card, note, onChange, extra }: Props) {
  const own = cardCoverArt(card);
  const byName = useCardThumb(own ? undefined : card.name, 'art_crop');
  const art = own ?? byName;
  const preview = useCardCarousel('Your commander');
  const rules = rulesOf(card);
  return (
    <div className="commander-summary">
      <button
        type="button"
        className="commander-summary-art"
        aria-label={`View ${card.name}`}
        onClick={() => preview.open([{ name: card.name, label: '', card }], card.name)}
      >
        {art && <img src={art} alt="" />}
      </button>
      <div className="commander-summary-body">
        <span className="commander-summary-name">{card.name}</span>
        <span className="commander-summary-meta">
          <span className="commander-result-pips" aria-hidden>
            {identityOf(card).map((c) => (
              <ColorPip key={c} color={c} />
            ))}
          </span>
          {card.type_line && <span>{card.type_line}</span>}
          {note && <span className="commander-summary-note">{note}</span>}
        </span>
        {rules && (
          <div className="commander-summary-rules">
            <RulesTextParagraphs text={rules} names={[card.name]} />
          </div>
        )}
      </div>
      <div className="commander-summary-actions">
        {extra}
        <Button onClick={onChange}>Change commander</Button>
      </div>
      {preview.preview}
    </div>
  );
}
