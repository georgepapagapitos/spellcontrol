import { Modal } from './Modal';
import { haptics } from '../lib/haptics';

interface Props {
  title: string;
  body: string;
  confirmLabel?: string;
  /** Defaults to "Cancel"; override for a two-option choice that isn't a veto
   *  (e.g. "Start fresh" alongside a "Resume" confirm). */
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
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
        {/* A destructive confirm defaults to the safe choice: Cancel takes
            focus, so a reflexive Enter/Space on the dialog that just appeared
            backs out instead of destroying. Benign confirms keep the confirm
            button focused — matching the platform convention for alerts. */}
        <button type="button" className="btn" onClick={onCancel} autoFocus={danger}>
          {cancelLabel}
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
          autoFocus={!danger}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
