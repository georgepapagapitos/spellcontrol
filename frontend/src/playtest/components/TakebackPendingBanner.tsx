import { createPortal } from 'react-dom';
import type { GameRequest } from '@/lib/games-api';

interface Props {
  request: GameRequest;
  onCancel(): void;
  /** Overrides the default per-status copy for an outcome `request.status`
   *  alone can't express — e.g. an approval that arrived too late to still
   *  apply. */
  message?: string;
}

const STATUS_MESSAGE: Record<GameRequest['status'], string> = {
  pending: 'Asking the table…',
  approved: 'Approved — taking it back.',
  denied: 'The table declined. Nothing changed.',
  expired: 'Nobody answered in time. Nothing changed.',
  cancelled: 'Withdrawn.',
};

/**
 * This seat's own outgoing takeback request — a non-blocking, portaled
 * status strip (see PlaytestBoard's ⚠️ container-query note on why floating
 * pieces portal to <body>). `role="status"` gives the pending→resolved
 * transition its screen-reader announcement without stealing focus or
 * blocking input the way a dialog would.
 */
export function TakebackPendingBanner({ request, onCancel, message }: Props) {
  return createPortal(
    <div className="playtest-takeback-pending" role="status">
      <span className="playtest-takeback-pending__message">
        {message ?? STATUS_MESSAGE[request.status]}
      </span>
      {request.status === 'pending' && (
        <button type="button" className="playtest-takeback-pending__cancel" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>,
    document.body
  );
}
