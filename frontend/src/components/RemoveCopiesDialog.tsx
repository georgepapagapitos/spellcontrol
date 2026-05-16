import { useState } from 'react';
import { Modal } from './Modal';

interface Props {
  cardName: string;
  /** Total copies of this printing+finish currently owned. */
  total: number;
  onConfirm: (count: number) => void;
  onCancel: () => void;
}

/**
 * Shown when removing from a stacked row (qty > 1): lets the user pick how
 * many copies of this one printing+finish to delete. Rows never mix
 * printings, so "remove 2 of 3" is unambiguous.
 */
export function RemoveCopiesDialog({ cardName, total, onConfirm, onCancel }: Props) {
  const [qty, setQty] = useState(total);
  const clamp = (n: number) => Math.max(1, Math.min(total, n));

  return (
    <Modal onClose={onCancel} labelledBy="remove-copies-title">
      <h2 id="remove-copies-title" className="choice-dialog-title">
        Remove {cardName}
      </h2>
      <p className="choice-dialog-body">
        You own {total} {total === 1 ? 'copy' : 'copies'} of this printing. How many should be
        removed?
      </p>
      <div className="card-edit-qty">
        <label className="card-edit-qty-label">Copies to remove</label>
        <div className="card-edit-qty-controls">
          <button
            type="button"
            className="card-edit-qty-btn"
            onClick={() => setQty((q) => clamp(q - 1))}
            aria-label="Decrease"
          >
            −
          </button>
          <input
            type="number"
            className="card-edit-qty-input"
            min={1}
            max={total}
            value={qty}
            onChange={(e) => {
              const n = Math.floor(Number(e.target.value));
              if (Number.isFinite(n)) setQty(clamp(n));
            }}
            aria-label="Copies to remove"
          />
          <button
            type="button"
            className="card-edit-qty-btn"
            onClick={() => setQty((q) => clamp(q + 1))}
            aria-label="Increase"
          >
            +
          </button>
        </div>
        {qty >= total && (
          <span className="card-edit-qty-warn">
            This removes every copy of this printing from your collection
          </span>
        )}
      </div>
      <div className="choice-dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => onConfirm(clamp(qty))}
          autoFocus
        >
          Remove {qty}
        </button>
      </div>
    </Modal>
  );
}
