import { Modal } from './Modal';
import { haptics } from '../lib/haptics';

interface Props {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal onClose={onCancel} labelledBy="confirm-dialog-title">
      <h2 id="confirm-dialog-title" className="choice-dialog-title">
        {title}
      </h2>
      <p className="choice-dialog-body">{body}</p>
      <div className="choice-dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => {
            // Destructive confirms get the warning cue at the moment of
            // commitment, mirroring Play's semantics (mulligan buzzes on the
            // press that destroys, not on the mere possibility). Benign
            // confirms (danger=false) stay silent.
            if (danger) haptics.warning();
            onConfirm();
          }}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
