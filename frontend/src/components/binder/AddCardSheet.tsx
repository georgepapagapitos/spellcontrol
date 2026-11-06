import { AddCardSearchPanel } from '@/components/import/AddCardSearchPanel';
import { Sheet } from '@/components/overlays/Sheet';
import { Button } from '@/components/shared/Button';

interface Props {
  /** When provided, the card is also pinned to this binder after being added to the collection. */
  binderId?: string;
  binderName?: string;
  onClose: () => void;
}

/**
 * Sheet around {@link AddCardSearchPanel} for the binder-pin variant.
 * CollectionPage uses the unified {@link AddCardsSheet} instead; this exists
 * for `BinderPage`'s "add card to this binder" flow, which is intentionally
 * lightweight (one card at a time, no paste/upload/scan).
 */
export function AddCardSheet({ binderId, binderName, onClose }: Props) {
  return (
    <Sheet
      onClose={onClose}
      className="add-card-sheet add-card-sheet--panel-search"
      title={binderId ? `Add card to ${binderName ?? 'binder'}` : 'Add card to collection'}
      description={
        binderId ? 'Cards are added to your collection and pinned to this binder.' : undefined
      }
      footer={(close) => <Button onClick={close}>Done</Button>}
    >
      {(close) => <AddCardSearchPanel binderId={binderId} onEscape={close} />}
    </Sheet>
  );
}
