import { useState } from 'react';
import { CardThumb } from './CardThumb';
import { PrintingPicker, type AddExtras } from './PrintingPicker';
import { imageFromCard } from '../lib/card-thumbs';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';
import './AddCardInspector.css';

interface Props {
  /** The active search result, or null for an empty query / no results. */
  card: ScryfallCard | null;
  onAdd: (printing: ScryfallCard, finish: Finish, extras: AddExtras) => void;
}

/**
 * Desktop Search tab right pane (T153 phase 4, ≥1024px): the active result's
 * art, name and type, then the shared {@link PrintingPicker} so a different
 * printing, finish, condition, language or quantity can be added without
 * leaving the keyboard. Mirrors the per-row "Printing & finish" disclosure
 * {@link CardSearchResults} hides at this width — same picker, one place.
 *
 * The header shows the printing the picker's Add will add: the row's own
 * printing to start, then whichever tile is picked. An inspector showing one
 * printing above a different selected tile misstates what Add does.
 */
export function AddCardInspector({ card, onAdd }: Props) {
  if (!card) {
    return (
      <div className="add-card-inspector add-card-inspector-empty">
        <p className="card-picker-empty">Search for a card to see it here.</p>
      </div>
    );
  }
  // Keyed by card: moving to another row starts from that row's printing.
  return <InspectorBody key={card.id} card={card} onAdd={onAdd} />;
}

function InspectorBody({ card, onAdd }: { card: ScryfallCard; onAdd: Props['onAdd'] }) {
  const [shown, setShown] = useState<ScryfallCard>(card);
  const art = imageFromCard(shown, 'normal');

  return (
    <div className="add-card-inspector">
      <div className="add-card-inspector-top">
        {art ? (
          <CardThumb
            src={art}
            alt={`${card.name}, ${shown.set_name}`}
            className="collection-grid-item add-card-inspector-art"
          />
        ) : (
          <span
            className="collection-grid-item add-card-inspector-art is-empty"
            aria-hidden="true"
          />
        )}
        <div className="add-card-inspector-heading">
          <h3 className="add-card-inspector-name">{card.name}</h3>
          <p className="add-card-inspector-type">{card.type_line}</p>
          <p className="add-card-inspector-type">
            {shown.set_name} · {shown.set.toUpperCase()} #{shown.collector_number}
          </p>
        </div>
      </div>
      <PrintingPicker
        cardName={card.name}
        fallback={card}
        showExtras
        onAdd={onAdd}
        onSelectedChange={setShown}
      />
    </div>
  );
}
