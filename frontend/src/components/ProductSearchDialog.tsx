import { useId } from 'react';
import { X } from 'lucide-react';
import { Modal } from './Modal';
import { ProductSearchPanel } from './ProductSearchPanel';
import { IconButton } from '@/components/shared/Button';

/**
 * Standalone "Add a product" dialog — the {@link ProductSearchPanel} (search a
 * known MTG product and add it as a deck, with adding the cards to the
 * collection as an optional switch) hosted in the shared add-cards modal
 * shell. Deck-first (`context="deck"`), unlike the Collection's Add-cards
 * sheet, which hosts the same panel collection-first. Lets the deck surfaces
 * reuse the exact same product search.
 */
export function ProductSearchDialog({ onClose }: { onClose: () => void }) {
  const labelId = useId();
  return (
    <Modal onClose={onClose} className="modal add-cards-modal" labelledBy={labelId}>
      <div className="modal-header add-cards-modal-header">
        <h2 id={labelId}>Add a product</h2>
        <IconButton
          className="modal-close"
          onClick={onClose}
          label="Close"
          icon={<X width={20} height={20} strokeWidth={1.8} />}
        />
      </div>
      <div className="modal-body add-cards-modal-body">
        <div className="add-cards-panel add-cards-panel-product">
          <ProductSearchPanel onClose={onClose} context="deck" />
        </div>
      </div>
    </Modal>
  );
}
