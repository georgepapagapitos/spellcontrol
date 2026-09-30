import type { PlaytestState } from '@/lib/playtest';
import type { ScryfallCard } from '@/deck-builder/types';
import { commanderTaxAmount } from '../../lib/zones';
import { CardInfoDialog } from '../CardInfoDialog';

interface BoardCardInfoProps {
  previewCardId: string;
  cardLookup: Map<string, ScryfallCard> | undefined;
  state: Pick<PlaytestState, 'battlefield' | 'zones' | 'commanderTax'>;
  onClose: () => void;
}

/** "View information" on one card: the rules text and its live state. */
export function BoardCardInfo({ previewCardId, cardLookup, state, onClose }: BoardCardInfoProps) {
  if (!cardLookup?.has(previewCardId)) return null;
  const card = cardLookup.get(previewCardId)!;
  // The permanent behind the inspected card, when it's on the
  // battlefield — the dialog prints its live state (tapped, counters,
  // attachments) between the type line and the card's rules text.
  const bf = state.battlefield.find((b) => b.card.id === previewCardId);
  const host = bf?.attachedTo
    ? state.battlefield.find((b) => b.card.id === bf.attachedTo)?.card.name
    : undefined;
  // The copy's own art (the printing you own), wherever it sits.
  const copy =
    bf?.card ??
    Object.values(state.zones)
      .flat()
      .find((c) => c.id === previewCardId);
  return (
    <CardInfoDialog
      card={card}
      art={copy && { front: copy.imageUrl, back: copy.backImageUrl }}
      status={{
        card: bf?.card ?? { id: previewCardId, name: card.name },
        bf,
        attachedToName: host,
        tax: commanderTaxAmount(state.commanderTax, previewCardId),
      }}
      onClose={onClose}
    />
  );
}
