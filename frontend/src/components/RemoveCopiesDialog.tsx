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
  // Default to one copy, not all of them: this dialog exists because the row
  // is stacked, and "remove some" is why the user is here. Defaulting to
  // `total` made the safe path the extra work, and paired with an autofocused
  // Remove it put "delete every copy of this printing" one Enter away.
  const [qty, setQty] = useState(1);
  const clamp = (n: number) => Math.max(1, Math.min(total, n));
  // Raw text mirror of qty — lets the field go blank/mid-edit; the clamp only
  // runs at commit (blur/Enter), not on every keystroke. Resynced from qty
  // during render (not an effect — avoids react-hooks/set-state-in-effect)
  // whenever the stepper buttons change it.
  const [qtyText, setQtyText] = useState('1');
  const [prevQty, setPrevQty] = useState(qty);
  if (prevQty !== qty) {
    setPrevQty(qty);
    setQtyText(String(qty));
  }

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
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            onBlur={() => {
              const n = Math.floor(Number(qtyText));
              const next = Number.isFinite(n) ? clamp(n) : 1;
              setQty(next);
              setQtyText(String(next));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
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
        {/* Safe default for a destructive dialog — see ConfirmDialog. */}
        <button type="button" className="btn" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" onClick={() => onConfirm(clamp(qty))}>
          Remove {qty}
        </button>
      </div>
    </Modal>
  );
}
