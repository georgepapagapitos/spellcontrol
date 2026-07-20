import { useId, useState } from 'react';
import { Modal } from '../Modal';
import { toast } from '../../store/toasts';
import { submitReport, type ReportKind } from '../../lib/report-client';
import './ReportDialog.css';

const REASON_MAX = 500;

interface Props {
  kind: ReportKind;
  targetId: string;
  onClose: () => void;
}

/**
 * Report-abuse dialog, generic over kind/targetId so every public surface
 * mounts the identical component — the public deck page, the public profile
 * page, and (per the reporting PR spec) W5's game-summary recap. The server
 * resolves the current owner itself; this only ever sends kind/targetId/reason.
 */
export function ReportDialog({ kind, targetId, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const textareaId = useId();
  const counterId = useId();

  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitReport({ kind, targetId, reason: trimmed });
      toast.show({ message: 'Report sent — thanks for flagging this.', tone: 'success' });
      onClose();
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : 'Failed to submit report.');
    }
  }

  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      dismissable={!submitting}
      className="choice-dialog report-dialog"
    >
      <h2 id={titleId} className="choice-dialog-title">
        Report this content
      </h2>
      <form
        className="report-dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <label className="report-dialog-label" htmlFor={textareaId}>
          Why are you reporting this?
        </label>
        <textarea
          id={textareaId}
          className="report-dialog-textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={REASON_MAX}
          rows={4}
          disabled={submitting}
          aria-describedby={counterId}
          placeholder="What's wrong with this?"
          autoFocus
        />
        <span id={counterId} className="report-dialog-counter">
          {reason.length}/{REASON_MAX}
        </span>
        {error && (
          <p role="alert" className="report-dialog-error">
            {error}
          </p>
        )}
        <div className="choice-dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {submitting ? 'Sending…' : 'Submit'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
