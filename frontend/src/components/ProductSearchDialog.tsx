import { useId } from 'react';
import { X } from 'lucide-react';
import { Modal } from './Modal';
import { ProductSearchPanel } from './ProductSearchPanel';

/**
 * Standalone "Add a precon" dialog — the {@link ProductSearchPanel} (search a
 * known MTG product → add as a deck / to the collection / both) hosted in the
 * shared add-cards modal shell. Lets the deck surfaces reuse the exact same
 * precon search the Collection's Add-cards sheet exposes as its Precons tab.
 */
export function ProductSearchDialog({ onClose }: { onClose: () => void }) {
  const labelId = useId();
  return (
    <Modal onClose={onClose} className="modal add-cards-modal" labelledBy={labelId}>
      <div className="modal-header add-cards-modal-header">
        <h2 id={labelId}>Add a precon</h2>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X width={20} height={20} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      <div className="modal-body add-cards-modal-body">
        <div className="add-cards-panel add-cards-panel-product">
          <ProductSearchPanel onClose={onClose} />
        </div>
      </div>
    </Modal>
  );
}
